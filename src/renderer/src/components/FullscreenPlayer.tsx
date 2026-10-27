import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Expand, LoaderCircle } from "lucide-react";
import type { Track } from "@shared/types";
import { useCurrentTrack, usePlayer } from "@/player/store";
import { LyricsView } from "@/lyrics/LyricsView";
import { useLyrics } from "@/lyrics/useLyrics";
import { useSettings, type Settings } from "@/settings/store";
import { EDGE_PRESETS, edgeLook } from "@/visuals/edgeColors";
import { EdgeLight } from "@/visuals/EdgeLight";
import { FlowBackground } from "@/visuals/FlowBackground";
import { forGlow, type RGB } from "@/visuals/palette";
import { usePalette } from "@/visuals/usePalette";
import { useHints } from "@/ui/shortcuts";
import { useView } from "@/ui/view";
import { cn } from "@/lib/cn";
import { Tile } from "./home/Tile";
import { BottomBar } from "./nowplaying/Bottom";
import { SideColumn } from "./nowplaying/Side";
import { Stage } from "./nowplaying/Stage";
import { PlayingBars } from "./PlayingBars";
import { EASE } from "./Specimen";

// The full-screen player, in the mode the app is in. The lyrics on the left,
// the cover as a specimen in the middle, the artist and what's next on the
// right, and the controls along the bottom. Behind it, Ember's glow (with the
// lyrics as a faint texture) or Moss's floor, or the cover's own colours
// flowing when the background is set to Artwork.

const GAP = 18;
/** narrower than this, the artist and Up next only show when the queue is opened */
const WIDE = 1180;
const SLIDE = { type: "spring", stiffness: 260, damping: 34, mass: 0.9 } as const;

const clamp = (min: number, value: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));
const rgb = ([r, g, b]: RGB, alpha: number) => `rgb(${r} ${g} ${b} / ${alpha})`;

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Windows 11 rounds a window's corners, except when it fills the screen */
function useWindowRadius(): number {
  const [square, setSquare] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.encore.window.getState().then((state) => alive && setSquare(state.maximized || state.fullScreen));
    const stop = window.encore.window.onState((state) => setSquare(state.maximized || state.fullScreen));
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return square ? 0 : 8;
}

/** the line of light round the window, while the lyrics show; it adds light in Ember and lies on top in Moss */
function WindowEdgeLight({ palette }: { palette: RGB[] }) {
  const edge = useSettings((s) => s.edgeLight);
  const radius = useWindowRadius();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="pointer-events-none absolute inset-0 z-20 mix-blend-plus-lighter moss:mix-blend-normal"
    >
      <EdgeLight {...edgeLook(edge, palette)} speed={edge.speed} glow={edge.glow} pulse={edge.pulse} radius={radius} />
    </motion.div>
  );
}

function edgeColours(edge: Settings["edgeLight"]): string {
  if (edge.colors === "rainbow") return "in every colour";
  if (edge.colors === "artwork") return "in the cover's colours";
  if (edge.colors === "custom") return "in your colours";
  return `in ${(EDGE_PRESETS.find((p) => p.id === edge.colors)?.name ?? "Neon").toLowerCase()}`;
}

/** says whether the edge light is on, and switches it */
function EdgePill() {
  const edge = useSettings((s) => s.edgeLight);
  const update = useSettings((s) => s.update);
  return (
    <button
      onClick={() => update({ edgeLight: { ...edge, enabled: !edge.enabled } })}
      aria-pressed={edge.enabled}
      title={edge.enabled ? "Turn the edge light off" : "Turn the edge light on"}
      className="glass-control pressable inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full py-1 pl-1 pr-3.5 text-[12px] font-semibold text-ink-2 hover:brightness-110"
    >
      <b className={cn("rounded-full px-2.5 py-1 font-bold transition-colors duration-300", edge.enabled ? "bg-ink text-bg" : "bg-[var(--row-on)] text-ink-2")}>Edge light</b>
      {edge.enabled ? `on, ${edgeColours(edge)}` : "off"}
    </button>
  );
}

/** what the player's doing, and where in the queue it is */
function ListeningPill() {
  const status = usePlayer((s) => s.status);
  const index = usePlayer((s) => s.queue.index);
  const count = usePlayer((s) => s.queue.items.length);
  const label = status === "loading" ? "Loading…" : status === "playing" ? "Playing" : "Paused";
  return (
    <span className="glass-control hidden h-10 items-center gap-2.5 whitespace-nowrap rounded-full py-1 pl-1 pr-3.5 text-[12px] font-semibold text-ink-2 md:inline-flex">
      <b className="rounded-full bg-ink px-3 py-[7px] font-bold leading-none text-bg">{label}</b>
      {count > 0 && index >= 0 && (
        <span className="tabular-nums">
          Song {index + 1} of {count.toLocaleString()}
        </span>
      )}
      {status === "loading" ? <LoaderCircle className="size-3.5 animate-spin text-ink-3" /> : <PlayingBars paused={status !== "playing"} className="h-3" />}
    </span>
  );
}

/** the words of the song (or its name, before they come), as faint type across the background */
function LyricRain({ track }: { track: Track | null }) {
  const state = useLyrics(track);
  const words = useMemo(() => {
    const lyrics = state.status === "ready" ? state.lyrics : null;
    const lines = lyrics?.synced ? lyrics.synced.map((l) => l.text).filter((t) => t !== "♪") : lyrics?.plain ? lyrics.plain.split("\n") : [];
    const fallback = track ? [track.title, ...track.artists.map((a) => a.name), track.album?.title ?? ""] : [];
    return (lines.length > 0 ? lines : fallback)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("  ·  ")
      .toUpperCase();
  }, [state, track]);
  if (!words) return null;
  // long enough to run off the side of any window
  const row = `${words}  ·  `.repeat(Math.ceil(900 / (words.length + 5)));
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre font-mono text-[10px] leading-[13px] text-ink opacity-[0.075] [mask-image:radial-gradient(70%_70%_at_50%_50%,transparent_30%,#000)] moss:opacity-[0.05]"
    >
      {Array.from({ length: 96 }, (_, i) => (
        <div key={i} style={{ transform: `translateX(${-((i * 211) % 1300)}px)` }}>
          {row}
        </div>
      ))}
    </div>
  );
}

/** what's behind it all */
function Scenery({ track, palette }: { track: Track | null; palette: RGB[] }) {
  const background = useSettings((s) => s.background);
  const [tint] = forGlow(palette, 1);
  if (background === "artwork") {
    return (
      <>
        <FlowBackground colors={palette} className="absolute inset-0" />
        {track?.artwork && <img src={track.artwork} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-125 object-cover opacity-[0.18] mix-blend-soft-light blur-3xl" />}
        {/* washed out in Moss, so the navy reads */}
        <div className="moss-only absolute inset-0 bg-[rgb(var(--backdrop-tint)/0.6)]" />
      </>
    );
  }
  return (
    <>
      <div className="ember-only absolute inset-0 bg-[#030303]">
        <div className="absolute left-1/2 top-[54%] h-[125%] w-[105%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent-rgb)/0.34),rgb(var(--accent-rgb)/0.1)_55%,transparent)]" />
        <div className="absolute -bottom-[32%] -right-[16%] h-[75%] w-[55%] animate-drift rounded-full bg-[radial-gradient(closest-side,rgb(255_196_170/0.3),transparent)]" />
        <motion.div
          animate={{ background: `radial-gradient(closest-side, ${rgb(tint, 0.16)}, transparent)` }}
          transition={{ duration: 1.6, ease: EASE }}
          className="absolute -left-[22%] -top-[38%] h-[90%] w-[70%] animate-drift rounded-full [animation-delay:-14s] [animation-direction:alternate-reverse]"
        />
      </div>
      <div className="moss-only absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(55%_60%_at_50%_55%,rgb(255_255_255/0.85),transparent_70%),radial-gradient(45%_50%_at_85%_100%,rgb(120_170_40/0.45),transparent_70%),radial-gradient(35%_40%_at_0%_100%,rgb(90_140_30/0.4),transparent_70%),linear-gradient(#e3e4de,#e3e4de)]" />
        <div className="moss-floor absolute inset-x-0 bottom-0 h-[45%]" />
        <motion.div
          animate={{ background: `radial-gradient(closest-side, ${rgb(tint, 0.2)}, transparent)` }}
          transition={{ duration: 1.6, ease: EASE }}
          className="absolute -right-[15%] -top-[30%] h-[85%] w-[60%] animate-drift rounded-full [animation-delay:-6s]"
        />
      </div>
      <LyricRain track={track} />
      <div className="grain absolute inset-0" />
    </>
  );
}

/** a column that slides open beside the stage; the stage gives it room as it goes */
function Column({ shown, width, side, children }: { shown: boolean; width: number; side: "left" | "right"; children: ReactNode }) {
  const away = { opacity: 0, x: side === "left" ? -36 : 36, filter: "blur(8px)" };
  return (
    <motion.div initial={false} animate={{ width: shown ? width + GAP : 0 }} transition={SLIDE} className="relative h-full shrink-0">
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            key={side}
            initial={away}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            exit={away}
            transition={{ duration: 0.55, ease: EASE }}
            className={cn("absolute inset-y-0", side === "left" ? "left-0" : "right-0")}
            style={{ width }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Fullscreen() {
  const track = useCurrentTrack();
  const context = usePlayer((s) => s.queue.context);
  const showLyrics = useView((s) => s.lyrics);
  const edgeLight = useSettings((s) => s.edgeLight.enabled);
  const { closeFullscreen } = useView.getState();
  const palette = usePalette(track?.artwork);
  const width = useWindowWidth();
  const [queueOpen, setQueueOpen] = useState(false);
  const hint = useHints();
  const lyricsWidth = clamp(300, width * 0.25, 380);
  const sideWidth = clamp(290, width * 0.23, 340);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeFullscreen]);

  return (
    <motion.div
      role="dialog"
      aria-label="Now playing"
      initial={{ y: "100%", borderRadius: 40 }}
      animate={{ y: 0, borderRadius: 0 }}
      exit={{ y: "100%", borderRadius: 40, transition: { type: "spring", stiffness: 300, damping: 36 } }}
      transition={{ type: "spring", stiffness: 240, damping: 32, mass: 0.9 }}
      className="fixed inset-0 z-30 overflow-hidden bg-bg text-ink"
    >
      <Scenery track={track} palette={palette} />

      <div className="drag absolute inset-x-0 top-0 z-10 flex h-[76px] items-center gap-3 pl-[22px] pr-[150px]">
        <button onClick={closeFullscreen} aria-label="Close full-screen player" title="Close (Esc)" className="glass-control pressable no-drag grid size-10 shrink-0 place-items-center rounded-full text-ink hover:brightness-110">
          <ChevronDown className="size-5" strokeWidth={2.2} />
        </button>
        <div className="min-w-0 leading-tight">
          <small className="block text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-3">Playing from</small>
          <b className="block truncate font-display text-[14px] font-semibold tracking-[-0.01em]">{context?.label ?? "Your queue"}</b>
        </div>
        <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
          <ListeningPill />
          <button
            onClick={() => void window.encore.app.toggleFullScreen()}
            aria-label="Full screen"
            title={hint("fullScreen", "Full screen")}
            className="glass-control pressable grid size-10 place-items-center rounded-full text-ink hover:brightness-110"
          >
            <Expand className="size-4" />
          </button>
        </div>
      </div>

      {track ? (
        <>
          <div className="absolute inset-x-[22px] bottom-[140px] top-[84px] z-[1] flex">
            <Column shown={showLyrics} width={lyricsWidth} side="left">
              <Tile label="Lyrics" className="h-full px-7 pb-5 pt-[22px]">
                <LyricsView track={track} footer={<EdgePill />} />
              </Tile>
            </Column>
            <Stage track={track} />
            <Column shown={width >= WIDE || queueOpen} width={sideWidth} side="right">
              <SideColumn track={track} expanded={queueOpen} onToggle={() => setQueueOpen(!queueOpen)} />
            </Column>
          </div>
          <BottomBar track={track} queueOpen={queueOpen} onQueue={() => setQueueOpen(!queueOpen)} />
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-display text-[28px] font-bold tracking-[-0.03em]">Nothing playing</p>
            <p className="mt-2 text-[14px] font-semibold text-ink-3">Pick a song to start</p>
          </div>
        </div>
      )}

      <AnimatePresence>{showLyrics && edgeLight && <WindowEdgeLight key="edge-light" palette={palette} />}</AnimatePresence>
    </motion.div>
  );
}

export function FullscreenPlayer() {
  const open = useView((s) => s.fullscreen);
  return createPortal(<AnimatePresence>{open && <Fullscreen />}</AnimatePresence>, document.body);
}
