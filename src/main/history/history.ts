import type { DatabaseSync } from "node:sqlite";
import type { HistorySource, ImportOrigin, ListeningInsights, SourceTrack, TopSong, Track } from "@shared/types";
import { trackId } from "@shared/types";
import { transaction } from "../db";
import type { ImportedPlay } from "../imports/exports/types";
import type { Matcher } from "../matching/matcher";
import { classify } from "../matching/score";
import { cleanArtistName, fold, songKey, splitArtists } from "../matching/text";

// Listening history from other services, kept next to Encore's own plays,
// and the numbers behind the "Your listening" page.

interface SongRow {
  song_key: string;
  title: string;
  artist: string;
  album: string | null;
  video_id: string | null;
  plays: number;
  ms: number;
}

interface Song {
  key: string;
  title: string;
  artist: string;
  album?: string;
  plays: number;
  ms: number;
  track?: Track;
  videoId?: string;
}

const TOP_SONGS = 100;
const TOP_ARTISTS = 24;

export class ListeningHistory {
  constructor(
    private readonly db: DatabaseSync,
    private readonly matcher: Matcher,
  ) {}

  /** saves plays, skipping any already imported; returns how many were new */
  add(origin: ImportOrigin, plays: ImportedPlay[]): number {
    return transaction(this.db, () => {
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO imported_plays (origin, played_at, played_ms, play_count, title, artist, album, song_key, external_id, video_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let added = 0;
      for (const p of plays) {
        const result = insert.run(
          p.origin ?? origin,
          p.playedAt,
          Math.round(p.playedMs),
          p.playCount,
          p.title,
          p.artist,
          p.album ?? null,
          songKey(p.artist, p.title),
          p.externalId ?? null,
          p.videoId ?? null,
        );
        added += Number(result.changes);
      }
      return added;
    });
  }

  removeOrigin(origin: ImportOrigin): void {
    this.db.prepare("DELETE FROM imported_plays WHERE origin = ?").run(origin);
  }

  sources(): HistorySource[] {
    return this.db
      .prepare("SELECT origin, SUM(play_count) AS plays, MIN(played_at) AS firstAt, MAX(played_at) AS lastAt FROM imported_plays GROUP BY origin ORDER BY plays DESC")
      .all() as unknown as HistorySource[];
  }

  private songs(): Song[] {
    const byKey = new Map<string, Song>();
    const imported = this.db
      .prepare(
        `SELECT song_key, MAX(title) AS title, MAX(artist) AS artist, MAX(album) AS album, MAX(video_id) AS video_id,
                SUM(play_count) AS plays, SUM(played_ms) AS ms
         FROM imported_plays GROUP BY song_key`,
      )
      .all() as unknown as SongRow[];
    for (const r of imported) {
      byKey.set(r.song_key, { key: r.song_key, title: r.title, artist: r.artist, album: r.album ?? undefined, plays: r.plays, ms: r.ms, videoId: r.video_id ?? undefined });
    }

    // Encore's own plays count too
    const own = this.db
      .prepare("SELECT t.data AS data, COUNT(*) AS plays, SUM(p.played_ms) AS ms FROM plays p JOIN tracks t ON t.id = p.track_id GROUP BY p.track_id")
      .all() as unknown as { data: string; plays: number; ms: number }[];
    for (const r of own) {
      const track = JSON.parse(r.data) as Track;
      const artist = track.artists[0]?.name ?? "";
      const key = songKey(artist, track.title);
      const song = byKey.get(key);
      if (song) {
        song.plays += r.plays;
        song.ms += r.ms;
        song.track ??= track;
      } else byKey.set(key, { key, title: track.title, artist, album: track.album?.title, plays: r.plays, ms: r.ms, track });
    }
    return [...byKey.values()];
  }

  /** a playable track when we already know one, without searching */
  private knownTrack(song: Song): Track | undefined {
    if (song.track) return song.track;
    if (song.videoId) {
      return {
        id: trackId("youtube", song.videoId),
        source: "youtube",
        sourceId: song.videoId,
        title: song.title,
        artists: [{ name: song.artist }],
        durationMs: 0,
        artwork: `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
      };
    }
    const source = this.sourceOf(song);
    const best = this.matcher.cachedCandidates(source)?.[0];
    return best && classify(source, best) === "matched" ? best.track : undefined;
  }

  private sourceOf(song: Song): SourceTrack {
    return { title: song.title, artists: splitArtists(song.artist), album: song.album, videoId: song.videoId, track: song.track };
  }

  insights(): ListeningInsights {
    const songs = this.songs();
    const top = [...songs].sort((a, b) => b.plays - a.plays || b.ms - a.ms).slice(0, TOP_SONGS);

    const artists = new Map<string, { name: string; plays: number; ms: number }>();
    for (const song of songs) {
      const name = splitArtists(cleanArtistName(song.artist))[0] ?? song.artist;
      const key = fold(name);
      if (!key || key === "unknown artist") continue;
      const entry = artists.get(key) ?? { name, plays: 0, ms: 0 };
      entry.plays += song.plays;
      entry.ms += song.ms;
      artists.set(key, entry);
    }

    const span = this.db
      .prepare(
        `SELECT MIN(first) AS firstAt, MAX(last) AS lastAt FROM (
           SELECT MIN(played_at) AS first, MAX(played_at) AS last FROM imported_plays
           UNION ALL SELECT MIN(played_at), MAX(played_at) FROM plays)`,
      )
      .get() as { firstAt: string | null; lastAt: string | null };

    const years = this.db
      .prepare(
        `SELECT CAST(year AS INTEGER) AS year, SUM(plays) AS plays, SUM(ms) AS ms FROM (
           SELECT substr(played_at, 1, 4) AS year, play_count AS plays, played_ms AS ms FROM imported_plays
           UNION ALL SELECT substr(played_at, 1, 4), 1, played_ms FROM plays)
         GROUP BY year ORDER BY year`,
      )
      .all() as unknown as { year: number; plays: number; ms: number }[];

    const topSongs: TopSong[] = top.map((song) => ({
      key: song.key,
      title: song.title,
      artist: song.artist,
      plays: song.plays,
      ms: song.ms,
      track: this.knownTrack(song),
      source: this.sourceOf(song),
    }));

    return {
      totals: {
        plays: songs.reduce((s, x) => s + x.plays, 0),
        ms: songs.reduce((s, x) => s + x.ms, 0),
        songs: songs.length,
        artists: artists.size,
        firstAt: span.firstAt ?? undefined,
        lastAt: span.lastAt ?? undefined,
      },
      sources: this.sources(),
      topSongs,
      topArtists: [...artists.values()].sort((a, b) => b.plays - a.plays).slice(0, TOP_ARTISTS),
      years: years.filter((y) => Number.isFinite(y.year) && y.year > 1990),
    };
  }
}
