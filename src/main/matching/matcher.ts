import type { DatabaseSync } from "node:sqlite";
import type { MatchCandidate, SourceTrack, Track } from "@shared/types";
import { classify, rankCandidates, searchQueries } from "./score";
import { songKey } from "./text";

export interface MatchCatalog {
  searchSongs(query: string): Promise<Track[]>;
  trackById(videoId: string): Promise<Track>;
}

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

  private cached(key: string): Track[] | null {
    const row = this.db.prepare("SELECT candidates, updated_at FROM match_cache WHERE key = ?").get(key) as
      | { candidates: string; updated_at: string }
      | undefined;
    if (!row) return null;
    if (Date.now() - Date.parse(row.updated_at) > CACHE_DAYS * 86_400_000) return null;
    return JSON.parse(row.candidates) as Track[];
  }

  private remember(key: string, tracks: Track[]): void {
    this.db
      .prepare(
        `INSERT INTO match_cache (key, candidates, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET candidates = excluded.candidates, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(tracks.slice(0, KEEP_RESULTS)), new Date().toISOString());
  }

  static keyFor(source: SourceTrack): string {
    return source.videoId ? `yt:${source.videoId}` : songKey(source.artists[0] ?? "", source.title);
  }

  /** ranked guesses, best first; only uses what's already cached */
  cachedCandidates(source: SourceTrack): MatchCandidate[] | null {
    if (source.track) return [{ track: source.track, score: 1 }];
    const tracks = this.cached(Matcher.keyFor(source));
    if (!tracks) return null;
    return source.videoId ? tracks.slice(0, 1).map((track) => ({ track, score: 1 })) : rankCandidates(source, tracks);
  }

  async candidates(source: SourceTrack): Promise<MatchCandidate[]> {
    const hit = this.cachedCandidates(source);
    if (hit) return hit;
    const key = Matcher.keyFor(source);

    if (source.videoId) {
      // the source already knows the exact song; we only need its details
      const track = await withRetry(() => this.catalog.trackById(source.videoId!));
      this.remember(key, [track]);
      return [{ track, score: 1 }];
    }

    const found: Track[] = [];
    for (const query of searchQueries(source)) {
      found.push(...(await withRetry(() => this.catalog.searchSongs(query))));
      const ranked = rankCandidates(source, found);
      if (classify(source, ranked[0]) === "matched") break;
    }
    const ranked = rankCandidates(source, found, KEEP_RESULTS);
    this.remember(key, ranked.map((c) => c.track));
    return ranked.slice(0, 5);
  }
}
