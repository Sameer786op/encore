import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AlbumSummary, ArtistDetails, ArtistSummary, ReleaseItem, Track } from "@shared/types";
import { openDatabase } from "../db";
import { ListeningHistory } from "../history/history";
import { Library } from "../library/library";
import { Matcher } from "../matching/matcher";
import { FeedService, type FeedCatalog } from "./service";

let n = 0;
const yt = (title: string, artist: string, artistId: string): Track => ({
  id: `youtube:v${String(n).padStart(9, "0")}${n++}`.slice(0, 20),
  source: "youtube",
  sourceId: `v${String(n++).padStart(10, "0")}`,
  title,
  artists: [{ name: artist, id: artistId }],
  durationMs: 200_000,
});

const ARTISTS: Record<string, { id: string; related: string[]; albums: AlbumSummary[] }> = {
  "The Weeknd": { id: "UCweeknd", related: ["UCdualipa"], albums: [{ id: "MPREb_ah", title: "After Hours", artists: [], year: "2020" }] },
  "Dua Lipa": { id: "UCdualipa", related: ["UCweeknd"], albums: [{ id: "MPREb_fn", title: "Future Nostalgia", artists: [], year: "2020" }] },
  Coldplay: { id: "UCcoldplay", related: [], albums: [{ id: "MPREb_mos", title: "Moon Music", artists: [], year: "2026" }] },
};

function fakeCatalog(): FeedCatalog & { releases: Record<string, AlbumSummary[]> } {
  const releases: Record<string, AlbumSummary[]> = Object.fromEntries(Object.values(ARTISTS).map((a) => [a.id, [...a.albums]]));
  return {
    releases,
    async searchArtists(query) {
      const entry = Object.entries(ARTISTS).find(([name]) => name.toLowerCase() === query.toLowerCase());
      return entry ? [{ id: entry[1].id, name: entry[0], artwork: `https://lh3.googleusercontent.com/${entry[1].id}` }] : [];
    },
    async artist(id): Promise<ArtistDetails> {
      const [name, entry] = Object.entries(ARTISTS).find(([, a]) => a.id === id)!;
      return {
        id,
        name,
        topTracks: Array.from({ length: 8 }, (_, i) => yt(`${name} hit ${i}`, name, id)),
        albums: releases[id],
        singles: [],
        related: entry.related.map((r) => ({ id: r, name: r })),
      };
    },
    async radio(seed) {
      return Array.from({ length: 10 }, (_, i) => yt(`Like ${seed.title} ${i}`, `Radio artist ${i}`, `UCradio${i}`));
    },
  };
}

describe("FeedService", () => {
  let db: DatabaseSync;
  let library: Library;
  let catalog: ReturnType<typeof fakeCatalog>;
  let notify: Mock<(releases: ReleaseItem[]) => void>;
  let feed: FeedService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    library = new Library(db);
    catalog = fakeCatalog();
    notify = vi.fn();
    const matcher = new Matcher(db, { searchSongs: async () => [], trackById: async () => Promise.reject(new Error("no")) });
    feed = new FeedService(db, library, matcher, catalog, notify);
    const history = new ListeningHistory(db, matcher);
    const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    // plenty of The Weeknd and Dua Lipa lately, Coldplay a while ago
    history.add("spotify", [
      ...Array.from({ length: 6 }, (_, i) => ({ playedAt: day(i + 1), playedMs: 200_000, playCount: 1, title: "Blinding Lights", artist: "The Weeknd", videoId: "J7p4bzqLvCw" })),
      ...Array.from({ length: 4 }, (_, i) => ({ playedAt: day(i + 2), playedMs: 200_000, playCount: 1, title: "Levitating", artist: "Dua Lipa", videoId: "TUVcZfQe-Kw" })),
      ...Array.from({ length: 5 }, (_, i) => ({ playedAt: day(200 + i), playedMs: 200_000, playCount: 1, title: "Yellow", artist: "Coldplay", videoId: "yKNxeF4KMsY" })),
    ]);
  });

  afterEach(() => {
    feed.dispose();
    db.close();
  });

  it("builds mixes, top artists, on-repeat and forgotten favourites from history", async () => {
    await feed.refresh();
    const home = feed.get()!;
    expect(home.hasHistory).toBe(true);
    expect(home.topArtists.map((a) => a.name)).toEqual(["The Weeknd", "Dua Lipa", "Coldplay"]);
    // the two related artists share a mix; Coldplay gets its own
    expect(home.mixes.map((m) => m.description)).toEqual(["The Weeknd and Dua Lipa", "Coldplay and similar artists"]);
    const first = home.mixes[0].tracks;
    expect(first.length).toBeGreaterThanOrEqual(20);
    expect(first.some((t) => t.title === "Blinding Lights")).toBe(true);
    expect(first.some((t) => t.title.startsWith("Like "))).toBe(true);
    expect(home.onRepeat.map((t) => t.title)).toEqual(["Blinding Lights", "Levitating"]);
    expect(home.rediscover.map((t) => t.title)).toEqual(["Yellow"]);
  });

  it("keeps a day's mixes the same when rebuilt", async () => {
    await feed.refresh();
    const once = feed.get()!.mixes[0].tracks.map((t) => t.title);
    await feed.refresh();
    expect(feed.get()!.mixes[0].tracks.map((t) => t.title)).toEqual(once);
  });

  it("treats existing releases as a baseline and alerts about later ones", async () => {
    await feed.refresh();
    const artists: ArtistSummary[] = [{ id: "UCweeknd", name: "The Weeknd" }, { id: "UCcoldplay", name: "Coldplay" }];
    expect(await feed.checkReleases(artists)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    // this year's baseline releases still show on the home page
    expect(feed.get()!.newReleases.map((r) => [r.album.title, r.isNew])).toEqual([["Moon Music", false]]);

    catalog.releases.UCweeknd.unshift({ id: "MPREb_new", title: "Hurry Up Tomorrow", artists: [], year: String(new Date().getFullYear()) });
    db.prepare("DELETE FROM artist_info").run();
    const fresh = await feed.checkReleases(artists);
    expect(fresh.map((r) => r.album.title)).toEqual(["Hurry Up Tomorrow"]);
    expect(notify).toHaveBeenCalledOnce();
    expect(feed.get()!.newReleases[0]).toMatchObject({ isNew: true, album: { title: "Hurry Up Tomorrow" } });
  });

  it("lets you follow an artist and turn alerts off", async () => {
    feed.follow({ id: "UCdualipa", name: "Dua Lipa" }, true);
    expect(feed.isFollowing("UCdualipa")).toBe(true);
    feed.follow({ id: "UCdualipa", name: "Dua Lipa" }, false);
    expect(feed.isFollowing("UCdualipa")).toBe(false);

    feed.setNotifications(false);
    await feed.checkReleases([{ id: "UCweeknd", name: "The Weeknd" }]);
    catalog.releases.UCweeknd.unshift({ id: "MPREb_x", title: "Surprise", artists: [], year: "2026" });
    db.prepare("DELETE FROM artist_info").run();
    expect(await feed.checkReleases([{ id: "UCweeknd", name: "The Weeknd" }])).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("builds again when history arrives while a build is running", async () => {
    const saved = db.prepare("SELECT * FROM imported_plays").all();
    db.prepare("DELETE FROM imported_plays").run();
    // an empty build starts, then the history import lands mid-way
    const first = feed.refresh();
    const insert = db.prepare(`INSERT INTO imported_plays (${Object.keys(saved[0]).join(", ")}) VALUES (${Object.keys(saved[0]).map(() => "?").join(", ")})`);
    for (const row of saved) insert.run(...(Object.values(row) as never[]));
    const second = feed.refresh();
    await Promise.all([first, second]);
    expect(feed.get()!.hasHistory).toBe(true);
  });

  it("has an empty but valid feed with no history", async () => {
    db.prepare("DELETE FROM imported_plays").run();
    await feed.refresh();
    const home = feed.get()!;
    expect(home).toMatchObject({ hasHistory: false, mixes: [], topArtists: [], onRepeat: [] });
  });
});
