import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { LoaderCircle, Minus, Plus } from "lucide-react";
import type { LyricLine, Track } from "@shared/types";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { cn } from "@/lib/cn";
import { useLyrics, useLyricsOffset } from "./useLyrics";

const INTERLUDE = "♪";
/** pauses longer than this get the three animated dots */
const LONG_PAUSE_S = 6;
/** after the user scrolls, leave the view alone for this long */
const HANDS_OFF_MS = 3500;

const SIZES = { small: "text-[24px] leading-[1.25]", medium: "text-[32px] leading-[1.22]", large: "text-[40px] leading-[1.18]" };

/** the index of the line that is being sung at `time` */
export function activeLine(lines: LyricLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** the playback position, smoothed between the player's quarter-second updates */
function useSmoothPosition(onFrame: (seconds: number) => void): void {
  const sample = useRef({ position: usePlayer.getState().position, at: performance.now() });
  useEffect(
    () =>
      usePlayer.subscribe((s, before) => {
        if (s.position !== before.position) sample.current = { position: s.position, at: performance.now() };
      }),
    [],
  );
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const playing = usePlayer.getState().status === "playing";
      const { position, at } = sample.current;
      onFrame(playing ? position + Math.min(0.5, (performance.now() - at) / 1000) : position);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [onFrame]);
}

/** three dots that light up one by one through a pause; --pn is the line's progress, 0..1 */
function Dots() {
  return (
    <span className="inline-flex items-center gap-2 py-2">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-3 rounded-full bg-white"
          style={{ opacity: `clamp(0.25, calc(var(--pn) * 3 - ${i}), 1)` }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}

function Synced({ lines, offset }: { lines: LyricLine[]; offset: number }) {
  const seek = usePlayer((s) => s.seek);
  const size = useSettings((s) => s.lyricsSize);
  const container = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  const touchedAt = useRef(0);

  // the gap before each line, to know which pauses deserve dots
  const pauses = useMemo(() => lines.map((line, i) => (lines[i + 1]?.time ?? line.time + 4) - line.time), [lines]);

  useSmoothPosition(
    useMemo(
      () => (seconds: number) => {
        const time = seconds - offset;
        const index = activeLine(lines, time);
        setActive((prev) => (prev === index ? prev : index));
        // progress through the line goes straight to CSS, so frames don't re-render the list
        const box = container.current;
        if (box && index >= 0) {
          const length = Math.max(0.3, (lines[index + 1]?.time ?? lines[index].time + 4) - lines[index].time);
          const progress = Math.min(1, Math.max(0, (time - lines[index].time) / length));
          box.style.setProperty("--p", `${(progress * 100).toFixed(1)}%`);
          box.style.setProperty("--pn", progress.toFixed(3));
        }
      },
      [lines, offset],
    ),
  );

  // keep the sung line about a third of the way down
  useLayoutEffect(() => {
    const box = container.current;
    const el = lineRefs.current[Math.max(0, active)];
    if (!box || !el || Date.now() - touchedAt.current < HANDS_OFF_MS) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.32, behavior: active < 0 ? "auto" : "smooth" });
  }, [active]);

  return (
    <div
      ref={container}
      onWheel={() => (touchedAt.current = Date.now())}
      onPointerDown={() => (touchedAt.current = Date.now())}
      className="scrollbar-none relative h-full overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_78%,transparent)]"
    >
      <div className="h-[30vh]" />
      {lines.map((line, i) => {
        const isActive = i === active;
        const distance = Math.abs(i - active);
        const isPause = line.text === INTERLUDE;
        if (isPause && pauses[i] < LONG_PAUSE_S && !isActive) return <div key={i} ref={() => {
                  lineRefs.current[i] = null;
                }} className="h-4" />;
        return (
          <button
            key={`${i}-${line.time}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            onClick={() => seek(line.time + offset + 0.01)}
            className={cn(
              "block w-full origin-left py-3 text-left font-display font-bold tracking-tight transition-[opacity,filter,transform] duration-500 ease-out",
              SIZES[size],
              isActive ? "scale-100 opacity-100" : "scale-[0.97] hover:opacity-80",
              !isActive && (i < active ? "opacity-30" : "opacity-40"),
            )}
            style={{ filter: isActive || Date.now() - touchedAt.current < HANDS_OFF_MS ? "none" : `blur(${Math.min(2.5, distance * 0.5)}px)` }}
          >
            {isPause ? (
              isActive ? (
                <Dots />
              ) : (
                <span className="text-white/60">• • •</span>
              )
            ) : isActive ? (
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "linear-gradient(90deg, #fff var(--p), rgba(255,255,255,0.45) calc(var(--p) + 12%))" }}
              >
                {line.text}
              </span>
            ) : (
              <span className="text-white">{line.text}</span>
            )}
          </button>
        );
      })}
      <div className="h-[45vh]" />
    </div>
  );
}

export function LyricsView({ track }: { track: Track | null }) {
  const state = useLyrics(track);
  const [offset, setOffset] = useLyricsOffset(track?.id);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-white/60">
        <LoaderCircle className="size-7 animate-spin" />
      </div>
    );
  }
  const lyrics = state.status === "ready" ? state.lyrics : null;
  if (!lyrics) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <p className="font-display text-2xl font-bold text-white/80">No lyrics for this one</p>
          <p className="mt-2 text-sm text-white/50">{state.status === "error" ? "The lyrics service couldn't be reached." : "Enjoy the music."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {lyrics.synced ? (
        <>
          <Synced lines={lyrics.synced} offset={offset} />
          <div className="glass-clear absolute right-0 top-0 flex items-center gap-1 rounded-full p-1 text-[12px] font-medium text-white/75">
            <button onClick={() => setOffset(offset - 0.5)} aria-label="Show lyrics earlier" title="Earlier" className="rounded-full p-1 hover:bg-white/10 hover:text-white">
              <Minus className="size-3.5" />
            </button>
            <button onClick={() => setOffset(0)} title="Reset timing" className="min-w-14 rounded-full px-1 tabular-nums hover:text-white">
              {offset === 0 ? "In sync" : `${offset > 0 ? "+" : ""}${offset.toFixed(1)}s`}
            </button>
            <button onClick={() => setOffset(offset + 0.5)} aria-label="Show lyrics later" title="Later" className="rounded-full p-1 hover:bg-white/10 hover:text-white">
              <Plus className="size-3.5" />
            </button>
          </div>
        </>
      ) : (
        <div className="scrollbar-none h-full overflow-y-auto pb-[30vh] pt-8 [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_85%,transparent)]">
          <p className="mb-6 text-[12.5px] font-medium text-white/45">These lyrics aren't time-synced</p>
          <p className="whitespace-pre-line font-display text-[26px] font-bold leading-snug text-white/85">{lyrics.plain}</p>
        </div>
      )}
      <p className="pointer-events-none absolute bottom-2 left-0 text-[11px] text-white/35">
        Lyrics from {lyrics.source === "lrclib" ? "LRCLIB" : lyrics.source === "youtube" ? "YouTube Music" : "the file"}
      </p>
    </div>
  );
}
