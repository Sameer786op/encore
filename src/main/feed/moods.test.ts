import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types";
import { moodById } from "@shared/moods";
import { assembleMoodMix, describeMood, pickSeeds, type TaggedSong } from "./moods";
import { seededRandom } from "./taste";

const track = (id: string, artist = `Artist ${id}`, durationMs = 200_000): Track => ({
  id: `youtube:${id}`,
  source: "youtube",
  sourceId: id,
  title: `Song ${id}`,
  artists: [{ name: artist }],
  durationMs,
});

const chill = moodById("chill");
const songs: TaggedSong[] = [
  { track: track("party1"), tags: ["Party", "Upbeat"] },
  { track: track("calm1"), tags: ["Chill", "Romance"] },
  { track: track("party2"), tags: ["Pump-up"] },
  { track: track("calm2"), tags: ["Chill"] },
  { track: track("sad1"), tags: ["Downbeat"] },
];

describe("pickSeeds", () => {
  it("starts from your songs that suit the mood", () => {
    const seeds = pickSeeds(songs, chill, seededRandom("a"), 2);
    expect(seeds.map((t) => t.sourceId).sort()).toEqual(["calm1", "calm2"]);
  });

  it("fills up from your other top songs, since any song can be tuned", () => {
    const seeds = pickSeeds(songs, chill, seededRandom("a"));
    expect(seeds).toHaveLength(3);
    expect(seeds.slice(0, 2).map((t) => t.sourceId).sort()).toEqual(["calm1", "calm2"]);
    expect(pickSeeds(songs, moodById("sleep"), seededRandom("a"))).toHaveLength(3);
  });

  it("picks the same seeds for the same day and mood", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ track: track(`c${i}`), tags: ["Chill"] }));
    const ids = (seed: string) => pickSeeds(many, chill, seededRandom(seed)).map((t) => t.id);
    expect(ids("day:chill:0")).toEqual(ids("day:chill:0"));
    expect(ids("day:chill:0")).not.toEqual(ids("day:chill:1"));
  });
});

describe("assembleMoodMix", () => {
  const radio = (name: string, count = 25) => Array.from({ length: count }, (_, i) => track(`${name}${i}`, `${name} artist ${i % 6}`));
  const yours = [track("mine1", "Me A"), track("mine2", "Me B"), track("mine3", "Me C")];

  it("opens with one of your songs and mixes the radios in", () => {
    const mix = assembleMoodMix({ yours, radios: [radio("a"), radio("b"), radio("c")] }, seededRandom("x"));
    expect(mix).toHaveLength(40);
    expect(mix[0].sourceId).toMatch(/^mine/);
    expect(mix.filter((t) => t.sourceId.startsWith("mine"))).toHaveLength(3);
    for (const name of ["a", "b", "c"]) expect(mix.some((t) => t.sourceId.startsWith(name))).toBe(true);
  });

  it("has no repeats, nothing over 12 minutes, and no artist twice in a row", () => {
    const repeated = [track("a0", "a artist 0"), track("dup", "Someone"), track("dup-again", "Someone")];
    repeated[2].title = repeated[1].title;
    const long = track("hour", "DJ", 60 * 60_000);
    const mix = assembleMoodMix({ yours, radios: [[...repeated, long, ...radio("a")], radio("b")] }, seededRandom("y"));
    expect(new Set(mix.map((t) => t.id)).size).toBe(mix.length);
    expect(mix.filter((t) => t.title === "Song dup")).toHaveLength(1);
    expect(mix.some((t) => t.id === long.id)).toBe(false);
    for (let i = 1; i < mix.length; i++) expect(mix[i].artists[0].name).not.toBe(mix[i - 1].artists[0].name);
  });

  it("stops short rather than repeat when there isn't enough", () => {
    expect(assembleMoodMix({ yours: [], radios: [radio("a", 5)] }, seededRandom("z"))).toHaveLength(5);
    expect(assembleMoodMix({ yours: [], radios: [] }, seededRandom("z"))).toEqual([]);
  });
});

describe("describeMood", () => {
  it("names a couple of the songs it started from", () => {
    expect(describeMood(chill, [track("1"), track("2"), track("3")])).toBe("Chill songs like Song 1 and Song 2");
    expect(describeMood(chill, [])).toBe("Chill picks from YouTube Music");
  });

  it("doesn't call your songs chill when they were only the starting point", () => {
    const calm = track("calm");
    expect(describeMood(chill, [track("loud"), calm, track("louder")], (t) => t === calm)).toBe("Chill songs like Song calm");
    expect(describeMood(chill, [track("loud"), track("louder")], () => false)).toBe("Chill music inspired by Song loud and Song louder");
  });
});
