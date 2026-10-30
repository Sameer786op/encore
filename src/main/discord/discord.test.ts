import { describe, expect, it } from "vitest";
import type { NowPlaying, Track } from "@shared/types";
import { buildActivity, presenceKey } from "./presence";
import { decodeFrames, encodeFrame } from "./rpc";

const track: Track = {
  id: "youtube:J7p4bzqLvCw",
  source: "youtube",
  sourceId: "J7p4bzqLvCw",
  title: "Blinding Lights",
  artists: [{ name: "The Weeknd" }],
  album: { title: "After Hours" },
  durationMs: 200_000,
  artwork: "https://lh3.googleusercontent.com/abc=w544-h544",
};

const playing = (over: Partial<NowPlaying> = {}): NowPlaying => ({ track, playing: true, position: 30, duration: 200, liked: false, at: 1_000_000, ...over });

describe("Discord frames", () => {
  it("round-trips frames, including split ones", () => {
    const a = encodeFrame(1, { cmd: "SET_ACTIVITY" });
    const b = encodeFrame(3, { ping: true });
    const joined = Buffer.concat([a, b]);
    const first = decodeFrames(joined.subarray(0, a.length + 5));
    expect(first.frames).toEqual([{ op: 1, data: { cmd: "SET_ACTIVITY" } }]);
    const second = decodeFrames(Buffer.concat([first.rest, joined.subarray(a.length + 5)]));
    expect(second.frames).toEqual([{ op: 3, data: { ping: true } }]);
    expect(second.rest.length).toBe(0);
  });
});

describe("Discord presence", () => {
  it("shows the song as Listening with a progress bar and a link", () => {
    const activity = buildActivity(playing(), { showWhenPaused: false }, 1_000_000);
    expect(activity).toMatchObject({
      type: 2,
      details: "Blinding Lights",
      state: "The Weeknd",
      assets: { large_image: track.artwork, large_text: "After Hours" },
      timestamps: { start: 1_000_000 - 30_000, end: 1_000_000 - 30_000 + 200_000 },
      buttons: [{ label: "Listen on YouTube Music", url: "https://music.youtube.com/watch?v=J7p4bzqLvCw" }],
    });
  });

  it("clears the status when paused unless asked to keep it", () => {
    expect(buildActivity(playing({ playing: false }), { showWhenPaused: false })).toBeNull();
    const paused = buildActivity(playing({ playing: false }), { showWhenPaused: true });
    expect(paused).toMatchObject({ assets: { small_text: "Paused" } });
    expect(paused?.timestamps).toBeUndefined();
    expect(buildActivity(playing({ track: null }), { showWhenPaused: true })).toBeNull();
  });

  it("leaves out local cover art and pads one-letter names", () => {
    const local: Track = { ...track, id: "local:x", source: "local", sourceId: "x", artwork: "encore-media://art/x.jpg", artists: [{ name: "X" }] };
    const activity = buildActivity(playing({ track: local }), { showWhenPaused: false })!;
    expect((activity.assets as Record<string, unknown>).large_image).toBeUndefined();
    expect(activity.state).toBe("X ");
    expect(activity.buttons).toBeUndefined();
  });

  it("only changes when the song, play state or position jumps", () => {
    const base = playing();
    const key = presenceKey(base, 1_000_000);
    // two seconds later while still playing: the same
    expect(presenceKey({ ...base, position: 32, at: 1_002_000 }, 1_002_000)).toBe(key);
    // a seek far ahead
    expect(presenceKey({ ...base, position: 120, at: 1_002_000 }, 1_002_000)).not.toBe(key);
    expect(presenceKey({ ...base, playing: false }, 1_000_000)).not.toBe(key);
    expect(presenceKey({ ...base, jam: true }, 1_000_000)).not.toBe(key);
  });

  it("says when you're in a Jam, without saying whose", () => {
    expect(buildActivity(playing({ jam: true }), { showWhenPaused: false })?.state).toBe("The Weeknd · in a Jam");
    const long = buildActivity(playing({ jam: true, track: { ...track, artists: [{ name: "A".repeat(200) }] } }), { showWhenPaused: false });
    expect(long?.state).toHaveLength(128);
    expect(long?.state).toMatch(/ · in a Jam$/);
  });
});
