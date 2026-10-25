import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { MEDIA_SCHEME } from "@shared/types";
import { AUDIO_TYPES } from "./local/local";
import { forgetAudio, resolveAudio, StreamUnavailableError, type AudioStream } from "./youtube/streams";

// The audio element asks for encore-media://youtube/<videoId>. We resolve the
// real stream here and forward byte ranges, a few MB at a time, so seeking
// works, the renderer never sees YouTube URLs, and Web Audio can process the
// sound later without CORS trouble.
// encore-media://local/<id> plays an indexed music file and
// encore-media://art/<hash>.jpg serves cover art cut out of those files.

const CHUNK_BYTES = 4 * 1024 * 1024;

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  if (!header) return { start: 0, end: total - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    // suffix range: the last N bytes
    const suffix = Number(match[2]);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
  }
  if (start > end || start >= total) return null;
  return { start, end };
}

async function fetchRange(stream: AudioStream, start: number, end: number, signal: AbortSignal): Promise<Response> {
  return fetch(stream.url, { headers: { range: `bytes=${start}-${end}` }, signal });
}

async function handleYouTube(request: Request, videoId: string, fresh: boolean): Promise<Response> {
  let stream = await resolveAudio(videoId, { fresh });
  const range = parseRange(request.headers.get("range"), stream.contentLength);
  if (!range) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${stream.contentLength}` } });
  }
  const start = range.start;
  const end = Math.min(range.end, start + CHUNK_BYTES - 1);

  let upstream = await fetchRange(stream, start, end, request.signal);
  if (upstream.status === 403 || upstream.status === 410) {
    // the URL expired or was revoked; resolve a new one once
    await upstream.body?.cancel();
    forgetAudio(videoId);
    stream = await resolveAudio(videoId, { fresh: true });
    upstream = await fetchRange(stream, start, end, request.signal);
  }
  if (upstream.status !== 206 && upstream.status !== 200) {
    await upstream.body?.cancel();
    return new Response(null, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 206,
    headers: {
      "content-type": stream.mimeType,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${stream.contentLength}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
/** cover art hosts we fetch on the UI's behalf */
const IMAGE_HOSTS = /(^|\.)(googleusercontent\.com|ytimg\.com|ggpht\.com)$/;

/** cover art from YouTube, re-served with CORS headers so the UI can read its colours */
async function proxyImage(target: string, signal: AbortSignal): Promise<Response> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (url.protocol !== "https:" || !IMAGE_HOSTS.test(url.hostname)) return new Response(null, { status: 403 });
  const upstream = await fetch(url, { signal });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "max-age=86400",
      "access-control-allow-origin": "*",
    },
  });
}

/** serve part of a file on disk, honouring the Range header */
async function serveFile(request: Request, path: string, contentType: string): Promise<Response> {
  const { size } = await stat(path);
  const range = parseRange(request.headers.get("range"), size);
  if (!range) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  const partial = request.headers.has("range");
  const body = Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as ReadableStream;
  return new Response(body, {
    status: partial ? 206 : 200,
    headers: {
      "content-type": contentType,
      "content-length": String(range.end - range.start + 1),
      ...(partial ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    },
  });
}

export interface MediaSources {
  /** the file behind an indexed local track, or null */
  localPath(id: string): string | null;
  artworkDir: string;
  /** where Settings → Appearance keeps the wallpaper */
  wallpaperDir: string;
  wallpaperTypes: Record<string, string>;
}

export function handleMediaProtocol(sources: MediaSources): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    try {
      if (url.hostname === "youtube" && /^[\w-]{11}$/.test(id)) {
        return await handleYouTube(request, id, url.searchParams.has("fresh"));
      }
      if (url.hostname === "local" && /^[a-f0-9]{40}$/.test(id)) {
        const path = sources.localPath(id);
        if (!path) return new Response(null, { status: 404 });
        return await serveFile(request, path, AUDIO_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
      }
      if (url.hostname === "image") {
        return await proxyImage(url.searchParams.get("u") ?? "", request.signal);
      }
      if (url.hostname === "art" && /^[a-f0-9]{40}\.(jpg|png|webp)$/.test(id)) {
        return await serveFile(request, join(sources.artworkDir, id), IMAGE_TYPES[extname(id)]);
      }
      if (url.hostname === "wallpaper" && /^[a-f0-9]{40}\.[a-z]{3,4}$/.test(id) && sources.wallpaperTypes[extname(id)]) {
        return await serveFile(request, join(sources.wallpaperDir, id), sources.wallpaperTypes[extname(id)]);
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      const status = error instanceof StreamUnavailableError ? 404 : 502;
      console.warn(`[media] ${url.hostname}/${id}: ${error instanceof Error ? error.message : String(error)}`);
      return new Response(null, { status });
    }
  });
}
