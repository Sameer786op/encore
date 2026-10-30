import type { DatabaseSync } from "node:sqlite";
import type { MatchCandidate, SourceTrack, Track } from "@shared/types";
import { classify, rankCandidates, searchQueries, videoAsSong } from "./score";
import { songKey } from "./text";

export interface MatchCatalog {
  searchSongs(query: string): Promise<Track[]>;
  /** music videos and uploads, for songs the song search doesn't carry (some aren't in it in every country) */
  searchVideos?(query: string): Promise<Track[]>;
  trackById(videoId: string): Promise<Track>;
}

/** what's kept per song; entries from before videos were searched too are a bare list */
type CacheEntry = Track[] | { tracks: Track[]; videos: boolean };

/** cached search results stay useful for a while; songs rarely move */
const CACHE_DAYS = 45;
const KEEP_RESULTS = 12;
const RETRY_DELAYS_MS = [1_000, 4_000, 10_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Finds the YouTube Music version of a song from another service. Search
 * results are cached per song so re-imports and the history page never
 * search twice for the same thing.
 */
export class Matcher {
  constructor(
    private readonly db: DatabaseSync,
    private readonly catalog: MatchCatalog,
  ) {}

  private cached(key: string): { tracks: Track[]; videos: boolean } | null {
    const row = this.db.prepare("SELECT candidates, updated_at FROM match_cache WHERE key = ?").get(key) as
      | { candidates: string; updated_at: string }
      | undefined;
    if (!row) return null;
    if (Date.now() - Date.parse(row.updated_at) > CACHE_DAYS * 86_400_000) return null;
    const entry = JSON.parse(row.candidates) as CacheEntry;
    return Array.isArray(entry) ? { tracks: entry, videos: false } : entry;
  }

  private remember(key: string, tracks: Track[], videos = false): void {
    const entry: CacheEntry = { tracks: tracks.slice(0, KEEP_RESULTS), videos };
    this.db
      .prepare(
        `INSERT INTO match_cache (key, candidates, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET candidates = excluded.candidates, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(entry), new Date().toISOString());
  }

  static keyFor(source: SourceTrack): string {
    return source.videoId ? `yt:${source.videoId}` : songKey(source.artists[0] ?? "", source.title);
  }

  /** what's cached for a song, and whether it's worth searching again: a weak guess from before videos were searched is */
  private lookup(source: SourceTrack): { candidates: MatchCandidate[]; settled: boolean } | null {
    if (source.track) return { candidates: [{ track: source.track, score: 1 }], settled: true };
    const entry = this.cached(Matcher.keyFor(source));
    if (!entry) return null;
    if (source.videoId) return { candidates: entry.tracks.slice(0, 1).map((track) => ({ track, score: 1 })), settled: true };
    const candidates = rankCandidates(source, entry.tracks);
    const settled = entry.videos || !this.catalog.searchVideos || classify(source, candidates[0]) === "matched";
    return { candidates, settled };
  }

  /** ranked guesses, best first; only uses what's already cached */
  cachedCandidates(source: SourceTrack): MatchCandidate[] | null {
    return this.lookup(source)?.candidates ?? null;
  }

  async candidates(source: SourceTrack): Promise<MatchCandidate[]> {
    const hit = this.lookup(source);
    if (hit?.settled) return hit.candidates;
    const key = Matcher.keyFor(source);

    if (source.videoId) {
      // the source already knows the exact song; we only need its details
      const track = await withRetry(() => this.catalog.trackById(source.videoId!));
      this.remember(key, [track]);
      return [{ track, score: 1 }];
    }

    const found: Track[] = [];
    const queries = searchQueries(source);
    for (const query of queries) {
      found.push(...(await withRetry(() => this.catalog.searchSongs(query))));
      const ranked = rankCandidates(source, found);
      if (classify(source, ranked[0]) === "matched") break;
    }
    // YouTube Music's song search doesn't carry every song everywhere ("One Dance" isn't in it in India),
    // but its official video, official audio or a lyric video usually is, and plays the same
    const searchVideos = this.catalog.searchVideos?.bind(this.catalog);
    if (searchVideos && classify(source, rankCandidates(source, found)[0]) !== "matched") {
      const videos = await withRetry(() => searchVideos(queries[0]));
      found.push(...videos.map((video) => videoAsSong(source, video)));
    }
    const ranked = rankCandidates(source, found, KEEP_RESULTS);
    this.remember(key, ranked.map((c) => c.track), !!searchVideos);
    return ranked.slice(0, 5);
  }
}
