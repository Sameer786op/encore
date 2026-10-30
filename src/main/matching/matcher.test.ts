import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceTrack, Track } from "@shared/types";
import { openDatabase } from "../db";
import { Matcher, type MatchCatalog } from "./matcher";
import { songKey } from "./text";

const yt = (id: string, title: string, artist: string, seconds: number): Track => ({
  id: `youtube:${id}`,
  source: "youtube",
  sourceId: id,
  title,
  artists: [{ name: artist }],
  durationMs: seconds * 1000,
});

// the song search only has covers of One Dance; the video search has the song
const SONGS: Record<string, Track[]> = {
  "One Dance Drake": [yt("karaoke0001", "One Dance (Karaoke Version)", "Karaoke Guru", 199), yt("lullaby0001", "One Dance", "Rockabye Baby!", 177)],
  "One Dance": [],
  "Blinding Lights The Weeknd": [yt("blinding001", "Blinding Lights", "The Weeknd", 202)],
};
const VIDEOS: Record<string, Track[]> = {
  "One Dance Drake": [yt("lyrics00001", "Drake - One Dance (Lyrics) ft. Wizkid & Kyla", "Billion Stars", 175)],
};

function fakeCatalog(withVideos = true): MatchCatalog & { songSearches: string[]; videoSearches: string[] } {
  const songSearches: string[] = [];
  const videoSearches: string[] = [];
  return {
    songSearches,
    videoSearches,
    async searchSongs(query) {
      songSearches.push(query);
      return SONGS[query] ?? [];
    },
    searchVideos: withVideos
      ? async (query) => {
          videoSearches.push(query);
          return VIDEOS[query] ?? [];
        }
      : undefined,
    async trackById(videoId) {
      return yt(videoId, `Title of ${videoId}`, "Someone", 180);
    },
  };
}

const oneDance: SourceTrack = { title: "One Dance", artists: ["Drake", "Wizkid", "Kyla"], durationMs: 173_986 };

describe("Matcher", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDatabase(":memory:");
  });
  afterEach(() => db.close());

  it("finds a song the song search doesn't carry among the videos", async () => {
    const catalog = fakeCatalog();
    const [best] = await new Matcher(db, catalog).candidates(oneDance);
    expect(best.track.sourceId).toBe("lyrics00001");
    expect(best.track.title).toBe("One Dance");
    expect(best.track.artists.map((a) => a.name)).toEqual(["Drake", "Wizkid", "Kyla"]);
    expect(catalog.videoSearches).toEqual(["One Dance Drake"]);
  });

  it("doesn't search videos when the song search already has it", async () => {
    const catalog = fakeCatalog();
    await new Matcher(db, catalog).candidates({ title: "Blinding Lights", artists: ["The Weeknd"], durationMs: 200_040 });
    expect(catalog.videoSearches).toEqual([]);
  });

  it("looks again at a weak guess cached before videos were searched, and keeps the new answer", async () => {
    // what an older version cached: the covers alone, as a bare list
    db.prepare("INSERT INTO match_cache (key, candidates, updated_at) VALUES (?, ?, ?)").run(
      songKey("Drake", "One Dance"),
      JSON.stringify(SONGS["One Dance Drake"]),
      new Date().toISOString(),
    );
    const catalog = fakeCatalog();
    const matcher = new Matcher(db, catalog);
    // places that only read the cache still get the old guess
    expect(matcher.cachedCandidates(oneDance)?.[0].track.sourceId).toBe("lullaby0001");
    expect((await matcher.candidates(oneDance))[0].track.sourceId).toBe("lyrics00001");
    expect(catalog.videoSearches).toHaveLength(1);
    // the new answer is settled: no more searching
    await matcher.candidates(oneDance);
    expect(catalog.videoSearches).toHaveLength(1);
    expect(matcher.cachedCandidates(oneDance)?.[0].track.sourceId).toBe("lyrics00001");
  });

  it("works without a video search", async () => {
    const catalog = fakeCatalog(false);
    const matcher = new Matcher(db, catalog);
    const [best] = await matcher.candidates(oneDance);
    expect(best.track.sourceId).not.toBe("lyrics00001");
    await matcher.candidates(oneDance);
    expect(catalog.songSearches).toHaveLength(2);
  });
});
