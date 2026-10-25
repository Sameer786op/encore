import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types";
import { dbToGain, fadeCurve, fadeLength, levellingDb, sameAlbum, shouldCrossfade, shouldPreload } from "./transitions";

const track = (id: string, album?: { id?: string; title: string }, artist = "Artist"): Track => ({
  id: `youtube:${id}`,
  source: "youtube",
  sourceId: id,
  title: id,
  artists: [{ name: artist }],
  album,
  durationMs: 200_000,
});

const base = { remaining: 4, crossfadeSeconds: 6, next: track("b"), current: track("a"), crossfadeSameAlbum: false, alreadyStarted: false };

describe("transitions", () => {
  it("starts a crossfade once the song is inside the fade window", () => {
    expect(shouldCrossfade(base)).toBe(true);
    expect(shouldCrossfade({ ...base, remaining: 10 })).toBe(false);
    expect(shouldCrossfade({ ...base, alreadyStarted: true })).toBe(false);
  });

  it("never crossfades when it's off, at the end of the queue, or when repeating one song", () => {
    expect(shouldCrossfade({ ...base, crossfadeSeconds: 0 })).toBe(false);
    expect(shouldCrossfade({ ...base, next: null })).toBe(false);
  });

  it("plays albums straight through unless asked to fade them", () => {
    const album = { id: "MPREb_1", title: "Discovery" };
    const input = { ...base, current: track("a", album), next: track("b", album) };
    expect(shouldCrossfade(input)).toBe(false);
    expect(shouldCrossfade({ ...input, crossfadeSameAlbum: true })).toBe(true);
  });

  it("recognises the same album without ids by title and artist", () => {
    expect(sameAlbum(track("a", { title: "Discovery" }, "Daft Punk"), track("b", { title: "discovery" }, "Daft Punk"))).toBe(true);
    expect(sameAlbum(track("a", { title: "Greatest Hits" }, "Queen"), track("b", { title: "Greatest Hits" }, "ABBA"))).toBe(false);
    expect(sameAlbum(track("a"), track("b"))).toBe(false);
  });

  it("gets the next song ready in time for the fade", () => {
    expect(shouldPreload(25, 0)).toBe(true);
    expect(shouldPreload(31, 0)).toBe(false);
    expect(shouldPreload(0, 0)).toBe(false);
  });

  it("keeps fades shorter than half of either song", () => {
    expect(fadeLength(12, 200, 200)).toBe(12);
    expect(fadeLength(12, 10, 200)).toBe(5);
    expect(fadeLength(12, 0, 0)).toBe(12);
  });

  it("uses an equal-power curve", () => {
    const fadeIn = fadeCurve("in", 5);
    const fadeOut = fadeCurve("out", 5);
    expect(fadeIn[0]).toBeCloseTo(0);
    expect(fadeIn[4]).toBeCloseTo(1);
    expect(fadeOut[0]).toBeCloseTo(1);
    // at every point the combined power is constant
    for (let i = 0; i < 5; i++) expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1);
  });

  it("turns loud songs down and quiet ones up a little", () => {
    expect(levellingDb({ youtubeLoudnessDb: 7.3 })).toBe(-7.3);
    expect(levellingDb({ youtubeLoudnessDb: -10 })).toBe(4);
    expect(levellingDb({ youtubeLoudnessDb: -2 })).toBe(2);
    expect(levellingDb({ replayGainDb: -8 })).toBe(-4);
    expect(levellingDb({ replayGainDb: 9 })).toBe(6);
    expect(levellingDb({})).toBe(0);
    expect(levellingDb({ youtubeLoudnessDb: 30 })).toBe(-15);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
  });
});
