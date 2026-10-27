import { motion } from "motion/react";
import type { Track } from "@shared/types";
import { cn } from "@/lib/cn";
import { useFinishRate } from "./home/hooks";

// The specimen look that Home's Now playing tile and the full-screen player
// share: the cover in its rings under a passing scan line, pins on the cover
// with leader lines out to callouts, and the Finish-rate gauge.

export const EASE = [0.32, 0.72, 0, 1] as const;
/** a callout is this tall: its 34px icon and 6px of padding above and below */
export const CALLOUT_H = 46;

/** "+2.1" or "−4.0" */
export const signed = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)}`;

/** how often you've heard this song to the end, as a ring that fills along the ramp */
export function FinishGauge({ track, size = 92, style }: { track: Track; size?: number; style?: React.CSSProperties }) {
  const rate = useFinishRate(track);
  const r = 40;
  const length = 2 * Math.PI * r;
  const id = `fg${size}${track.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const k = size / 92;
  return (
    <div
      className="absolute grid place-items-center text-center"
      style={{ ...style, width: size, height: size }}
      title={rate ? `Heard to the end ${rate.finished} of the ${rate.plays} times you played it` : rate === null ? "You haven't played this song before" : undefined}
    >
      <svg viewBox="0 0 92 92" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--ramp-3)" />
            <stop offset="1" stopColor="var(--ramp-1)" />
          </linearGradient>
        </defs>
        <circle cx="46" cy="46" r={r} fill="none" strokeWidth="7" className="stroke-white/[0.13]" />
        <motion.circle
          cx="46"
          cy="46"
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={length}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: rate ? length * (1 - Math.max(0.02, rate.rate)) : length }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="relative leading-none">
        {rate ? (
          <b className="block bg-gradient-to-br from-[var(--ramp-3)] to-[var(--ramp-2)] bg-clip-text font-display font-semibold tracking-[-0.03em] text-transparent" style={{ fontSize: 23 * k }}>
            {Math.round(rate.rate * 100)}%
          </b>
        ) : (
          <b className="block font-display font-semibold tracking-[-0.02em] text-ink" style={{ fontSize: 17 * k }}>
            {rate === null ? "New" : "…"}
          </b>
        )}
        <small className="mt-1 block font-semibold text-ink-2" style={{ fontSize: Math.min(11, 10 * k) }}>
          {rate === null ? "to you" : "Finish rate"}
        </small>
      </div>
    </div>
  );
}

/** a reading pinned to the cover: an icon, a bold value and a note */
export function Callout({ icon, title, note, style, ref, delay }: { icon: React.ReactNode; title: React.ReactNode; note: string; style: React.CSSProperties; ref?: React.Ref<HTMLDivElement>; delay: number }) {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10, scale: 0.96, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: 0.9, delay, ease: EASE }}
      className="glass-control absolute z-[2] flex items-center gap-2.5 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-4"
      style={style}
    >
      <span className="grid size-[34px] place-items-center rounded-full bg-[var(--row-on)] text-ink">{icon}</span>
      <div className="leading-tight">
        <b className="block font-display text-[14px] font-semibold tabular-nums tracking-[-0.01em]">{title}</b>
        <small className="block text-[11px] font-semibold text-ink-3">{note}</small>
      </div>
    </motion.div>
  );
}

/** the rings round a cover of `size`, centred on (x, y); the outer two breathe while it plays */
export function Rings({ x, y, size, playing }: { x: number; y: number; size: number; playing: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ left: x, top: y }}>
      {[
        { r: size * 0.92, className: cn("bg-[radial-gradient(circle,rgb(255_255_255/0.05),transparent_70%)]", playing && "animate-ring") },
        { r: size * 0.68, className: cn(playing && "animate-ring [animation-delay:0.4s]") },
        { r: size * 0.6, className: "border-[1.5px]" },
      ].map((ring, i) => (
        <span key={i} className={cn("absolute rounded-full border border-[var(--ring)]", ring.className)} style={{ left: -ring.r, top: -ring.r, width: ring.r * 2, height: ring.r * 2 }} />
      ))}
    </div>
  );
}

/** the lime line that sweeps down the cover while it plays; sits inside the cover */
export function ScanLine({ height = 30 }: { height?: number }) {
  return (
    <span
      className="pointer-events-none absolute -left-[16%] -right-[16%] animate-scan rounded-[50%] bg-[linear-gradient(180deg,transparent,rgb(205_243_90/0.5)_45%,rgb(240_255_190/0.9)_50%,rgb(205_243_90/0.5)_55%,transparent)] mix-blend-screen blur-[1.5px] shadow-[0_0_40px_rgb(205_243_90/0.35)] moss:mix-blend-normal"
      style={{ height }}
    />
  );
}

/** a glowing pin on the cover, where a leader line starts */
export function Pin({ x, y, delay = 0 }: { x: number; y: number; delay?: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-[2] size-2.5 animate-pulse rounded-full bg-snow shadow-[0_0_0_4px_rgb(255_255_255/0.25),0_0_14px_rgb(255_255_255/0.8)]"
      style={{ left: x - 5, top: y - 5, animationDelay: `${delay}s` }}
    />
  );
}

/** a path from a pin to a callout's near edge, with a short level run into it */
export function leader(from: { x: number; y: number }, edge: { x: number; y: number }, side: "left" | "right"): string {
  const run = side === "right" ? -18 : 18;
  return `M${from.x} ${from.y} L${edge.x + run} ${edge.y} L${edge.x} ${edge.y}`;
}

export function LeaderLines({ paths }: { paths: string[] }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 z-[1] size-full overflow-visible">
      {paths.map((d) => (
        <path key={d} d={d} fill="none" strokeWidth="1.2" className="stroke-white/30" />
      ))}
    </svg>
  );
}
