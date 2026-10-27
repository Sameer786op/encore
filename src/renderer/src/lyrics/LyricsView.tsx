import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { LoaderCircle, Minus, Plus } from "lucide-react";
import type { LyricLine, Track } from "@shared/types";
import { Eyebrow } from "@/components/home/Tile";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { cn } from "@/lib/cn";
import { useLyrics, useLyricsOffset } from "./useLyrics";

// The lyrics in the full-screen player. The line being sung grows and fills
// in as it's sung, with the signature gradient at the head of the fill; the
// lines around it wait, dimmed.

const INTERLUDE = "♪";
/** pauses longer than this get the three animated dots */
const LONG_PAUSE_S = 6;
/** after the user scrolls, leave the view alone for this long */
const HANDS_OFF_MS = 3500;

/** the font size of the other lines, and of the line being sung */
const SIZES = { small: [19, 25], medium: [22, 31], large: [26, 37] } as const;

/** sung words in ink, the gradient where the singing is, the rest of the line dimmed */
const FILL =
  "linear-gradient(90deg, var(--color-ink) calc(var(--p) - 16%), var(--ramp-1) calc(var(--p) - 8%), var(--ramp-3) var(--p), color-mix(in srgb, var(--color-ink) 42%, transparent) calc(var(--p) + 2%))";

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
          className="size-2.5 rounded-full bg-ink"
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
    const place = (behavior: ScrollBehavior) => {
      const el = lineRefs.current[Math.max(0, active)];
      if (!box || !el || Date.now() - touchedAt.current < HANDS_OFF_MS) return;
      box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.3, behavior });
    };
    place(active < 0 ? "auto" : "smooth");
    // the sung line grows as it becomes the one, so settle again once it has
    const settle = setTimeout(() => place("smooth"), 560);
    return () => clearTimeout(settle);
  }, [active]);

  const [small, big] = SIZES[size];
  return (
    <div
      ref={container}
      onWheel={() => (touchedAt.current = Date.now())}
      onPointerDown={() => (touchedAt.current = Date.now())}
      className="scrollbar-none relative h-full overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_80%,transparent)]"
    >
      <div className="h-[30%]" />
      {lines.map((line, i) => {
        const isActive = i === active;
        const distance = Math.abs(i - active);
        const isPause = line.text === INTERLUDE;
        if (isPause && pauses[i] < LONG_PAUSE_S && !isActive)
          return (
            <div
              key={i}
              ref={() => {
                lineRefs.current[i] = null;
              }}
              className="h-3"
            />
          );
        return (
          <button
            key={`${i}-${line.time}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            onClick={() => seek(line.time + offset + 0.01)}
            className={cn(
              "block w-full py-[7px] text-left font-display font-semibold leading-[1.17] tracking-[-0.03em] text-ink transition-[font-size,opacity,filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
              isActive ? "opacity-100" : i < active ? "opacity-[0.32] hover:opacity-70" : "opacity-[0.42] hover:opacity-75",
            )}
            style={{ fontSize: isActive ? big : small, filter: isActive || Date.now() - touchedAt.current < HANDS_OFF_MS ? "none" : `blur(${Math.min(2, distance * 0.4)}px)` }}
          >
            {isPause ? (
              isActive ? (
                <Dots />
              ) : (
                <span className="opacity-70">• • •</span>
              )
            ) : isActive ? (
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: FILL }}>
                {line.text}
              </span>
            ) : (
              line.text
            )}
          </button>
        );
      })}
      <div className="h-[60%]" />
    </div>
  );
}

/** nudge the timing for this song, when the lyrics run early or late */
function Offset({ offset, setOffset }: { offset: number; setOffset: (value: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-[var(--row-on)] p-0.5 text-[11.5px] font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--ring)]">
      <button onClick={() => setOffset(offset - 0.5)} aria-label="Show lyrics earlier" title="Earlier" className="grid size-6 place-items-center rounded-full hover:bg-white/10 hover:text-ink">
        <Minus className="size-3" />
      </button>
      <button onClick={() => setOffset(0)} title="Reset timing" className="min-w-[54px] rounded-full px-1 tabular-nums hover:text-ink">
        {offset === 0 ? "In sync" : `${offset > 0 ? "+" : ""}${offset.toFixed(1)}s`}
      </button>
      <button onClick={() => setOffset(offset + 0.5)} aria-label="Show lyrics later" title="Later" className="grid size-6 place-items-center rounded-full hover:bg-white/10 hover:text-ink">
        <Plus className="size-3" />
      </button>
    </div>
  );
}

const SOURCES: Record<string, string> = { lrclib: "LRCLIB", youtube: "YouTube Music" };

/** the lyrics tile's insides: what they are, the words, then `footer` beside where they're from */
export function LyricsView({ track, footer }: { track: Track | null; footer?: ReactNode }) {
  const state = useLyrics(track);
  const [offset, setOffset] = useLyricsOffset(track?.id);
  const lyrics = state.status === "ready" ? state.lyrics : null;

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <div className="grid h-full place-items-center text-ink-3">
        <LoaderCircle className="size-6 animate-spin" />
      </div>
    );
  } else if (!lyrics) {
    body = (
      <div className="grid h-full place-items-center px-4 text-center">
        <div>
          <p className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink/80">No lyrics for this one</p>
          <p className="mt-2 text-[13px] font-semibold text-ink-3">{state.status === "error" ? "The lyrics service couldn't be reached." : "Enjoy the music."}</p>
        </div>
      </div>
    );
  } else if (lyrics.synced) {
    body = <Synced lines={lyrics.synced} offset={offset} />;
  } else {
    body = (
      <div className="scrollbar-none h-full overflow-y-auto pb-[40%] pt-4 [mask-image:linear-gradient(to_bottom,transparent,black_6%,black_85%,transparent)]">
        <p className="whitespace-pre-line font-display text-[21px] font-semibold leading-snug tracking-[-0.02em] text-ink/80">{lyrics.plain}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between gap-3">
        <Eyebrow>Lyrics{lyrics ? (lyrics.synced ? " · synced" : " · not time-synced") : ""}</Eyebrow>
        {lyrics?.synced && <Offset offset={offset} setOffset={setOffset} />}
      </div>
      <div className="relative mt-2 min-h-0 flex-1">{body}</div>
      {/* in a narrow tile, where they're from goes under the footer */}
      <div className="mt-3 flex min-h-[34px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        {footer}
        {lyrics && <p className="whitespace-nowrap text-[11px] font-semibold text-ink-3">Lyrics from {SOURCES[lyrics.source] ?? "the file"}</p>}
      </div>
    </div>
  );
}
