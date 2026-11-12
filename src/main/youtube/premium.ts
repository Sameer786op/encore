import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat, EnabledTrackTypes, Logger, LogLevel } from "googlevideo/utils";
import { Constants, type Innertube } from "youtubei.js";

// YouTube Premium members get 256 kbps audio: Opus (itag 774) and AAC (itag 141).
// YouTube hands it to the person's own account through its TV app, which is how
// Vyse Music signs in (accounts/google.ts), but the TV app gets no plain file
// URLs: it streams over SABR, YouTube's newer streaming protocol, which
// googlevideo speaks. Each song is fetched into memory when it starts, the way a
// browser buffers it, and the audio element reads it from there through
// media-protocol.ts. Nothing is written to disk.

Logger.getInstance().setLogLevels(LogLevel.ERROR);

/** Opus first, then AAC; both are about 256 kbps */
const PREMIUM_ITAGS = [774, 141];
/** songs in a row without Premium formats before deciding the account has no Premium, until the sign-in changes */
const MISSES_BEFORE_GIVING_UP = 3;
/** after the sign-in fails to load, wait this long before trying it again */
const SIGN_IN_RETRY_MS = 60_000;
/** tries for each piece before giving up, so a refused stream falls back to the usual one in a few seconds */
const MAX_RETRIES = 3;
/** memory kept for songs already fetched; the two most recent stay whatever their size */
const KEEP_BYTES = 192 * 1024 * 1024;
const KEEP_SONGS = 2;
/** songs downloading at once: the one playing and the next; skipping through songs mustn't pile up downloads behind them */
const KEEP_FETCHING = 2;
/** how long a song's audio may stop arriving before it's given up on and played the usual way */
const STALL_MS = 20_000;

const TV_CLIENT = { clientName: Number(Constants.CLIENT_NAME_IDS.TVHTML5), clientVersion: Constants.CLIENTS.TV.VERSION };

interface Source {
  stream: ReadableStream<ArrayBufferView>;
  abort(): void;
}

/** the songs holding memory, least recently read first */
export class Pool {
  private readonly songs = new Set<PremiumAudio>();

  constructor(
    private readonly keepBytes = KEEP_BYTES,
    private readonly keepSongs = KEEP_SONGS,
    private readonly keepFetching = KEEP_FETCHING,
  ) {}

  use(song: PremiumAudio): void {
    this.songs.delete(song);
    this.songs.add(song);
    let total = 0;
    for (const s of this.songs) total += s.contentLength;
    for (const oldest of this.songs) {
      if (total <= this.keepBytes || this.songs.size <= this.keepSongs) break;
      this.songs.delete(oldest);
      total -= oldest.contentLength;
      oldest.drop();
    }
    // only the newest songs keep downloading; the connection stays free for the one playing
    let fetching = 0;
    for (const s of [...this.songs].reverse()) {
      if (!s.fetching) continue;
      if (++fetching <= this.keepFetching) continue;
      this.songs.delete(s);
      s.drop();
    }
  }

  forget(song: PremiumAudio): void {
    this.songs.delete(song);
  }
}

const shared = new Pool();

/** one song's audio, fetched once into memory and read back in ranges as it arrives */
export class PremiumAudio {
  private state: "idle" | "fetching" | "done" | "failed" | "dropped" = "idle";
  private bytes: Uint8Array | null = null;
  private received = 0;
  private failure: Error | null = null;
  private source: Source | null = null;
  private waiting: (() => void)[] = [];

  constructor(
    readonly contentLength: number,
    private readonly open: () => Source,
    private readonly pool: Pool = shared,
    private readonly stallMs = STALL_MS,
  ) {}

  /** the fetch broke off, so this song should be played the usual way */
  get failed(): boolean {
    return this.state === "failed";
  }

  /** its audio is still coming in */
  get fetching(): boolean {
    return this.state === "fetching";
  }

  /** the memory was given back or the fetch broke off; fetch the song again to play it */
  get spent(): boolean {
    return this.state === "failed" || this.state === "dropped";
  }

  /** bytes start to end, inclusive, handed over as they arrive */
  read(start: number, end: number): ReadableStream<Uint8Array> {
    this.begin();
    this.pool.use(this);
    let at = start;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (at >= this.received && this.state === "fetching") {
          if (!(await this.waitForMore())) this.giveUp(new Error(`The audio stopped arriving for ${this.stallMs / 1000} s`));
        }
        if (!this.bytes || at >= this.received) {
          controller.error(this.failure ?? new Error("The song's audio was let go"));
          return;
        }
        const until = Math.min(end + 1, this.received);
        controller.enqueue(this.bytes.slice(at, until));
        at = until;
        if (at > end) controller.close();
      },
    });
  }

  /** gives the memory back; reads still waiting stop with an error */
  drop(): void {
    if (this.state === "fetching") this.source?.abort();
    this.state = "dropped";
    this.bytes = null;
    this.pool.forget(this);
    this.wake();
  }

  private begin(): void {
    if (this.state !== "idle") return;
    this.state = "fetching";
    this.bytes = new Uint8Array(this.contentLength);
    void this.fetchAll();
  }

  /** true once more bytes have arrived (or the fetch ended); false when nothing came for `stallMs` */
  private waitForMore(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), this.stallMs);
      this.waiting.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** the fetch is going nowhere: fail it, so the player asks for the song the usual way */
  private giveUp(error: Error): void {
    if (this.state !== "fetching") return;
    this.state = "failed";
    this.failure = error;
    console.warn(`[premium] ${error.message}`);
    this.source?.abort();
    this.source = null;
    this.wake();
  }

  private async fetchAll(): Promise<void> {
    try {
      this.source = this.open();
      const reader = this.source.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (this.state !== "fetching") return;
        if (done) break;
        if (this.received + value.byteLength > this.contentLength) throw new Error("More audio arrived than YouTube said there would be");
        this.bytes!.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), this.received);
        this.received += value.byteLength;
        this.wake();
      }
      if (this.received !== this.contentLength) throw new Error(`The audio stopped at ${this.received} of ${this.contentLength} bytes`);
      this.state = "done";
    } catch (error) {
      if (this.state !== "fetching") return;
      this.state = "failed";
      this.failure = error instanceof Error ? error : new Error(String(error));
      console.warn(`[premium] ${this.failure.message}`);
    } finally {
      this.source = null;
      this.wake();
    }
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const wake of waiting) wake();
  }
}

export interface PremiumStream {
  audio: PremiumAudio;
  mimeType: string;
  contentLength: number;
  expiresAt: number;
  loudnessDb?: number;
  codec: string;
  bitrate: number;
  sampleRate: number;
  /** one of Premium's 256 kbps formats, rather than the usual audio streamed through the account */
  premiumQuality: boolean;
}

type Session = () => Promise<Innertube>;

let signedIn: Session | null = null;
let current: Innertube | null = null;
let misses = 0;
let hasPremium = false;
let retryAt = 0;

/** where the signed-in YouTube Music session comes from */
export function usePremiumAccount(session: Session): void {
  signedIn = session;
}

/** whether a YouTube Music account is connected at all */
export function hasSignedInAccount(): boolean {
  return signedIn !== null;
}

/** what the TV app is told about a song: its formats and where to stream them from */
async function playerInfo(yt: Innertube, videoId: string) {
  // the session's own player script matters: YouTube checks the URL's "n" challenge against the
  // script version the request names, and without one it refuses about one song in five
  const player = yt.session.player;
  if (!player) return null;
  const info = await yt.getBasicInfo(videoId, { client: "TV" });
  if (info.playability_status?.status !== "OK") return null;
  const data = info.streaming_data;
  const ustreamer = info.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config;
  if (!data?.server_abr_streaming_url || !ustreamer) return null;
  const url = await player.decipher(data.server_abr_streaming_url);
  return { info, data, url, ustreamer };
}

/** Premium audio for a song through the person's own sign-in, or null when there's none to be had */
export function resolvePremium(videoId: string): Promise<PremiumStream | null> {
  return resolveSignedIn(videoId, false);
}

/**
 * Whatever audio the person's own sign-in gets for a song, Premium or not: for
 * songs the usual clients are refused, such as age-restricted ones, which
 * YouTube only plays to a signed-in account.
 */
export function resolveThroughAccount(videoId: string): Promise<PremiumStream | null> {
  return resolveSignedIn(videoId, true);
}

async function resolveSignedIn(videoId: string, anyFormat: boolean): Promise<PremiumStream | null> {
  if (!signedIn || Date.now() < retryAt) return null;
  let yt: Innertube;
  try {
    yt = await signedIn();
  } catch {
    retryAt = Date.now() + SIGN_IN_RETRY_MS;
    return null;
  }
  if (yt !== current) {
    // a new sign-in, maybe a different account: find out again whether it has Premium
    current = yt;
    misses = 0;
    hasPremium = false;
  }
  if (!anyFormat && !hasPremium && misses >= MISSES_BEFORE_GIVING_UP) return null;

  const player = await playerInfo(yt, videoId);
  if (!player) return null;
  const formats = player.data.adaptive_formats;
  const usable = (f: (typeof formats)[number]) => Boolean(f.content_length && f.mime_type && f.has_audio && !f.has_video && !f.is_drc);
  let format = PREMIUM_ITAGS.map((itag) => formats.find((f) => f.itag === itag && usable(f))).find(Boolean);
  const premiumQuality = Boolean(format);
  if (format) {
    hasPremium = true;
    misses = 0;
  } else {
    if (!hasPremium) misses++;
    if (!anyFormat) return null;
    // the best of the usual formats, streamed the way the TV app streams them
    format = formats.filter(usable).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0) || (b.audio_sample_rate ?? 0) - (a.audio_sample_rate ?? 0))[0];
    if (!format) return null;
  }

  const chosen = format;
  const open = (): Source => {
    const stream = new SabrStream({
      videoId,
      serverAbrStreamingUrl: player.url,
      videoPlaybackUstreamerConfig: player.ustreamer,
      clientInfo: TV_CLIENT,
      formats: formats.map((f) => buildSabrFormat(f)),
      callbacks: {
        // YouTube can ask for a fresh player response part-way, when the first one has run out
        onReloadPlayerResponse: async () => {
          const again = await playerInfo(await signedIn!(), videoId);
          if (!again) throw new Error("YouTube no longer offers this song");
          return { serverAbrStreamingUrl: again.url, videoPlaybackUstreamerConfig: again.ustreamer };
        },
      },
    });
    // failures reach the audio stream too, where they're handled
    stream.on("error", () => undefined);
    const { audioStream } = stream.start({ audioFormat: chosen.itag, enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY, isPostLiveDvr: false, maxRetries: MAX_RETRIES });
    return { stream: audioStream, abort: () => void stream.abort().catch(() => undefined) };
  };

  const mime = chosen.mime_type!;
  return {
    audio: new PremiumAudio(chosen.content_length!, open),
    mimeType: mime.split(";")[0],
    contentLength: chosen.content_length!,
    expiresAt: player.data.expires?.getTime?.() ?? Date.now() + 5 * 60 * 60_000,
    loudnessDb: chosen.loudness_db ?? player.info.player_config?.audio_config?.loudness_db,
    codec: /codecs="([^"]+)"/.exec(mime)?.[1] ?? mime.split(";")[0],
    bitrate: chosen.average_bitrate ?? chosen.bitrate ?? 0,
    sampleRate: Number(chosen.audio_sample_rate ?? 0),
    premiumQuality,
  };
}
