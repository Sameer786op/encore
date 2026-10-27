import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Track } from "@shared/types";
import { openDatabase } from "../db";
import { Library } from "./library";

function track(n: number): Track {
  return {
    id: `youtube:video${String(n).padStart(6, "0")}`,
    source: "youtube",
    sourceId: `video${String(n).padStart(6, "0")}`,
    title: `Song ${n}`,
    artists: [{ name: `Artist ${n}` }],
    durationMs: 180_000,
  };
}

describe("Library", () => {
  let db: DatabaseSync;
  let library: Library;

  beforeEach(() => {
    db = openDatabase(":memory:");
    library = new Library(db);
  });

  afterEach(() => db.close());

  it("likes and unlikes tracks, newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    library.setLiked(track(1), true);
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    library.setLiked(track(2), true);
    vi.useRealTimers();

    expect(library.snapshot().liked.map((l) => l.track.title)).toEqual(["Song 2", "Song 1"]);
    library.setLiked(track(1), false);
    expect(library.snapshot().liked.map((l) => l.track.title)).toEqual(["Song 2"]);
  });

  it("liking twice keeps one entry", () => {
    library.setLiked(track(1), true);
    library.setLiked(track(1), true);
    expect(library.snapshot().liked).toHaveLength(1);
  });

  it("creates playlists, appends in order and allows duplicates", () => {
    const playlist = library.createPlaylist("  Road trip ", [track(1), track(2)]);
    expect(playlist.name).toBe("Road trip");
    library.addToPlaylist(playlist.id, [track(3), track(1)]);
    const items = library.snapshot().playlists[0].items;
    expect(items.map((i) => i.track.title)).toEqual(["Song 1", "Song 2", "Song 3", "Song 1"]);
    expect(new Set(items.map((i) => i.itemId)).size).toBe(4);
  });

  it("removes a single item and reorders the rest", () => {
    const playlist = library.createPlaylist("Mix", [track(1), track(2), track(3)]);
    const [a, b, c] = library.snapshot().playlists[0].items;
    library.removeFromPlaylist(playlist.id, b.itemId);
    library.reorderPlaylist(playlist.id, [c.itemId, a.itemId]);
    expect(library.snapshot().playlists[0].items.map((i) => i.track.title)).toEqual(["Song 3", "Song 1"]);
  });

  it("renames, refuses blank names, and deletes playlists with their items", () => {
    const playlist = library.createPlaylist("Old", [track(1)]);
    library.renamePlaylist(playlist.id, "New");
    library.renamePlaylist(playlist.id, "   ");
    expect(library.snapshot().playlists[0].name).toBe("New");
    library.deletePlaylist(playlist.id);
    expect(library.snapshot().playlists).toEqual([]);
  });

  it("rejects adding to a playlist that does not exist", () => {
    expect(() => library.addToPlaylist("missing", [track(1)])).toThrow("Playlist not found");
  });

  it("records plays newest first and clears history", () => {
    library.recordPlay(track(1), 30_000, new Date("2026-01-01T10:00:00Z"));
    library.recordPlay(track(2), 200_000, new Date("2026-01-01T11:00:00Z"));
    expect(library.snapshot().history.map((h) => [h.track.title, h.playedMs])).toEqual([
      ["Song 2", 200_000],
      ["Song 1", 30_000],
    ]);
    library.clearHistory();
    expect(library.snapshot().history).toEqual([]);
  });

  it("hands over recent plays oldest first, each song once, and how long each play of a song lasted", () => {
    library.recordPlay(track(1), 30_000, new Date("2026-01-01T10:00:00Z"));
    library.recordPlay(track(2), 200_000, new Date("2026-02-01T11:00:00Z"));
    library.recordPlay(track(1), 180_000, new Date("2026-02-02T11:00:00Z"));
    const recent = library.recentPlays("2026-01-15T00:00:00Z");
    expect(recent.plays).toEqual([
      { trackId: track(2).id, playedAt: "2026-02-01T11:00:00.000Z", playedMs: 200_000 },
      { trackId: track(1).id, playedAt: "2026-02-02T11:00:00.000Z", playedMs: 180_000 },
    ]);
    expect(recent.tracks.map((t) => t.title)).toEqual(["Song 2", "Song 1"]);
    expect(library.playsOf(track(1).id)).toEqual([180_000, 30_000]);
    expect(library.playsOf("youtube:nothing")).toEqual([]);
  });

  it("keeps the newest metadata for a track", () => {
    library.setLiked(track(1), true);
    library.recordPlay({ ...track(1), title: "Song 1 (Remastered)" }, 1000);
    expect(library.snapshot().liked[0].track.title).toBe("Song 1 (Remastered)");
  });

  it("likes many songs at once without duplicates, first one newest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    library.setLiked(track(2), true);
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    expect(library.likeMany([track(1), track(2), track(3)])).toBe(2);
    vi.useRealTimers();
    expect(library.snapshot().liked.map((l) => l.track.title)).toEqual(["Song 1", "Song 3", "Song 2"]);
  });

  it("notifies listeners on every change", () => {
    const listener = vi.fn();
    const stop = library.onChange(listener);
    library.setLiked(track(1), true);
    library.createPlaylist("A");
    stop();
    library.setLiked(track(2), true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].playlists).toHaveLength(1);
  });

  it("saves albums newest first and keeps the first save date", () => {
    const album = (id: string, title: string) => ({ id, title, artists: [{ name: "Daft Punk", id: "UCdaft" }], year: "2013" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    library.setAlbumSaved(album("MPREb_ram", "Random Access Memories"), true);
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    library.setAlbumSaved(album("MPREb_disc", "Discovery"), true);
    library.setAlbumSaved(album("MPREb_ram", "Random Access Memories (Deluxe)"), true);
    vi.useRealTimers();

    const albums = library.snapshot().albums;
    expect(albums.map((a) => a.album.title)).toEqual(["Discovery", "Random Access Memories (Deluxe)"]);
    expect(albums[1].savedAt).toBe("2026-01-01T00:00:00.000Z");
    library.setAlbumSaved(album("MPREb_disc", "Discovery"), false);
    expect(library.snapshot().albums).toHaveLength(1);
  });

  it("lists followed artists", () => {
    db.prepare("INSERT INTO followed_artists (artist_id, name, artwork, followed_at) VALUES (?, ?, ?, ?)").run("UCdua", "Dua Lipa", null, "2026-01-01T00:00:00Z");
    expect(library.snapshot().artists).toEqual([{ artist: { id: "UCdua", name: "Dua Lipa" }, savedAt: "2026-01-01T00:00:00Z" }]);
  });
});
