import { DatabaseSync } from "node:sqlite";

// One SQLite file holds everything the user owns. Each migration runs once,
// in order, and the file remembers its version in `user_version`.

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE liked (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id),
      liked_at TEXT NOT NULL
    );
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE playlist_items (
      item_id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id),
      position REAL NOT NULL,
      added_at TEXT NOT NULL
    );
    CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
    CREATE TABLE plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL REFERENCES tracks(id),
      played_at TEXT NOT NULL,
      played_ms INTEGER NOT NULL,
      origin TEXT NOT NULL DEFAULT 'encore'
    );
    CREATE INDEX plays_by_time ON plays(played_at);
  `,
  2: `
    -- what a song from another service turned out to be on YouTube Music
    CREATE TABLE match_cache (
      key TEXT PRIMARY KEY,
      candidates TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      error TEXT,
      result_playlist_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE import_items (
      job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      candidates TEXT NOT NULL DEFAULT '[]',
      chosen TEXT,
      PRIMARY KEY (job_id, idx)
    );
    CREATE INDEX import_items_status ON import_items(job_id, status);

    -- listening history brought in from other services
    CREATE TABLE imported_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      played_at TEXT NOT NULL,
      played_ms INTEGER NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      song_key TEXT NOT NULL,
      external_id TEXT,
      video_id TEXT
    );
    CREATE UNIQUE INDEX imported_plays_once ON imported_plays(origin, played_at, song_key);
    CREATE INDEX imported_plays_by_song ON imported_plays(song_key);

    CREATE TABLE local_folders (
      path TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );
    CREATE TABLE local_files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      folder TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      track TEXT NOT NULL,
      added_at TEXT NOT NULL
    );
  `,
  4: `
    -- artist names from imported history, matched to YouTube Music artists
    CREATE TABLE artist_ids (
      name_key TEXT PRIMARY KEY,
      artist_id TEXT,
      name TEXT,
      artwork TEXT,
      checked_at TEXT NOT NULL
    );
    -- artist pages: top songs, releases and similar artists
    CREATE TABLE artist_info (
      artist_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE followed_artists (
      artist_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artwork TEXT,
      followed_at TEXT NOT NULL
    );
    -- every release we've noticed; "baseline" ones were already out when we first looked
    CREATE TABLE releases_seen (
      release_id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      data TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      baseline INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE feed_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      built_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- scrobbles waiting to be sent, kept across restarts and offline spells
    CREATE TABLE scrobble_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_try_at TEXT NOT NULL
    );
  `,
  3: `
    -- lyrics per song; a NULL data means we looked and found none
    CREATE TABLE lyrics_cache (
      track_id TEXT PRIMARY KEY,
      data TEXT,
      fetched_at TEXT NOT NULL
    );
  `,
  5: `
    -- albums saved to Your Library (followed artists live in followed_artists)
    CREATE TABLE saved_albums (
      album_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `,
};

export const SCHEMA_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = current + 1; version <= SCHEMA_VERSION; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }
  return db;
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
