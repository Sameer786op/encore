import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types";
import { artistPlays, finishRate, heardToEnd, lastSevenDays, monthMinutes, onRepeat, statsSince, type Play } from "./listeningStats";

// local times, as the stats count days and months the way you would
const NOW = new Date(2026, 9, 27, 15, 0); // Tue 27 Oct 2026, 3 pm
const play = (trackId: string, date: Date, minutes = 3): Play => ({ trackId, playedAt: date.toISOString(), playedMs: minutes * 60_000 });
const track = (id: string, artists: { id?: string; name: string }[] = [{ name: "Someone" }], durationMs = 200_000): Track => ({
  id,
  source: "youtube",
  sourceId: id,
  title: `Song ${id}`,
  artists,
  durationMs,
});

describe("listening stats", () => {
  it("asks for plays from the first of last month", () => {
    expect(statsSince(NOW)).toEqual(new Date(2026, 8, 1));
  });

  it("counts this month's minutes against the same days of last month", () => {
    const plays = [
      play("a", new Date(2026, 9, 2, 10), 60),
      play("a", new Date(2026, 9, 27, 9), 40),
      play("b", new Date(2026, 8, 5, 10), 50), // last month, within the first 27 days
      play("b", new Date(2026, 8, 29, 10), 500), // last month, but later than today's date
    ];
    const stats = monthMinutes(plays, NOW);
    expect(stats.minutes).toBe(100);
    expect(stats.previous).toBe(50);
    expect(stats.change).toBeCloseTo(1);
    expect(monthMinutes([play("a", new Date(2026, 9, 2), 10)], NOW).change).toBeNull();
  });

  it("splits the last 7 days into daytime and night", () => {
    const week = lastSevenDays(
      [
        play("a", new Date(2026, 9, 27, 9), 30), // today, morning
        play("a", new Date(2026, 9, 27, 1), 20), // today, small hours
        play("a", new Date(2026, 9, 23, 21), 90), // Friday night
        play("a", new Date(2026, 9, 20, 12), 999), // 7 days ago: outside
      ],
      NOW,
    );
    expect(week.days).toHaveLength(7);
    expect(week.days[6]).toMatchObject({ dayMs: 30 * 60_000, nightMs: 20 * 60_000 });
    expect(week.days[2]).toMatchObject({ dayMs: 0, nightMs: 90 * 60_000 });
    expect(week.totalMs).toBe(140 * 60_000);
    expect(week.busiest).toEqual(new Date(2026, 9, 23));
    expect(lastSevenDays([], NOW).busiest).toBeNull();
  });

  it("knows a play heard to the end, near enough", () => {
    expect(heardToEnd(170_000, 200_000)).toBe(true);
    expect(heardToEnd(150_000, 200_000)).toBe(false);
    expect(heardToEnd(30_000, 40_000)).toBe(true); // a short song: all but the last 20 s
    expect(heardToEnd(100_000, 0)).toBe(false);
  });

  it("works out a song's finish rate, or nothing for a song never played", () => {
    expect(finishRate([200_000, 190_000, 40_000, 31_000], 200_000)).toEqual({ plays: 4, finished: 2, rate: 0.5 });
    expect(finishRate([], 200_000)).toBeNull();
  });

  it("finds the song on repeat this month, with its plays by day", () => {
    const tracks = [track("a"), track("b")];
    const plays = [
      play("a", new Date(2026, 9, 26, 10), 3.4),
      play("a", new Date(2026, 9, 27, 10), 1),
      play("a", new Date(2026, 9, 27, 11), 3.4),
      play("b", new Date(2026, 9, 20, 10)),
      play("b", new Date(2026, 9, 21, 10)),
      play("a", new Date(2026, 8, 10, 10)), // last month
    ];
    const top = onRepeat(plays, tracks, NOW)!;
    expect(top.track.id).toBe("a");
    expect(top.plays).toBe(3);
    expect(top.previous).toBe(1);
    expect(top.finished).toBe(2);
    expect(top.days).toHaveLength(30);
    expect(top.days[29]).toBe(2);
    expect(top.days[28]).toBe(1);
    // one play isn't "on repeat"
    expect(onRepeat([play("a", new Date(2026, 9, 26))], tracks, NOW)).toBeNull();
  });

  it("counts an artist's plays by id or name, most played songs first", () => {
    const tracks = [track("a", [{ id: "UC1", name: "The Weeknd" }]), track("b", [{ name: "the weeknd" }, { name: "Daft Punk" }]), track("c")];
    const plays = [play("a", new Date(2026, 9, 25)), play("b", new Date(2026, 9, 26)), play("b", new Date(2026, 9, 27, 9)), play("c", new Date(2026, 9, 27)), play("a", new Date(2026, 9, 1))];
    const result = artistPlays(plays, tracks, { id: "UC1", name: "The Weeknd" }, new Date(2026, 9, 21));
    expect(result.plays).toBe(3);
    expect(result.songs).toEqual(["Song b", "Song a"]);
  });
});
