import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceTrack, Track } from "@shared/types";
import { openDatabase } from "../db";
import { ListeningHistory } from "../history/history";
import { Library } from "../library/library";
import { Matcher, type MatchCatalog } from "../matching/matcher";
import { ImportManager } from "./manager";

const yt = (id: string, title: string, artist: string, seconds: number): Track => ({
  id: `youtube:${id}`,
  source: "youtube",
  sourceId: id,
  title,
  artists: [{ name: artist }],
  durationMs: seconds * 1000,
});

const CATALOG: Record<string, Track[]> = {
  "Blinding Lights The Weeknd": [yt("aaaaaaaaaa1", "Blinding Lights", "The Weeknd", 202)],
  "Yellow Coldplay": [yt("aaaaaaaaaa2", "Yellow (Live)", "Coldplay", 290)],
  Yellow: [],
};

function fakeCatalog(): MatchCatalog & { searches: string[] } {
  const searches: string[] = [];
  return {
    searches,
    async searchSongs(query) {
      searches.push(query);
      return CATALOG[query] ?? [];
    },
    async trackById(videoId) {
      if (videoId === "gonegonegon") throw new Error("Video unavailable");
      return yt(videoId, `Title of ${videoId}`, "Some Artist - Topic", 180);
    },
  };
}

const src = (title: string, artist: string, seconds?: number): SourceTrack => ({ title, artists: [artist], durationMs: seconds ? seconds * 1000 : undefined });

describe("ImportManager", () => {
  let db: DatabaseSync;
  let library: Library;
  let catalog: ReturnType<typeof fakeCatalog>;
  let manager: ImportManager;

  beforeEach(() => {
    db = openDatabase(":memory:");
    library = new Library(db);
    catalog = fakeCatalog();
    manager = new ImportManager(db, library, new Matcher(db, catalog));
  });
  afterEach(() => {
    manager.dispose();
    db.close();
  });

  const settled = (id: string) => vi.waitFor(() => expect(manager.get(id).status).not.toBe("matching"), { timeout: 3000 });

  it("matches, asks about doubtful songs, and builds the playlist", async () => {
    const job = manager.create({
      name: "Road trip",
      origin: "spotify",
      destination: { kind: "playlist", name: "Road trip" },
      tracks: [src("Blinding Lights", "The Weeknd", 200), src("Yellow", "Coldplay", 266), src("Nothing Here", "Nobody", 100)],
    });
    expect(job.status).toBe("matching");
    await settled(job.id);

    const details = manager.get(job.id);
    expect(details.items.map((i) => i.status)).toEqual(["matched", "review", "missing"]);
    expect(details.counts).toMatchObject({ matched: 1, review: 1, missing: 1, pending: 0 });

    // the user keeps the live version anyway, then finishes
    expect(manager.acceptSuggestions(job.id)).toBe(1);
    const done = manager.finish(job.id);
    expect(done.status).toBe("done");
    const playlist = library.snapshot().playlists.find((p) => p.id === done.resultPlaylistId);
    expect(playlist?.items.map((i) => i.track.title)).toEqual(["Blinding Lights", "Yellow (Live)"]);
  });

  it("lets the user pick another song or leave one out", async () => {
    const job = manager.create({ name: "Mix", origin: "csv", destination: { kind: "liked" }, tracks: [src("Blinding Lights", "The Weeknd"), src("Yellow", "Coldplay")] });
    await settled(job.id);
    manager.choose(job.id, 0, null);
    manager.choose(job.id, 1, yt("aaaaaaaaaa9", "Yellow", "Coldplay", 267));
    manager.finish(job.id);
    expect(library.snapshot().liked.map((l) => l.track.title)).toEqual(["Yellow"]);
  });

  it("never searches twice for the same song", async () => {
    const first = manager.create({ name: "A", origin: "spotify", destination: { kind: "liked" }, tracks: [src("Blinding Lights", "The Weeknd", 200)] });
    await settled(first.id);
    const before = catalog.searches.length;
    const second = manager.create({ name: "B", origin: "apple", destination: { kind: "liked" }, tracks: [src("Blinding Lights", "The Weeknd", 201)] });
    await settled(second.id);
    expect(catalog.searches.length).toBe(before);
    expect(manager.get(second.id).items[0].status).toBe("matched");
  });

  it("looks up songs that only have a video id and fills in their names", async () => {
    const job = manager.create({
      name: "Takeout",
      origin: "youtube",
      destination: { kind: "playlist", name: "Gym" },
      tracks: [{ title: "", artists: [], videoId: "J7p4bzqLvCw" }],
    });
    await settled(job.id);
    const item = manager.get(job.id).items[0];
    expect(item.status).toBe("matched");
    expect(item.source.title).toBe("Title of J7p4bzqLvCw");
  });

  it("marks songs whose video is gone as not found", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const job = manager.create({ name: "T", origin: "youtube", destination: { kind: "liked" }, tracks: [{ title: "", artists: [], videoId: "gonegonegon" }] });
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    await settled(job.id);
    expect(manager.get(job.id).items[0].status).toBe("missing");
  });

  it("takes ready-made YouTube tracks without matching", () => {
    const track = yt("bbbbbbbbbb1", "Song", "Artist", 100);
    const job = manager.create({ name: "YT", origin: "youtube", destination: { kind: "liked" }, tracks: [{ title: "Song", artists: ["Artist"], track }] });
    expect(job.status).toBe("review");
    expect(catalog.searches).toEqual([]);
  });

  it("picks up unfinished imports after a restart", async () => {
    const paused = new ImportManager(db, library, new Matcher(db, catalog), 0);
    const job = paused.create({ name: "Later", origin: "spotify", destination: { kind: "liked" }, tracks: [src("Blinding Lights", "The Weeknd", 200)] });
    expect(paused.get(job.id).status).toBe("matching");
    paused.dispose();
    manager.resume();
    await settled(job.id);
    expect(manager.get(job.id).items[0].status).toBe("matched");
  });

  it("removes an import and its songs", async () => {
    const job = manager.create({ name: "Gone", origin: "csv", destination: { kind: "liked" }, tracks: [src("Blinding Lights", "The Weeknd")] });
    manager.remove(job.id);
    expect(manager.list()).toEqual([]);
    expect(() => manager.get(job.id)).toThrow();
  });
});

describe("ListeningHistory", () => {
  let db: DatabaseSync;
  let history: ListeningHistory;
  let library: Library;

  beforeEach(() => {
    db = openDatabase(":memory:");
    library = new Library(db);
    history = new ListeningHistory(db, new Matcher(db, fakeCatalog()));
  });
  afterEach(() => db.close());

  const play = (title: string, artist: string, at: string, ms = 200_000, count = 1) => ({ playedAt: at, playedMs: ms, playCount: count, title, artist });

  it("ignores plays it already has", () => {
    const plays = [play("Yellow", "Coldplay", "2021-01-01T10:00:00.000Z"), play("Yellow", "Coldplay", "2021-01-02T10:00:00.000Z")];
    expect(history.add("spotify", plays)).toBe(2);
    expect(history.add("spotify", plays)).toBe(0);
    expect(history.sources()).toEqual([{ origin: "spotify", plays: 2, firstAt: "2021-01-01T10:00:00.000Z", lastAt: "2021-01-02T10:00:00.000Z" }]);
  });

  it("adds up songs across services and Vyse Music's own plays", () => {
    history.add("spotify", [play("STAY (with Justin Bieber)", "The Kid LAROI", "2021-07-01T10:00:00.000Z"), play("Yellow", "Coldplay", "2020-03-01T10:00:00.000Z")]);
    history.add("apple", [play("Stay", "The Kid LAROI, Justin Bieber", "2022-01-01T12:00:00.000Z", 400_000, 2)]);
    library.recordPlay(yt("cccccccccc1", "Stay", "The Kid LAROI", 141), 141_000, new Date("2023-05-05T10:00:00Z"));

    const insights = history.insights();
    expect(insights.totals).toMatchObject({ plays: 5, songs: 2, artists: 2, firstAt: "2020-03-01T10:00:00.000Z" });
    expect(insights.topSongs[0]).toMatchObject({ plays: 4, artist: expect.stringContaining("Kid LAROI") });
    // the Vyse Music play gives the top song a playable track
    expect(insights.topSongs[0].track?.sourceId).toBe("cccccccccc1");
    expect(insights.topArtists[0]).toMatchObject({ name: "The Kid LAROI", plays: 4 });
    expect(insights.years.map((y) => [y.year, y.plays])).toEqual([
      [2020, 1],
      [2021, 1],
      [2022, 2],
      [2023, 1],
    ]);
  });

  it("removes one service's history", () => {
    history.add("spotify", [play("Yellow", "Coldplay", "2021-01-01T10:00:00.000Z")]);
    history.add("youtube", [play("Yellow", "Coldplay", "2021-01-01T11:00:00.000Z")]);
    history.removeOrigin("spotify");
    expect(history.sources().map((s) => s.origin)).toEqual(["youtube"]);
  });
});
