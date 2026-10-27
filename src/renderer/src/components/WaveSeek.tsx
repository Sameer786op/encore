import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "@/player/store";
import { useWaveform } from "@/player/waveform";
import { barHeights } from "@/player/waveShape";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { useScrub } from "./Slider";

// The seek bar as a barcode of the song's loudness (player/waveform.ts
// measures it as the song plays). What you've heard is lit along the
// signature gradient; the rest waits, dim. Hover shows where you'd land.

const BAR = 3;
const GAP = 2;

export function WaveSeek({ className, bar = BAR, gap = GAP }: { className?: string; bar?: number; gap?: number }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const shape = useWaveform((s) => s.shape);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { percent, engaged, active, tip, tipPercent, props } = useScrub({ value: position, max: duration, label: "Seek", onCommit: seek, step: 5, formatValue: formatTime });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = Math.max(8, Math.floor((size.w + gap) / (bar + gap)));
  const bars = useMemo(() => barHeights(shape, count), [shape, count]);
  // spread the bars so the last one ends at the edge
  const step = count > 1 ? (size.w - bar) / (count - 1) : 0;
  const played = (percent / 100) * size.w;

  return (
    <div {...props} className={cn("group relative flex cursor-pointer touch-none items-center outline-offset-4", className)}>
      <div ref={box} className="absolute inset-0">
        {size.w > 0 && (
          <svg width={size.w} height={size.h} className="block overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={`${id}g`} gradientUnits="userSpaceOnUse" x1="0" x2={size.w} y1="0" y2="0">
                <stop offset="0" stopColor="var(--ramp-1)" />
                <stop offset="0.5" stopColor="var(--ramp-2)" />
                <stop offset="1" stopColor="var(--ramp-3)" />
              </linearGradient>
              <clipPath id={`${id}c`}>
                {bars.map((b, i) => {
                  const h = Math.max(3, b.height * size.h);
                  return <rect key={i} x={i * step} y={(size.h - h) / 2} width={bar} height={h} rx={bar / 2} className="transition-[height,y] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" />;
                })}
              </clipPath>
            </defs>
            <g clipPath={`url(#${id}c)`}>
              <rect width={size.w} height={size.h} className={cn("transition-[fill] duration-300", engaged ? "fill-white/[0.26]" : "fill-white/[0.17]")} />
              <rect width={played} height={size.h} fill={`url(#${id}g)`} className={cn(!active && "transition-[width] duration-200 ease-linear")} />
              {/* where you'd land, while hovering */}
              {engaged && !active && tipPercent > percent && <rect x={played} width={(tipPercent / 100) * size.w - played} height={size.h} className="fill-white/[0.18]" />}
            </g>
          </svg>
        )}
      </div>
      {engaged && duration > 0 && (
        <div className="glass-menu pointer-events-none absolute -top-8 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink" style={{ left: `${tipPercent}%` }}>
          {formatTime(tip)}
        </div>
      )}
    </div>
  );
}
