import type { Types } from "youtubei.js";
import { TimeoutError, withDeadline } from "../deadline";
import { getYouTube, resetYouTube } from "./client";
import { hasSignedInAccount, resolvePremium, resolveThroughAccount, type PremiumAudio } from "./premium";

type InnerTubeClient = Types.InnerTubeClient;

export interface AudioStream {
  /** a plain file URL, read a range at a time; absent for Premium audio */
  url?: string;
  /** audio fetched into memory through the person's account over SABR (premium.ts) */
  premium?: PremiumAudio;
  /** that audio is one of Premium's 256 kbps formats */
  premiumQuality?: boolean;
  mimeType: string;
  contentLength: number;
  expiresAt: number;
  loudnessDb?: number;
  client: InnerTubeClient;
  /** "opus" or "mp4a.40.2" */
  codec: string;
  /** average bits per second */
  bitrate: number;
  sampleRate: number;
}

// Clients tried in order. VISIONOS currently serves whole files without a
// proof-of-origin token; the others are kept as fallbacks and are only used
// when their URL passes the full-file check below.
const CLIENTS: InnerTubeClient[] = ["VISIONOS", "ANDROID_VR", "IOS"];

/** refresh a cached URL this long before YouTube says it expires */
const EXPIRY_MARGIN_MS = 10 * 60_000;

// How long each step may take. None of these requests normally takes more
// than a second or two; one that hangs used to leave the song "Loading…" for
// good, with nothing to say so. Past these, the next client is tried, and past
// the last the player is told, so it can ask again or move on.
const INFO_MS = 10_000;
const DECIPHER_MS = 5_000;
const PROBE_MS = 6_000;
const PREMIUM_MS = 15_000;
const RESOLVE_MS = 40_000;

const cache = new Map<string, AudioStream>();
const inFlight = new Map<string, Promise<AudioStream>>();
/** songs whose Premium audio broke off; they play the usual way from then on */
const noPremium = new Set<string>();
/** why the last attempt at a song failed, in plain words, for the player to show */
const problems = new Map<string, string>();
const MAX_PROBLEMS = 200;

export class StreamUnavailableError extends Error {}

/** what YouTube's refusal means for the person listening, or null when there's nothing useful to say */
export function explainProblem(message: string, signedIn: boolean): string | null {
  if (/private/i.test(message)) return "it's private on YouTube";
  if (/confirm your age/i.test(message)) return signedIn ? "it's age-restricted on YouTube" : "it's age-restricted; connect your YouTube Music account in Settings to play it";
  if (/not a bot/i.test(message)) return "YouTube is asking this computer to prove it isn't a bot; that usually clears in a few minutes";
  if (/LOGIN_REQUIRED|sign in/i.test(message)) return signedIn ? "YouTube won't play it to this account" : "YouTube only plays it to a signed-in account; connect your YouTube Music account in Settings";
  if (/not available|unavailable|removed|no longer/i.test(message)) return "it isn't available on YouTube any more";
  if (/took more than/i.test(message)) return "YouTube didn't answer in time";
  return null;
}

/** the reason the last attempt at this song failed, for the player's message; null once it plays again */
export function problemWith(videoId: string): string | null {
  return problems.get(videoId) ?? null;
}

function rememberProblem(videoId: string, message: string): void {
  const reason = explainProblem(message, hasSignedInAccount());
  if (!reason) return;
  problems.delete(videoId);
  problems.set(videoId, reason);
  if (problems.size > MAX_PROBLEMS) problems.delete(problems.keys().next().value!);
}

interface LooseFormat {
  itag?: number;
  mime_type?: string;
  bitrate?: number;
  average_bitrate?: number;
  audio_sample_rate?: number;
  content_length?: number;
  has_audio?: boolean;
  has_video?: boolean;
  is_drc?: boolean;
  loudness_db?: number;
  decipher(player: unknown): Promise<string>;
}

export function pickAudioFormat<T extends Pick<LooseFormat, "has_audio" | "has_video" | "is_drc" | "mime_type" | "bitrate" | "audio_sample_rate">>(formats: T[]): T | undefined {
  const audio = formats.filter((f) => f.has_audio && !f.has_video && !f.is_drc && f.mime_type);
  // Chromium plays both Opus/WebM and AAC/MP4; take the highest bitrate, then the higher sample rate.
  // Without Premium that's Opus at about 130-160 kbps, 48 kHz (itag 251), ahead of AAC at 128 kbps (itag 140).
  return audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0) || (b.audio_sample_rate ?? 0) - (a.audio_sample_rate ?? 0))[0];
}

/** a URL that only answers the first chunk is useless, so check a range from the middle too */
async function servesWholeFile(url: string, knownLength?: number): Promise<number | null> {
  let total = knownLength ?? 0;
  if (!total) {
    const head = await fetch(url, { headers: { range: "bytes=0-1" }, signal: AbortSignal.timeout(PROBE_MS) });
    await head.body?.cancel();
    if (head.status !== 206) return null;
    total = Number(head.headers.get("content-range")?.split("/")[1] ?? 0);
    if (!total) return null;
  }
  const middle = Math.floor(total / 2);
  const probe = await fetch(url, { headers: { range: `bytes=${middle}-${middle + 1}` }, signal: AbortSignal.timeout(PROBE_MS) });
  await probe.body?.cancel();
  return probe.status === 206 ? total : null;
}

class UnplayableError extends Error {}

async function resolveWithClient(videoId: string, client: InnerTubeClient): Promise<AudioStream | null> {
  const yt = await getYouTube();
  const info = await withDeadline(yt.getBasicInfo(videoId, { client }), INFO_MS, `Asking YouTube (${client}) about the song`);
  const status = info.playability_status?.status;
  if (status && status !== "OK") throw new UnplayableError(`${status}: ${info.playability_status?.reason ?? "unavailable"}`);
  const formats = (info.streaming_data?.adaptive_formats ?? []) as unknown as LooseFormat[];
  const format = pickAudioFormat(formats);
  if (!format) return null;
  const url = await withDeadline(format.decipher(yt.session.player), DECIPHER_MS, "Working out the song's URL");
  const total = await servesWholeFile(url, format.content_length);
  if (!total) return null;
  const expiresAt = info.streaming_data?.expires?.getTime?.() ?? Date.now() + 5 * 60 * 60_000;
  return {
    url,
    mimeType: format.mime_type!.split(";")[0],
    contentLength: total,
    expiresAt,
    loudnessDb: format.loudness_db ?? info.player_config?.audio_config?.loudness_db,
    client,
    codec: /codecs="([^"]+)"/.exec(format.mime_type!)?.[1] ?? format.mime_type!.split(";")[0],
    bitrate: format.average_bitrate ?? format.bitrate ?? 0,
    sampleRate: Number(format.audio_sample_rate ?? 0),
  };
}

async function resolveFresh(videoId: string): Promise<AudioStream> {
  // with a YouTube Music account that has Premium, its 256 kbps audio comes first
  if (!noPremium.has(videoId)) {
    const premium = await withDeadline(resolvePremium(videoId), PREMIUM_MS, "Premium audio").catch((error: unknown) => {
      console.warn(`[premium] ${videoId}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      return null;
    });
    if (premium) {
      const { audio, ...format } = premium;
      return { ...format, premium: audio, client: "TV" };
    }
  }
  const failures: string[] = [];
  let refusal: string | null = null;
  for (const client of CLIENTS) {
    try {
      const stream = await resolveWithClient(videoId, client);
      if (stream) return stream;
      failures.push(`${client}: no usable audio`);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      if (error instanceof UnplayableError) refusal ??= message;
      else if (error instanceof TimeoutError) refusal ??= message;
      failures.push(`${client}: ${message}`);
    }
  }
  // YouTube refuses some songs to anyone who isn't signed in, age-restricted ones above all;
  // a connected account can still get them, the way its TV app would
  if (!noPremium.has(videoId) && hasSignedInAccount()) {
    const viaAccount = await withDeadline(resolveThroughAccount(videoId), PREMIUM_MS, "Audio through the account").catch((error: unknown) => {
      console.warn(`[account] ${videoId}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      return null;
    });
    if (viaAccount) {
      const { audio, ...format } = viaAccount;
      return { ...format, premium: audio, client: "TV" };
    }
  }
  // when YouTube didn't even say the video is gone, the session itself may be stale
  const videoIsUnplayable = failures.some((f) => /UNPLAYABLE|LOGIN_REQUIRED|unavailable|not available/i.test(f) && !/took more than/.test(f));
  if (!videoIsUnplayable) resetYouTube();
  rememberProblem(videoId, refusal ?? failures.join("; "));
  throw new StreamUnavailableError(`No playable audio for ${videoId} (${failures.join("; ")})`);
}

export function resolveAudio(videoId: string, options: { fresh?: boolean } = {}): Promise<AudioStream> {
  let cached = cache.get(videoId);
  // the player asks afresh after a song fails; when that song was Premium audio, play it the usual way instead
  if (cached?.premium && (options.fresh || cached.premium.failed)) noPremium.add(videoId);
  if (cached?.premium?.spent) {
    cache.delete(videoId);
    cached = undefined;
  }
  if (!options.fresh && cached && cached.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return Promise.resolve(cached);
  if (options.fresh) cache.delete(videoId);

  const pending = inFlight.get(videoId);
  if (pending) return pending;
  const promise = withDeadline(resolveFresh(videoId), RESOLVE_MS, "Finding the song's audio")
    .then((stream) => {
      cache.set(videoId, stream);
      problems.delete(videoId);
      return stream;
    })
    .catch((error: unknown) => {
      // a session this slow is best started afresh for the next song
      if (!(error instanceof StreamUnavailableError)) {
        resetYouTube();
        rememberProblem(videoId, error instanceof Error ? error.message : String(error));
      }
      throw error;
    })
    .finally(() => inFlight.delete(videoId));
  inFlight.set(videoId, promise);
  return promise;
}

export function forgetAudio(videoId: string): void {
  cache.delete(videoId);
}
