import { describe, expect, it } from "vitest";
import { INTERLUDE, isInstrumental, parseLrc } from "./lrc";
import { pickBest } from "./lyrics";

describe("LRC", () => {
  it("reads timestamps in every common form", () => {
    expect(parseLrc("[00:13.13] Yeah\n[00:27.1]I've been tryna call\n[1:02] Short\n[00:30.123] Millis")).toEqual([
      { time: 13.13, text: "Yeah" },
      { time: 27.1, text: "I've been tryna call" },
      { time: 30.123, text: "Millis" },
      { time: 62, text: "Short" },
    ]);
  });

  it("expands lines with several timestamps and sorts them", () => {
    expect(parseLrc("[00:30.00][01:30.00] Chorus\n[01:00.00] Verse").map((l) => [l.time, l.text])).toEqual([
      [30, "Chorus"],
      [60, "Verse"],
      [90, "Chorus"],
    ]);
  });

  it("skips metadata, applies the offset tag and strips word timings", () => {
    const lines = parseLrc("[ar:Someone]\n[ti:Song]\n[offset:+500]\n[00:10.00] <00:10.00>Hello <00:10.50>world");
    expect(lines).toEqual([{ time: 9.5, text: "Hello world" }]);
  });

  it("turns empty lines into a single pause marker", () => {
    const lines = parseLrc("[00:00.00]\n[00:05.00] Start\n[00:20.00]\n[00:20.50]\n[00:30.00] Again");
    expect(lines.map((l) => l.text)).toEqual(["Start", INTERLUDE, "Again"]);
  });

  it("recognises instrumental placeholders", () => {
    expect(isInstrumental([{ time: 0, text: INTERLUDE }])).toBe(true);
    expect(isInstrumental([{ time: 0, text: "(Instrumental)" }])).toBe(true);
    expect(isInstrumental([{ time: 0, text: "Hello" }])).toBe(false);
  });
});

describe("choosing LRCLIB results", () => {
  const track = { title: "Blinding Lights", artists: [{ name: "The Weeknd" }], durationMs: 200_000 };

  it("prefers synced lyrics of the same length", () => {
    const best = pickBest(track, [
      { trackName: "Blinding Lights", artistName: "The Weeknd", duration: 200, plainLyrics: "plain" },
      { trackName: "Blinding Lights", artistName: "The Weeknd", duration: 201, syncedLyrics: "[00:01.00] a", plainLyrics: "a" },
      { trackName: "Blinding Lights (Remix)", artistName: "The Weeknd", duration: 260, syncedLyrics: "[00:01.00] b" },
    ]);
    expect(best?.syncedLyrics).toBe("[00:01.00] a");
  });

  it("ignores other songs and other artists", () => {
    expect(pickBest(track, [{ trackName: "Save Your Tears", artistName: "The Weeknd", duration: 200, syncedLyrics: "x" }])).toBeNull();
    expect(pickBest(track, [{ trackName: "Blinding Lights", artistName: "Some Cover Band", duration: 200, syncedLyrics: "x" }])).toBeNull();
    expect(pickBest(track, [{ trackName: "Blinding Lights", artistName: "The Weeknd", duration: 240, syncedLyrics: "x" }])).toBeNull();
  });
});
