import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AlbumSummary, ArtistDetails, ArtistSummary, HomeFeed, ReleaseItem, Track } from "@shared/types";
import { trackId } from "@shared/types";
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

/** the tuning chips YouTube Music offers for each song in the history below */
const SONG_MOODS: Record<string, string[]> = {
  J7p4bzqLvCw: ["Party", "Upbeat", "2020s"],
  "TUVcZfQe-Kw": ["Party", "Pump-up"],
  yKNxeF4KMsY: ["Chill", "Romance", "2000s"],
};

function fakeCatalog(): FeedCatalog & { releases: Record<string, AlbumSummary[]>; moodLookups: string[] } {
  const releases: Record<string, AlbumSummary[]> = Object.fromEntries(Object.values(ARTISTS).map((a) => [a.id, [...a.albums]]));
  const moodLookups: string[] = [];
  const song = (id: string, title: string, artist: string): Track => ({ id: trackId("youtube", id), source: "youtube", sourceId: id, title, artists: [{ name: artist }], durationMs: 200_000 });
  return {
    releases,
    moodLookups,
    async songMoods(videoId) {
      moodLookups.push(videoId);
      return SONG_MOODS[videoId] ?? [];
    },
    // like YouTube Music's, a tuned radio opens with the song it started from
    async moodRadio(videoId, code) {
      return [song(videoId, `Seed ${videoId}`, "Seed artist"), ...Array.from({ length: 24 }, (_, i) => song(`${code}-${videoId}-${i}`, `${code} pick ${videoId} ${i}`, `Tuned artist ${i % 7}`))];
    },
    async moodPlaylists(page) {
      return ["PL1", "PL2", "PL3"].map((id) => ({ id, title: `${page} ${id}` }));
    },
    async playlist(id) {
      return { name: id, tracks: Array.from({ length: 30 }, (_, i) => song(`${id}-${i}`, `${id} song ${i}`, `Playlist artist ${i % 9}`)) };
    },
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

  describe("mood mixes", () => {
    it("weaves your songs that suit the mood with radios tuned to it", async () => {
      const mix = await feed.moodMix("chill");
      expect(mix).toMatchObject({ id: "mood-chill", title: "Chill Mix", mood: "chill" });
      expect(mix.description).toMatch(/^Chill songs like Yellow/);
      expect(mix.tracks.length).toBeGreaterThanOrEqual(20);
      expect(mix.tracks[0].title).toBe("Yellow");
      expect(mix.tracks.filter((t) => t.title.startsWith("mXv pick")).length).toBeGreaterThan(15);
      // your songs that don't suit it stay out, even when a radio started from them
      expect(mix.tracks.some((t) => ["Blinding Lights", "Levitating"].includes(t.title) || t.title.startsWith("Seed "))).toBe(false);
      expect(mix.artists.map((a) => a.name)).toContain("Coldplay");
    });

    it("keeps the day's mix, and makes a different one when asked", async () => {
      const liked = Array.from({ length: 8 }, (_, i) => yt(`Calm ${i}`, `Calm artist ${i}`, `UCcalm${i}`));
      for (const t of liked) {
        library.setLiked(t, true);
        SONG_MOODS[t.sourceId] = ["Chill"];
      }
      const first = await feed.moodMix("chill");
      expect((await feed.moodMix("chill")).tracks).toEqual(first.tracks);
      const again = await feed.moodMix("chill", true);
      expect(again.tracks.map((t) => t.id)).not.toEqual(first.tracks.map((t) => t.id));
      expect(again.tracks.length).toBeGreaterThanOrEqual(20);
    });

    it("says when a mix was only inspired by your songs", async () => {
      // none of the history is tagged Focus, so the radios start from your top songs
      const mix = await feed.moodMix("focus");
      expect(mix.description).toMatch(/^Focus music inspired by /);
      expect(mix.tracks.filter((t) => t.title.startsWith("mav pick")).length).toBeGreaterThan(15);
    });

    it("looks up each song's moods once", async () => {
      await feed.moodMix("chill");
      const lookups = catalog.moodLookups.length;
      expect(lookups).toBe(3);
      await feed.moodMix("energize");
      await feed.moodMix("chill", true);
      expect(catalog.moodLookups).toHaveLength(lookups);
    });

    it("uses YouTube Music's own playlists for the mood before anything is played", async () => {
      db.prepare("DELETE FROM imported_plays").run();
      const mix = await feed.moodMix("sleep");
      expect(mix.description).toBe("Sleep picks from YouTube Music");
      expect(mix.artists).toEqual([]);
      expect(mix.tracks.length).toBeGreaterThanOrEqual(20);
      expect(mix.tracks.every((t) => /^PL\d song/.test(t.title))).toBe(true);
    });

    it("comes with the home feed for the rest of the day, newest first", async () => {
      await feed.refresh();
      const seen: HomeFeed[] = [];
      feed.onChange((f) => seen.push(f));
      await feed.moodMix("focus");
      await feed.moodMix("warm");
      expect(seen.at(-1)!.moodMixes!.map((m) => m.id)).toEqual(["mood-warm", "mood-focus"]);
      expect(feed.get()!.moodMixes!.map((m) => m.id)).toEqual(["mood-warm", "mood-focus"]);
      // a rebuilt home page keeps them
      await feed.refresh();
      expect(seen.at(-1)!.moodMixes).toHaveLength(2);
      // yesterday's are gone
      db.prepare("UPDATE feed_cache SET data = replace(data, ?, '1999-01-01') WHERE key LIKE 'mood:%'").run(feed.get()!.day);
      expect(feed.get()!.moodMixes).toEqual([]);
    });
  });
});
