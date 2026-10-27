import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Track } from "@shared/types";
import { useFeed } from "@/feed/store";
import { useLibrary } from "@/library/store";
import { artistPlays, lastSevenDays, monthMinutes, onRepeat, startOfDay, startOfMonth } from "@/lib/listeningStats";
import { useCurrentTrack, usePlayer } from "@/player/store";
import { ArtistPortrait } from "./ArtistPortrait";
import { MixHeadline } from "./MixHeadline";
import { MoodTile } from "./MoodTile";
import { NowPlayingSpecimen } from "./NowPlayingSpecimen";
import { SoundMeters } from "./SoundMeters";
import { MinutesStat, OnRepeatMeter, WeekDots } from "./StatTiles";
import { useHomeStats } from "./hooks";

// The top of Home: a grid of tiles about you and what's playing. A tile with
// nothing real to show stays out, and the others in its row widen to fill it.

type Kind = "specimen" | "portrait" | "minutes" | "mood" | "mix" | "repeat" | "week" | "sound";

interface Row {
  height: number;
  /** each tile and its share of 12 columns */
  items: [Kind, number][];
}

const WIDE: Row[] = [
  { height: 318, items: [["specimen", 8], ["portrait", 4]] },
  { height: 208, items: [["minutes", 3], ["mood", 3], ["mix", 6]] },
  { height: 192, items: [["repeat", 4], ["week", 4], ["sound", 4]] },
];

const NARROW: Row[] = [
  { height: 300, items: [["specimen", 12]] },
  { height: 240, items: [["portrait", 6], ["minutes", 6]] },
  { height: 212, items: [["mood", 5], ["mix", 7]] },
  { height: 192, items: [["repeat", 6], ["week", 6]] },
  { height: 150, items: [["sound", 12]] },
];

/** below this width the tiles rearrange into more, narrower rows */
const NARROW_BELOW = 920;

/** the spans of the tiles that are shown, stretched to fill the row */
export function fillRow(items: [Kind, number][], shown: Set<Kind>): [Kind, number][] {
  const kept = items.filter(([kind]) => shown.has(kind));
  const total = kept.reduce((sum, [, share]) => sum + share, 0);
  let used = 0;
  return kept.map(([kind, share], i) => {
    const span = i === kept.length - 1 ? 12 - used : Math.round((share * 12) / total);
    used += span;
    return [kind, span];
  });
}

export function Bento() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const current = useCurrentTrack();
  const history = useLibrary((s) => s.snapshot.history);
  const feed = useFeed((s) => s.feed);
  const stats = useHomeStats();

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // the songs played last, one each, to pick up from when nothing is queued
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const entry of history) {
      if (seen.has(entry.track.id)) continue;
      seen.add(entry.track.id);
      tracks.push(entry.track);
      if (tracks.length === 16) break;
    }
    return tracks;
  }, [history]);

  const topArtist = feed?.topArtists[0];
  const numbers = useMemo(() => {
    if (!stats) return null;
    const { plays, tracks, now } = stats;
    return {
      month: monthMinutes(plays, now),
      week: lastSevenDays(plays, now),
      repeat: onRepeat(plays, tracks, now),
      artistWeek: topArtist ? artistPlays(plays, tracks, topArtist, startOfDay(now, 6)) : null,
      artistMonth: topArtist ? artistPlays(plays, tracks, topArtist, startOfMonth(now)) : null,
    };
  }, [stats, topArtist]);

  const specimen = current ?? recent[0] ?? null;
  const mix = feed?.mixes[0];
  const shown = new Set<Kind>(["mood"]);
  if (specimen) shown.add("specimen");
  if (topArtist) shown.add("portrait");
  if (numbers && (numbers.month.minutes > 0 || numbers.month.previous > 0)) shown.add("minutes");
  if (mix) shown.add("mix");
  if (numbers?.repeat) shown.add("repeat");
  if (numbers && numbers.week.totalMs > 0) shown.add("week");
  if (current) shown.add("sound");

  const resume = () => usePlayer.getState().playTracks(recent, 0, { kind: "history", label: "Recently played", id: "history" });

  let order = 0;
  const tile = (kind: Kind, height: number): ReactNode => {
    const index = order++;
    switch (kind) {
      case "specimen":
        return specimen && <NowPlayingSpecimen track={specimen} live={!!current} onResume={resume} height={height} index={index} />;
      case "portrait":
        return topArtist && <ArtistPortrait artist={topArtist} playsThisWeek={numbers?.artistWeek?.plays ?? 0} songs={numbers?.artistMonth?.songs ?? []} height={height} index={index} />;
      case "minutes":
        return numbers && <MinutesStat month={numbers.month} faces={feed?.topArtists.slice(0, 3) ?? []} height={height} index={index} />;
      case "mood":
        return <MoodTile height={height} index={index} />;
      case "mix":
        return mix && <MixHeadline mix={mix} height={height} index={index} />;
      case "repeat":
        return numbers?.repeat && <OnRepeatMeter repeat={numbers.repeat} height={height} index={index} />;
      case "week":
        return numbers && <WeekDots week={numbers.week} height={height} index={index} />;
      case "sound":
        return <SoundMeters height={height} index={index} />;
    }
  };

  const rows = width > 0 && width < NARROW_BELOW ? NARROW : WIDE;
  return (
    <div ref={box} className="mt-7 flex flex-col gap-3.5">
      {rows.map((row) => {
        const spans = fillRow(row.items, shown);
        if (spans.length === 0) return null;
        return (
          <div key={row.items.map(([kind]) => kind).join()} className="grid grid-cols-12 gap-3.5" style={{ height: row.height }}>
            {spans.map(([kind, span]) => (
              <div key={kind} className="min-w-0" style={{ gridColumn: `span ${span}` }}>
                {tile(kind, row.height)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
