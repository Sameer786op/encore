import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseFile } from "music-metadata";
import type { Lyrics, Track } from "@shared/types";
import { cleanArtistName, coreTitle, fold, similarity, stripFeatures } from "../matching/text";
import { INTERLUDE, isInstrumental, parseLrc } from "./lrc";

// Lyrics, best source first:
//  1. local files: a .lrc file next to the song, then lyrics inside its tags
//  2. LRCLIB, a free, open lyrics library with time-synced lines
//  3. YouTube Music's own lyrics, which are plain text
// Results, including "nothing found", are cached in the database.

const FOUND_DAYS = 60;
const NOT_FOUND_DAYS = 3;
const LRCLIB = "https://lrclib.net/api";
const USER_AGENT = "VyseMusic/0.3 (free desktop music player)";

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LyricsSources {
  /** plain lyrics from YouTube Music, or null */
  youtubeLyrics(videoId: string): Promise<string | null>;
  /** where a local track's file lives */
  localPath(id: string): string | null;
}

function fromRecord(record: LrclibRecord): Lyrics | null {
  if (record.instrumental) return { source: "lrclib", synced: [{ time: 0, text: INTERLUDE }], plain: null };
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  if (synced.length > 0) return { source: "lrclib", synced, plain: record.plainLyrics ?? null };
  if (record.plainLyrics?.trim()) return { source: "lrclib", synced: null, plain: record.plainLyrics.trim() };
  return null;
}

async function lrclib(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${LRCLIB}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
  return res.json();
}

/** the closest LRCLIB search result: same song, about the same length, synced preferred */
export function pickBest(track: Pick<Track, "title" | "artists" | "durationMs">, records: LrclibRecord[]): LrclibRecord | null {
  const title = coreTitle(track.title);
  const artist = fold(cleanArtistName(track.artists[0]?.name ?? ""));
  let best: { record: LrclibRecord; score: number } | null = null;
  for (const record of records) {
    const titleScore = similarity(title, coreTitle(record.trackName ?? ""));
    const artistScore = artist ? similarity(artist, fold(record.artistName ?? "")) : 0.6;
    if (titleScore < 0.75 || artistScore < 0.5) continue;
    const seconds = track.durationMs / 1000;
    const gap = seconds > 0 && record.duration ? Math.abs(record.duration - seconds) : 0;
    if (gap > 8) continue;
    const score = titleScore + artistScore - gap / 10 + (record.syncedLyrics ? 0.5 : 0);
    if (!best || score > best.score) best = { record, score };
  }
  return best?.record ?? null;
}

export class LyricsService {
  private inFlight = new Map<string, Promise<Lyrics | null>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly sources: LyricsSources,
  ) {}

  private cached(trackId: string): { lyrics: Lyrics | null } | null {
    const row = this.db.prepare("SELECT data, fetched_at FROM lyrics_cache WHERE track_id = ?").get(trackId) as { data: string | null; fetched_at: string } | undefined;
    if (!row) return null;
    const ageDays = (Date.now() - Date.parse(row.fetched_at)) / 86_400_000;
    if (ageDays > (row.data ? FOUND_DAYS : NOT_FOUND_DAYS)) return null;
    return { lyrics: row.data ? (JSON.parse(row.data) as Lyrics) : null };
  }

  private remember(trackId: string, lyrics: Lyrics | null): void {
    this.db
      .prepare(
        `INSERT INTO lyrics_cache (track_id, data, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(trackId, lyrics ? JSON.stringify(lyrics) : null, new Date().toISOString());
  }

  get(track: Track): Promise<Lyrics | null> {
    const hit = this.cached(track.id);
    if (hit) return Promise.resolve(hit.lyrics);
    const pending = this.inFlight.get(track.id);
    if (pending) return pending;
    const work = this.find(track)
      .then((lyrics) => {
        this.remember(track.id, lyrics);
        return lyrics;
      })
      .finally(() => this.inFlight.delete(track.id));
    this.inFlight.set(track.id, work);
    return work;
  }

  private async find(track: Track): Promise<Lyrics | null> {
    if (track.source === "local") {
      const fromFile = await this.fromLocalFile(track).catch(() => null);
      if (fromFile) return fromFile;
    }
    const fromLibrary = await this.fromLrclib(track).catch(() => null);
    if (fromLibrary?.synced) return fromLibrary;
    if (track.source === "youtube") {
      const plain = await this.sources.youtubeLyrics(track.sourceId).catch(() => null);
      if (plain?.trim()) return { source: "youtube", synced: null, plain: plain.trim() };
    }
    return fromLibrary;
  }

  private async fromLrclib(track: Track): Promise<Lyrics | null> {
    const title = stripFeatures(track.title);
    const artist = cleanArtistName(track.artists[0]?.name ?? "");
    if (!artist) return null;
    // an exact lookup first; it needs the length to within a couple of seconds
    if (track.durationMs > 0) {
      const exact = (await lrclib("get", {
        track_name: title,
        artist_name: artist,
        ...(track.album?.title ? { album_name: track.album.title } : {}),
        duration: String(Math.round(track.durationMs / 1000)),
      })) as LrclibRecord | null;
      const lyrics = exact ? fromRecord(exact) : null;
      if (lyrics?.synced) return lyrics;
    }
    const results = (await lrclib("search", { track_name: title, artist_name: artist })) as LrclibRecord[] | null;
    const best = pickBest(track, Array.isArray(results) ? results : []);
    return best ? fromRecord(best) : null;
  }

  private async fromLocalFile(track: Track): Promise<Lyrics | null> {
    const path = this.sources.localPath(track.sourceId);
    if (!path) return null;
    const sidecar = await readFile(path.slice(0, path.length - extname(path).length) + ".lrc", "utf8").catch(() => null);
    if (sidecar) {
      const synced = parseLrc(sidecar);
      if (synced.length > 0) return { source: "file", synced, plain: null };
      if (sidecar.trim()) return { source: "file", synced: null, plain: sidecar.trim() };
    }
    const meta = await parseFile(path, { skipCovers: true });
    for (const tag of meta.common.lyrics ?? []) {
      const synced = (tag.syncText ?? [])
        .filter((s) => typeof s.timestamp === "number" && s.text?.trim())
        .map((s) => ({ time: (s.timestamp as number) / 1000, text: s.text.trim() }));
      if (synced.length > 0) return { source: "file", synced, plain: null };
      // some files keep a whole LRC document in the plain lyrics tag
      if (tag.text?.trim()) {
        const lrc = parseLrc(tag.text);
        if (lrc.length > 0 && !isInstrumental(lrc)) return { source: "file", synced: lrc, plain: null };
        return { source: "file", synced: null, plain: tag.text.trim() };
      }
    }
    return null;
  }
}
