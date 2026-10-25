import { describe, expect, it } from "vitest";
import type { AlbumSummary, Track } from "@shared/types";
import { assembleMix, describeMix, groupArtists, type MixArtist } from "./mixes";
import { diffReleases, releasesForFeed, type SeenRelease } from "./releases";
import { buildTaste, forgottenFavourites, onRepeat, recencyWeight, seededRandom, shuffle } from "./taste";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const play = (title: string, artist: string, days: number, count = 1) => ({ title, artist, playedAt: daysAgo(days), count });
const track = (id: string, artist: string, title = id): Track => ({ id: `youtube:${id}`, source: "youtube", sourceId: id, title, artists: [{ name: artist, id: `UC${artist}` }], durationMs: 200_000 });

describe("taste", () => {
  it("halves the weight of a play every 60 days", () => {
    expect(recencyWeight(daysAgo(0), NOW)).toBeCloseTo(1);
    expect(recencyWeight(daysAgo(60), NOW)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(120), NOW)).toBeCloseTo(0.25);
  });

  it("ranks what you play lately above what you played a lot long ago", () => {
    const taste = buildTaste([play("Old Hit", "Old Band", 400, 30), play("New Hit", "New Band", 2, 4)], [], NOW);
    expect(taste.artists[0].name).toBe("New Band");
    expect(taste.artists[1].totalPlays).toBe(30);
  });

  it("merges an artist across featuring credits and counts likes", () => {
    const taste = buildTaste(
      [play("Stay", "The Kid LAROI, Justin Bieber", 1), play("Without You", "The Kid LAROI", 3)],
      [track("liked1", "Adele", "Hello")],
      NOW,
    );
    expect(taste.artists.map((a) => a.name)).toEqual(["Adele", "The Kid LAROI"]);
    expect(taste.artists[1].totalPlays).toBe(2);
    expect(taste.songs.find((s) => s.title === "Hello")?.track?.sourceId).toBe("liked1");
  });

  it("finds songs on repeat and forgotten favourites", () => {
    const taste = buildTaste([play("Loop", "A", 1, 5), play("Once", "B", 1), play("Classic", "C", 200, 12)], [], NOW);
    expect(onRepeat(taste).map((s) => s.title)).toEqual(["Loop"]);
    expect(forgottenFavourites(taste, NOW).map((s) => s.title)).toEqual(["Classic"]);
  });

  it("makes the same random choices for the same day", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], seededRandom("2026-10-24:1"));
    const b = shuffle([1, 2, 3, 4, 5, 6], seededRandom("2026-10-24:1"));
    const c = shuffle([1, 2, 3, 4, 5, 6], seededRandom("2026-10-25:1"));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });
});

describe("daily mixes", () => {
  const artist = (id: string, score: number): MixArtist => ({ id, name: id, score });

  it("groups similar artists around your favourites", () => {
    const rel = new Map([
      ["weeknd", new Set(["dualipa", "bruno"])],
      ["coldplay", new Set(["keane"])],
    ]);
    const groups = groupArtists([artist("weeknd", 10), artist("coldplay", 8), artist("dualipa", 5), artist("keane", 4), artist("bruno", 3), artist("solo", 2)], rel, 5);
    expect(groups.map((g) => g.map((a) => a.id))).toEqual([["weeknd", "dualipa", "bruno"], ["coldplay", "keane"], ["solo"]]);
  });

  it("stops at the number of mixes asked for", () => {
    const groups = groupArtists(["a", "b", "c", "d"].map((id, i) => artist(id, 10 - i)), new Map(), 2);
    expect(groups).toHaveLength(2);
  });

  it("weaves favourites, popular songs and discoveries without repeats or back-to-back artists", () => {
    const favourites = Array.from({ length: 12 }, (_, i) => track(`f${i}`, i % 2 ? "A" : "B"));
    const popular = Array.from({ length: 8 }, (_, i) => track(`p${i}`, "C"));
    const discoveries = [...Array.from({ length: 8 }, (_, i) => track(`d${i}`, `D${i}`)), favourites[0]];
    const mix = assembleMix({ favourites, popular, discoveries }, seededRandom("x"), 25);
    expect(mix).toHaveLength(25);
    expect(new Set(mix.map((t) => t.id)).size).toBe(25);
    for (let i = 1; i < mix.length; i++) expect(mix[i].artists[0].name).not.toBe(mix[i - 1].artists[0].name);
    const fromFavourites = mix.filter((t) => t.sourceId.startsWith("f")).length;
    expect(fromFavourites).toBeGreaterThanOrEqual(8);
  });

  it("still fills a mix when everything is by one artist", () => {
    const only = Array.from({ length: 6 }, (_, i) => track(`s${i}`, "Solo"));
    expect(assembleMix({ favourites: only, popular: [], discoveries: [] }, seededRandom("y"), 10)).toHaveLength(6);
  });

  it("names a mix after its artists", () => {
    expect(describeMix([{ id: "1", name: "Adele" }])).toBe("Adele and similar artists");
    expect(describeMix([{ id: "1", name: "A" }, { id: "2", name: "B" }, { id: "3", name: "C" }])).toBe("A, B and more");
  });
});

describe("new releases", () => {
  const album = (id: string, year: string): AlbumSummary => ({ id, title: id, artists: [], year });
  const weeknd = { id: "UCweeknd", name: "The Weeknd" };

  it("treats what's already out on the first look as baseline, and later arrivals as new", () => {
    const first = diffReleases(weeknd, [album("a1", "2020"), album("a2", "2026")], new Set(), true);
    expect(first.every((r) => r.baseline)).toBe(true);
    const later = diffReleases(weeknd, [album("a3", "2026"), album("a1", "2020")], new Set(["a1", "a2"]), false);
    expect(later.map((r) => [r.album.id, r.baseline])).toEqual([["a3", false]]);
  });

  it("shows new releases first, then this year's, never old baseline ones", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const seen: SeenRelease[] = [
      { album: album("old", "2019"), artist: weeknd, firstSeenAt: "2026-09-01T00:00:00Z", baseline: true },
      { album: album("thisYear", "2026"), artist: weeknd, firstSeenAt: "2026-09-01T00:00:00Z", baseline: true },
      { album: album("fresh", "2026"), artist: weeknd, firstSeenAt: "2026-10-20T00:00:00Z", baseline: false },
      { album: album("stale", "2026"), artist: weeknd, firstSeenAt: "2026-06-01T00:00:00Z", baseline: false },
    ];
    const feed = releasesForFeed(seen, new Map([["UCweeknd", 0]]), now);
    expect(feed.map((r) => [r.album.id, r.isNew])).toEqual([
      ["fresh", true],
      ["thisYear", false],
    ]);
  });
});
