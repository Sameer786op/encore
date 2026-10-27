import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ArtistSummary } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { CountUp } from "@/components/common";
import type { MonthMinutes, OnRepeat, Week } from "@/lib/listeningStats";
import { usePlayer } from "@/player/store";
import { artAt } from "@/lib/art";
import { artistNames, plural } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Glow, TileHead, Texture, Tile } from "./Tile";

// The small numbers on Home, all from your own plays: minutes this month, the
// song on repeat, and the last seven days as a dot matrix.

const percent = (change: number) => `${Math.round(Math.abs(change) * 100)}%`;

function versus(change: number | null): string {
  if (change === null) return "This month so far";
  if (Math.abs(change) < 0.005) return "Same as last month";
  return `${change > 0 ? "Up" : "Down"} ${percent(change)} on last month`;
}

export function MinutesStat({ month, faces, height, index = 0 }: { month: MonthMinutes; faces: ArtistSummary[]; height: number; index?: number }) {
  const thousands = month.minutes >= 1000;
  return (
    <Tile index={index} label="Minutes you listened this month" className="px-6 py-[22px]" style={{ height }}>
      <Glow className="ember-only" style={{ background: "linear-gradient(160deg, rgb(11 11 12 / 0.55) 40%, rgb(29 29 31 / 0.45) 100%)" }} />
      <Texture words={faces.map((a) => a.name)} corner="left" />
      <div className="flex items-start justify-between gap-3">
        <div className="max-w-[96px] text-[11.5px] font-semibold leading-[1.35] text-ink-2">Minutes you listened this month</div>
        <div className="font-display text-[56px] font-light leading-[0.9] tracking-[-0.05em] tabular-nums">
          <CountUp value={thousands ? month.minutes / 1000 : month.minutes} format={(n) => (thousands ? n.toFixed(1) : Math.round(n).toLocaleString())} />
          {thousands && <sup className="ml-0.5 align-[26px] text-[18px] font-medium tracking-normal text-ink-2">k</sup>}
        </div>
      </div>
      <div className="absolute bottom-[22px] left-6 right-6 flex items-center gap-2.5">
        {faces.length > 0 && (
          <div className="flex shrink-0">
            {faces.slice(0, 3).map((a, i) => (
              <Artwork key={a.id} src={a.artwork ? artAt(a.artwork, 96) : undefined} alt="" className={cn("size-8 rounded-full border-2 border-bg grayscale-[0.2]", i > 0 && "-ml-[9px]")} />
            ))}
          </div>
        )}
        <span className="text-[11.5px] font-semibold leading-[1.3] text-ink-2">{versus(month.change)}</span>
      </div>
    </Tile>
  );
}

/** a bar per day for the last 30 days, as tall as that day's plays, lit along the signature gradient */
function DayBarcode({ days }: { days: number[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const height = 34;
  const most = Math.max(1, ...days);
  const gap = 2;
  const bar = Math.max(2, (width - gap * (days.length - 1)) / days.length);
  return (
    <div ref={box} className="h-[34px]">
      {width > 0 && (
        <svg width={width} height={height} aria-hidden className="block">
          <defs>
            <linearGradient id={`${id}g`} gradientUnits="userSpaceOnUse" x1="0" x2={width} y1="0" y2="0">
              <stop offset="0" stopColor="var(--ramp-1)" />
              <stop offset="0.5" stopColor="var(--ramp-2)" />
              <stop offset="1" stopColor="var(--ramp-3)" />
            </linearGradient>
            <clipPath id={`${id}c`}>
              {days.map((n, i) => {
                const h = n > 0 ? Math.max(8, (n / most) * height) : 0;
                return <rect key={i} x={i * (bar + gap)} y={height - h} width={bar} height={h} rx={1} />;
              })}
            </clipPath>
          </defs>
          {days.map((n, i) => (n === 0 ? <rect key={i} x={i * (bar + gap)} y={height - 4} width={bar} height={4} rx={1} className="fill-white/[0.12]" /> : null))}
          <rect width={width} height={height} fill={`url(#${id}g)`} clipPath={`url(#${id}c)`} />
        </svg>
      )}
    </div>
  );
}

export function OnRepeatMeter({ repeat, height, index = 0 }: { repeat: OnRepeat; height: number; index?: number }) {
  const { track } = repeat;
  const change = repeat.previous > 0 ? (repeat.plays - repeat.previous) / repeat.previous : null;
  const play = () => usePlayer.getState().playTracks([track], 0, { kind: "home", label: "On repeat", id: "feed:on-repeat" });
  return (
    <Tile index={index} label="On repeat" className="flex flex-col px-6 py-5" style={{ height }}>
      <TileHead title="On repeat">
        {change !== null && Math.abs(change) >= 0.005 && (
          <span
            title="Plays this month against the same days of last month"
            className={cn("rounded-full px-2 py-1 text-[11px] font-bold", change > 0 ? "bg-[var(--ramp-3)]/20 text-[var(--ramp-3)] moss:text-good" : "bg-white/[0.08] text-ink-2")}
          >
            {change > 0 ? "+" : "−"}
            {percent(change)}
          </span>
        )}
      </TileHead>
      <button onClick={play} aria-label={`Play ${track.title}`} className="group/song my-3 flex min-w-0 items-center gap-3 text-left">
        <Artwork src={track.artwork} className="size-[42px] rounded-[11px] transition-transform duration-300 group-hover/song:scale-105" />
        <div className="min-w-0">
          <b className="block truncate font-display text-[16.5px] font-semibold tracking-[-0.02em]">{track.title}</b>
          <small className="block truncate text-[11.5px] font-semibold text-ink-3">{artistNames(track.artists)}</small>
        </div>
      </button>
      <div className="mt-auto">
        <DayBarcode days={repeat.days} />
        <div className="mt-2.5 flex justify-between gap-3 text-[12px] font-semibold text-ink-2">
          <span>{plural(repeat.plays, "play")} this month</span>
          <span title="Plays this month that went to the end of the song">
            To the end <i className="not-italic text-ink">{Math.round((repeat.finished / repeat.plays) * 100)}%</i>
          </span>
        </div>
      </div>
    </Tile>
  );
}

const DOTS = 14;
const STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180];

function hoursAndMinutes(ms: number): { h: number; m: number } {
  const minutes = Math.round(ms / 60_000);
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

export function WeekDots({ week, height, index = 0 }: { week: Week; height: number; index?: number }) {
  const most = Math.max(...week.days.map((d) => (d.dayMs + d.nightMs) / 60_000));
  // each dot is worth a round number of minutes, so the busiest day fits the column
  const unit = STEPS.find((s) => s * DOTS >= most) ?? Math.ceil(most / DOTS);
  const total = hoursAndMinutes(week.totalMs);
  const weekday = (date: Date, style: "narrow" | "long") => date.toLocaleDateString(undefined, { weekday: style });
  const today = week.days[6].date;
  return (
    <Tile index={index} label="Your last 7 days" className="flex flex-col px-6 py-5" style={{ height }}>
      <TileHead title="Last 7 days" />
      <div className="mt-auto flex items-end gap-3.5">
        <div className="font-display text-[40px] font-light leading-none tracking-[-0.05em] tabular-nums">
          {total.h > 0 && (
            <>
              {total.h}
              <small className="text-[14px] font-medium tracking-normal text-ink-2">h</small>{" "}
            </>
          )}
          {total.m}
          <small className="text-[14px] font-medium tracking-normal text-ink-2">m</small>
        </div>
        <div className="ml-auto flex items-end gap-[9px]" role="img" aria-label={week.days.map((d) => `${weekday(d.date, "long")}: ${Math.round((d.dayMs + d.nightMs) / 60_000)} minutes`).join(", ")}>
          {week.days.map((d) => {
            const day = Math.round(d.dayMs / 60_000 / unit);
            const night = Math.min(DOTS - day, Math.round(d.nightMs / 60_000 / unit));
            const { h, m } = hoursAndMinutes(d.dayMs + d.nightMs);
            return (
              <div key={d.date.getTime()} className="flex flex-col items-center" title={`${weekday(d.date, "long")}: ${h ? `${h} h ` : ""}${m} min`}>
                {/* filled from the bottom: daytime first, then night */}
                <div className="grid grid-cols-2 gap-[3px]" style={{ gridTemplateRows: `repeat(${DOTS / 2}, 5px)` }}>
                  {Array.from({ length: DOTS }, (_, i) => DOTS - 1 - i).map((n) => (
                    <i key={n} className={cn("size-[5px] rounded-full", n < day ? "bg-[var(--ramp-1)]" : n < day + night ? "bg-[var(--ramp-3)]" : "bg-white/[0.09]")} />
                  ))}
                </div>
                <span className={cn("mt-[5px] text-[9.5px] font-bold", d.date.getTime() === today.getTime() ? "text-ink" : "text-ink-3")}>{weekday(d.date, "narrow")}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex justify-between gap-3 text-[12px] font-semibold text-ink-2">
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            <i className="size-1.5 rounded-full bg-[var(--ramp-1)]" /> day
          </span>
          <span className="flex items-center gap-1">
            <i className="size-1.5 rounded-full bg-[var(--ramp-3)]" /> night
          </span>
        </span>
        {week.busiest && <i className="not-italic text-ink">Most {week.busiest.getTime() === today.getTime() ? "today" : `on ${weekday(week.busiest, "long")}`}</i>}
      </div>
    </Tile>
  );
}
