import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AccountService, AlbumSummary, HistoryEntry, LibrarySnapshot, LikedTrack, Playlist, PlaylistItem, SavedAlbum, SavedArtist, Track } from "@shared/types";
import { ACCOUNT_NAMES } from "@shared/types";
import { transaction } from "../db";

// Likes, playlists, plays and saved albums. Tracks are stored once and
// referenced by the first three. Followed artists belong to the feed, which
// watches them for new releases; they're listed here so Your Library shows them.

const HISTORY_IN_SNAPSHOT = 300;

interface TrackRow {
  data: string;
}

/** a song in a playlist mirrored from a connected account, with when it was added there if the service says */
export interface MirroredSong {
  track: Track;
  addedAt?: string;
}

/** changing a mirrored playlist here would be undone by the next sync, so it's refused */
export class SyncedPlaylistError extends Error {}

export class Library {
  private listeners = new Set<(snapshot: LibrarySnapshot) => void>();

  constructor(private readonly db: DatabaseSync) {}

  private transaction<T>(work: () => T): T {
    return transaction(this.db, work);
  }

  saveTrack(track: Track): void {
    this.db
      .prepare(
        `INSERT INTO tracks (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(track.id, JSON.stringify(track), new Date().toISOString());
  }

  private changed(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  onChange(listener: (snapshot: LibrarySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): LibrarySnapshot {
    const liked = (
      this.db
        .prepare("SELECT t.data, l.liked_at FROM liked l JOIN tracks t ON t.id = l.track_id ORDER BY l.liked_at DESC")
        .all() as unknown as (TrackRow & { liked_at: string })[]
    ).map((r): LikedTrack => ({ track: JSON.parse(r.data), likedAt: r.liked_at }));

    const items = this.db
      .prepare(
        `SELECT i.item_id, i.playlist_id, i.added_at, t.data FROM playlist_items i
         JOIN tracks t ON t.id = i.track_id ORDER BY i.playlist_id, i.position`,
      )
      .all() as unknown as (TrackRow & { item_id: string; playlist_id: string; added_at: string })[];
    const itemsByPlaylist = new Map<string, PlaylistItem[]>();
    for (const r of items) {
      const list = itemsByPlaylist.get(r.playlist_id) ?? [];
      list.push({ itemId: r.item_id, track: JSON.parse(r.data), addedAt: r.added_at });
      itemsByPlaylist.set(r.playlist_id, list);
    }
    const synced = new Map(
      (
        this.db.prepare("SELECT playlist_id, service, remote_id FROM synced_playlists WHERE playlist_id IS NOT NULL").all() as unknown as {
          playlist_id: string;
          service: AccountService;
          remote_id: string;
        }[]
      ).map((r) => [r.playlist_id, { service: r.service, remoteId: r.remote_id }]),
    );
    const playlists = (
      this.db.prepare("SELECT id, name, created_at, updated_at FROM playlists ORDER BY updated_at DESC").all() as unknown as {
        id: string;
        name: string;
        created_at: string;
        updated_at: string;
      }[]
    ).map(
      (p): Playlist => ({
        id: p.id,
        name: p.name,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        items: itemsByPlaylist.get(p.id) ?? [],
        ...(synced.has(p.id) ? { synced: synced.get(p.id) } : {}),
      }),
    );

    const history = (
      this.db
        .prepare(
          `SELECT t.data, p.played_at, p.played_ms FROM plays p JOIN tracks t ON t.id = p.track_id
           ORDER BY p.played_at DESC, p.id DESC LIMIT ?`,
        )
        .all(HISTORY_IN_SNAPSHOT) as unknown as (TrackRow & { played_at: string; played_ms: number })[]
    ).map((r): HistoryEntry => ({ track: JSON.parse(r.data), playedAt: r.played_at, playedMs: r.played_ms }));

    const albums = (this.db.prepare("SELECT data, saved_at FROM saved_albums ORDER BY saved_at DESC").all() as unknown as (TrackRow & { saved_at: string })[]).map(
      (r): SavedAlbum => ({ album: JSON.parse(r.data), savedAt: r.saved_at }),
    );

    const artists = (
      this.db.prepare("SELECT artist_id, name, artwork, followed_at FROM followed_artists ORDER BY followed_at DESC").all() as unknown as {
        artist_id: string;
        name: string;
        artwork: string | null;
        followed_at: string;
      }[]
    ).map((r): SavedArtist => ({ artist: { id: r.artist_id, name: r.name, ...(r.artwork ? { artwork: r.artwork } : {}) }, savedAt: r.followed_at }));

    return { liked, playlists, history, albums, artists };
  }

  setAlbumSaved(album: AlbumSummary, saved: boolean): void {
    if (saved) {
      // saving again refreshes the details but keeps when it was first saved
      this.db
        .prepare(
          `INSERT INTO saved_albums (album_id, data, saved_at) VALUES (?, ?, ?)
           ON CONFLICT(album_id) DO UPDATE SET data = excluded.data`,
        )
        .run(album.id, JSON.stringify(album), new Date().toISOString());
    } else {
      this.db.prepare("DELETE FROM saved_albums WHERE album_id = ?").run(album.id);
    }
    this.changed();
  }

  /** tell listeners about a change made elsewhere, like following an artist */
  refresh(): void {
    this.changed();
  }

  /** like many songs at once, keeping their order (the first ends up newest) */
  likeMany(tracks: Track[]): number {
    const base = Date.now();
    const added = this.transaction(() => {
      const insert = this.db.prepare("INSERT OR IGNORE INTO liked (track_id, liked_at) VALUES (?, ?)");
      let count = 0;
      tracks.forEach((track, i) => {
        this.saveTrack(track);
        count += Number(insert.run(track.id, new Date(base - i).toISOString()).changes);
      });
      return count;
    });
    this.changed();
    return added;
  }

  setLiked(track: Track, liked: boolean): void {
    this.transaction(() => {
      if (liked) {
        this.saveTrack(track);
        this.db.prepare("INSERT OR IGNORE INTO liked (track_id, liked_at) VALUES (?, ?)").run(track.id, new Date().toISOString());
      } else {
        this.db.prepare("DELETE FROM liked WHERE track_id = ?").run(track.id);
      }
    });
    this.changed();
  }

  createPlaylist(name: string, tracks: Track[] = []): Playlist {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare("INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name.trim() || "New playlist", now, now);
      this.insertItems(id, tracks);
    });
    this.changed();
    return this.snapshot().playlists.find((p) => p.id === id)!;
  }

  /** refuse to change a playlist that mirrors one on a connected account */
  private assertEditable(id: string): void {
    const row = this.db.prepare("SELECT service FROM synced_playlists WHERE playlist_id = ?").get(id) as { service: AccountService } | undefined;
    if (row) throw new SyncedPlaylistError(`This playlist comes from ${ACCOUNT_NAMES[row.service] ?? row.service}. Change it there and it updates here.`);
  }

  renamePlaylist(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.assertEditable(id);
    this.db.prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?").run(trimmed, new Date().toISOString(), id);
    this.changed();
  }

  deletePlaylist(id: string): void {
    this.deletePlaylists([id]);
  }

  deletePlaylists(ids: string[]): void {
    if (ids.length === 0) return;
    this.transaction(() => {
      for (const id of ids) {
        // deleting a mirrored playlist switches its sync off, so the next sync doesn't bring it back
        this.db.prepare("UPDATE synced_playlists SET enabled = 0, playlist_id = NULL WHERE playlist_id = ?").run(id);
        this.db.prepare("DELETE FROM playlists WHERE id = ?").run(id);
      }
    });
    this.changed();
  }

  /**
   * Make a playlist hold exactly these songs, in this order: the mirror of a playlist on a
   * connected account. Songs still there keep their place in the table and their date added.
   * Creates the playlist when `id` is missing or gone, and links it to the playlist it mirrors
   * in the same step, so nobody is ever told about it as an ordinary playlist. Returns its id.
   */
  mirrorPlaylist(id: string | undefined, name: string, songs: MirroredSong[], source: { service: AccountService; remoteId: string }): string {
    let changed = false;
    const playlistId = this.transaction(() => {
      const now = new Date().toISOString();
      const existing = id ? (this.db.prepare("SELECT name FROM playlists WHERE id = ?").get(id) as { name: string } | undefined) : undefined;
      const playlistId = existing ? id! : randomUUID();
      if (!existing) {
        this.db.prepare("INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(playlistId, name, now, now);
        this.db.prepare("UPDATE synced_playlists SET playlist_id = ? WHERE service = ? AND remote_id = ?").run(playlistId, source.service, source.remoteId);
        changed = true;
      } else if (existing.name !== name) {
        this.db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(name, playlistId);
        changed = true;
      }

      const rows = this.db.prepare("SELECT item_id, track_id, position FROM playlist_items WHERE playlist_id = ? ORDER BY position").all(playlistId) as unknown as {
        item_id: string;
        track_id: string;
        position: number;
      }[];
      const byTrack = new Map<string, { item_id: string; position: number }[]>();
      for (const row of rows) byTrack.set(row.track_id, [...(byTrack.get(row.track_id) ?? []), row]);

      const move = this.db.prepare("UPDATE playlist_items SET position = ? WHERE item_id = ?");
      const insert = this.db.prepare("INSERT INTO playlist_items (item_id, playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?, ?)");
      songs.forEach((song, position) => {
        const reuse = byTrack.get(song.track.id)?.shift();
        if (reuse) {
          if (reuse.position !== position) {
            move.run(position, reuse.item_id);
            changed = true;
          }
          return;
        }
        this.saveTrack(song.track);
        insert.run(randomUUID(), playlistId, song.track.id, position, song.addedAt ?? now);
        changed = true;
      });

      const remove = this.db.prepare("DELETE FROM playlist_items WHERE item_id = ?");
      for (const left of byTrack.values()) {
        for (const row of left) {
          remove.run(row.item_id);
          changed = true;
        }
      }
      if (changed) this.db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, playlistId);
      return playlistId;
    });
    if (changed) this.changed();
    return playlistId;
  }

  private insertItems(playlistId: string, tracks: Track[]): number {
    const { last } = this.db.prepare("SELECT COALESCE(MAX(position), -1) AS last FROM playlist_items WHERE playlist_id = ?").get(playlistId) as {
      last: number;
    };
    const insert = this.db.prepare("INSERT INTO playlist_items (item_id, playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?, ?)");
    const now = new Date().toISOString();
    tracks.forEach((track, i) => {
      this.saveTrack(track);
      insert.run(randomUUID(), playlistId, track.id, last + 1 + i, now);
    });
    return tracks.length;
  }

  addToPlaylist(id: string, tracks: Track[]): number {
    this.assertEditable(id);
    const added = this.transaction(() => {
      const exists = this.db.prepare("SELECT 1 FROM playlists WHERE id = ?").get(id);
      if (!exists) throw new Error("Playlist not found");
      const count = this.insertItems(id, tracks);
      this.db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      return count;
    });
    this.changed();
    return added;
  }

  removeFromPlaylist(id: string, itemId: string): void {
    this.assertEditable(id);
    this.db.prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND item_id = ?").run(id, itemId);
    this.db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    this.changed();
  }

  /** `itemIds` is the full new order; unknown ids are ignored */
  reorderPlaylist(id: string, itemIds: string[]): void {
    this.assertEditable(id);
    this.transaction(() => {
      const update = this.db.prepare("UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND item_id = ?");
      itemIds.forEach((itemId, position) => update.run(position, id, itemId));
    });
    this.changed();
  }

  recordPlay(track: Track, playedMs: number, playedAt = new Date()): void {
    this.transaction(() => {
      this.saveTrack(track);
      this.db
        .prepare("INSERT INTO plays (track_id, played_at, played_ms) VALUES (?, ?, ?)")
        .run(track.id, playedAt.toISOString(), Math.max(0, Math.round(playedMs)));
    });
    this.changed();
  }

  clearHistory(): void {
    this.db.exec("DELETE FROM plays");
    this.changed();
  }
}
