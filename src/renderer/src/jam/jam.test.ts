import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types";
import { addToQueue, emptyQueue, playNext } from "@/player/queue";
import { findCode, makeCode } from "./code";
import { cleanAdd, cleanClock, cleanHello, cleanName, cleanQueue, cleanTrack, shareQueue, shareTrack } from "./protocol";
import { correction, HostClock, MAX_NUDGE, positionAt } from "./timing";

const song = (n: number): Track => ({
  id: `youtube:video${String(n).padStart(6, "0")}`,
  source: "youtube",
  sourceId: `video${String(n).padStart(6, "0")}`,
  title: `Song ${n}`,
  artists: [{ name: "Someone", id: "UC123" }],
  album: { title: "An Album", id: "MPREb_1" },
  durationMs: 200_000,
  artwork: "https://lh3.googleusercontent.com/cover=w544-h544",
});

describe("Jam codes", () => {
  it("makes codes of three groups of four, without look-alike letters", () => {
    for (let i = 0; i < 50; i++) expect(makeCode()).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(new Set(Array.from({ length: 200 }, () => makeCode())).size).toBe(200);
  });

  it("finds a code however it was typed or pasted", () => {
    expect(findCode("K7QM-P3XR-9TWD")).toBe("K7QM-P3XR-9TWD");
    expect(findCode("k7qmp3xr9twd")).toBe("K7QM-P3XR-9TWD");
    expect(findCode("Join my Jam on Vyse Music! Code: k7qm p3xr 9twd 🎶")).toBe("K7QM-P3XR-9TWD");
    expect(findCode("K7QM-P3XR")).toBeNull();
    expect(findCode("K0QM-P3XR-9TWD")).toBeNull();
    expect(findCode("")).toBeNull();
  });
});

describe("Jam messages", () => {
  it("rebuilds a song from what it knows, and nothing else", () => {
    const sent = { ...song(1), gainDb: -3, extra: "<img onerror=…>" };
    expect(cleanTrack(sent)).toEqual(song(1));
  });

  it("refuses songs that aren't songs", () => {
    expect(cleanTrack(null)).toBeNull();
    expect(cleanTrack({ ...song(1), sourceId: "../../etc/passwd" })).toBeNull();
    expect(cleanTrack({ ...song(1), source: "spotify" })).toBeNull();
    expect(cleanTrack({ ...song(1), title: "   " })).toBeNull();
    expect(cleanTrack({ ...song(1), durationMs: Infinity })).toBeNull();
  });

  it("only takes cover art from YouTube's image servers", () => {
    expect(cleanTrack({ ...song(1), artwork: "https://tracker.example.com/pixel.png" })?.artwork).toBeUndefined();
    expect(cleanTrack({ ...song(1), artwork: "http://lh3.googleusercontent.com/x" })?.artwork).toBeUndefined();
    expect(cleanTrack({ ...song(1), artwork: "https://i.ytimg.com/vi/x/hq.jpg" })?.artwork).toBe("https://i.ytimg.com/vi/x/hq.jpg");
  });

  it("shares a song file's name but not where it is on the host's computer", () => {
    const file: Track = { id: "local:C:\\Users\\sam\\Music\\a.flac", source: "local", sourceId: "C:\\Users\\sam\\Music\\a.flac", title: "A", artists: [{ name: "B" }], durationMs: 1000, gainDb: -2 };
    const shared = shareTrack(file);
    expect(JSON.stringify(shared)).not.toContain("sam");
    expect(shared).toMatchObject({ source: "local", title: "A", artists: [{ name: "B" }] });
    expect(shareTrack(file).id).toBe(shared.id);
    expect(cleanTrack(shared)).toEqual(shared);
  });

  it("cleans names", () => {
    expect(cleanName("  Sam\u202e  \n Rao ")).toBe("Sam Rao");
    expect(cleanName("")).toBe("Someone");
    expect(cleanName("x".repeat(100))).toHaveLength(32);
  });

  it("shares a window of the queue round the current song, and reads it back", () => {
    let queue = addToQueue(emptyQueue, Array.from({ length: 400 }, (_, i) => song(i)));
    queue = { ...queue, index: 100 };
    queue = playNext(queue, [song(999)], "Alex");
    const shared = shareQueue(queue.items, queue.index);
    expect(shared.items).toHaveLength(161);
    expect(shared.current).toBe(queue.items[100].uid);
    expect(shared.items[11]).toMatchObject({ by: "Alex", track: { title: "Song 999" } });
    const back = cleanQueue(JSON.parse(JSON.stringify(shared)));
    expect(back).toEqual(shared);
  });

  it("drops broken queue entries but keeps the rest", () => {
    const shared = shareQueue(addToQueue(emptyQueue, [song(1), song(2)]).items, 0);
    const broken = { ...shared, items: [shared.items[0], { uid: "bad uid!", track: song(3) }, { uid: shared.items[0].uid, track: song(4) }, shared.items[1]] };
    expect(cleanQueue(broken)?.items.map((i) => i.track.title)).toEqual(["Song 1", "Song 2"]);
    expect(cleanQueue({ ...shared, current: "elsewhere" })?.current).toBeNull();
  });

  it("checks clocks, hellos and songs to add", () => {
    expect(cleanClock({ uid: "q1", position: 12.5, playing: true, rate: 1, keepPitch: true, at: 1_700_000_000_000 })).toMatchObject({ position: 12.5, playing: true });
    expect(cleanClock({ uid: "q1", position: -1, playing: true, rate: 1, at: 1 })).toBeNull();
    expect(cleanClock({ uid: "q1", position: 1, playing: true, rate: 40, at: 1 })).toBeNull();
    expect(cleanHello({ v: 1, name: "Sam", host: "yes" })).toEqual({ v: 1, name: "Sam", host: false });
    // a guest can't send song files, which only play on their own computer
    const file = shareTrack({ id: "local:x", source: "local", sourceId: "x", title: "F", artists: [], durationMs: 1 });
    expect(cleanAdd({ tracks: [song(1), file], next: true })).toEqual({ tracks: [song(1)], next: true });
    expect(cleanAdd({ tracks: [file] })).toBeNull();
    expect(cleanAdd({ tracks: Array.from({ length: 80 }, (_, i) => song(i)) })?.tracks).toHaveLength(50);
  });
});

describe("Jam timing", () => {
  it("works out where the host is now", () => {
    expect(positionAt({ position: 10, at: 1000, playing: true, rate: 1 }, 3500)).toBeCloseTo(12.5);
    expect(positionAt({ position: 10, at: 1000, playing: true, rate: 1.25 }, 3000)).toBeCloseTo(12.5);
    expect(positionAt({ position: 10, at: 1000, playing: false, rate: 1 }, 9000)).toBe(10);
  });

  it("jumps when far off, catches up gently when close, and leaves it when in time", () => {
    expect(correction(30, 28)).toEqual({ kind: "seek", to: 30 });
    expect(correction(30, 30.01)).toEqual({ kind: "nudge", rate: 1 });
    const behind = correction(30, 29.85);
    expect(behind.kind === "nudge" && behind.rate).toBeGreaterThan(1);
    const ahead = correction(30, 30.3);
    expect(ahead.kind === "nudge" && ahead.rate).toBeLessThan(1);
    const far = correction(30, 29.45);
    expect(far.kind === "nudge" && far.rate).toBeCloseTo(1 + MAX_NUDGE);
  });

  it("learns the host's clock from the quickest ping", () => {
    const clock = new HostClock();
    expect(clock.ready).toBe(false);
    // the host's clock is 5 s ahead; trips take 40 ms, one slow one 900 ms each way
    clock.add(1000, 6020, 1040);
    clock.add(2000, 7900, 3800);
    expect(clock.ready).toBe(true);
    expect(clock.offset).toBe(5000);
    expect(clock.roundTrip).toBe(40);
    expect(clock.now(10_000)).toBe(15_000);
    // replies that can't be right are ignored
    clock.add(5000, 9000, 4000);
    expect(clock.offset).toBe(5000);
  });
});
