import type { Types } from "youtubei.js";
import { getYouTube, resetYouTube } from "./client";

type InnerTubeClient = Types.InnerTubeClient;

export interface AudioStream {
  url: string;
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

const cache = new Map<string, AudioStream>();
const inFlight = new Map<string, Promise<AudioStream>>();

export class StreamUnavailableError extends Error {}

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
    const head = await fetch(url, { headers: { range: "bytes=0-1" } });
    await head.body?.cancel();
    if (head.status !== 206) return null;
    total = Number(head.headers.get("content-range")?.split("/")[1] ?? 0);
    if (!total) return null;
  }
  const middle = Math.floor(total / 2);
  const probe = await fetch(url, { headers: { range: `bytes=${middle}-${middle + 1}` } });
  await probe.body?.cancel();
  return probe.status === 206 ? total : null;
}

class UnplayableError extends Error {}

async function resolveWithClient(videoId: string, client: InnerTubeClient): Promise<AudioStream | null> {
  const yt = await getYouTube();
  const info = await yt.getBasicInfo(videoId, { client });
  const status = info.playability_status?.status;
  if (status && status !== "OK") throw new UnplayableError(`${status}: ${info.playability_status?.reason ?? "unavailable"}`);
  const formats = (info.streaming_data?.adaptive_formats ?? []) as unknown as LooseFormat[];
  const format = pickAudioFormat(formats);
  if (!format) return null;
  const url = await format.decipher(yt.session.player);
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
  const failures: string[] = [];
  let videoIsUnplayable = false;
  for (const client of CLIENTS) {
    try {
      const stream = await resolveWithClient(videoId, client);
      if (stream) return stream;
      failures.push(`${client}: no usable audio`);
    } catch (error) {
      if (error instanceof UnplayableError) videoIsUnplayable = true;
      failures.push(`${client}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  // when YouTube didn't even say the video is gone, the session itself may be stale
  if (!videoIsUnplayable) resetYouTube();
  throw new StreamUnavailableError(`No playable audio for ${videoId} (${failures.join("; ")})`);
}

export function resolveAudio(videoId: string, options: { fresh?: boolean } = {}): Promise<AudioStream> {
  const cached = cache.get(videoId);
  if (!options.fresh && cached && cached.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return Promise.resolve(cached);
  if (options.fresh) cache.delete(videoId);

  const pending = inFlight.get(videoId);
  if (pending) return pending;
  const promise = resolveFresh(videoId)
    .then((stream) => {
      cache.set(videoId, stream);
      return stream;
    })
    .finally(() => inFlight.delete(videoId));
  inFlight.set(videoId, promise);
  return promise;
}

export function forgetAudio(videoId: string): void {
  cache.delete(videoId);
}
