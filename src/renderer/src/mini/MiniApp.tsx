import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { NowPlaying } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { cn } from "@/lib/cn";
import { connectAppearance } from "@/ui/appearance";

// The floating mini player. It mirrors what the main window plays and sends
// button presses back; all the audio stays in the main window.

const empty: NowPlaying = { track: null, playing: false, position: 0, duration: 0, liked: false, at: 0 };

function Progress({ state }: { state: NowPlaying }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const position = state.playing ? state.position + ((Date.now() - state.at) / 1000) * (state.rate ?? 1) : state.position;
      const ratio = state.duration > 0 ? Math.min(1, position / state.duration) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${ratio.toFixed(4)})`;
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state]);
  return (
    <div
      className="no-drag group/bar absolute inset-x-4 bottom-2 h-[3px] cursor-pointer overflow-hidden rounded-full bg-white/[0.12] transition-[height] duration-300 hover:h-[5px]"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        window.encore.nowPlaying.command({ kind: "seek", seconds: ((e.clientX - rect.left) / rect.width) * state.duration });
      }}
    >
      {/* the signature gradient, as in the seek bar */}
      <div ref={bar} className="h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--ramp-1),var(--ramp-2),var(--ramp-3))]" />
    </div>
  );
}

export function MiniApp() {
  const [state, setState] = useState<NowPlaying>(empty);
  const send = window.encore.nowPlaying.command;

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const stop = window.encore.nowPlaying.onUpdate(setState);
    // ask once on open too: the first update can arrive before this page is listening,
    // and nothing more comes while the music is paused
    void window.encore.nowPlaying.get().then((now) => now && setState((current) => (now.at >= current.at ? now : current)));
    // the mini player stays dark but wears the accent picked in Settings
    const stopAppearance = connectAppearance({ mini: true });
    return () => {
      stop();
      stopAppearance();
    };
  }, []);

  const track = state.track;
  return (
    <div className="theme-dark h-screen w-screen p-2">
      {/* Ember in miniature: a black tile lit by a faint wash of the song's cover and an ember glow, with grain */}
      <div className="drag group relative isolate flex h-full items-center gap-3 overflow-hidden rounded-[24px] bg-[#060606] pr-3 shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.22),inset_0_0_0_0.5px_rgb(255_255_255/0.12),0_8px_30px_rgb(0_0_0/0.6)]">
        <AnimatePresence initial={false}>
          {track?.artwork && (
            <motion.img
              key={track.artwork}
              src={track.artwork}
              alt=""
              referrerPolicy="no-referrer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 size-full scale-150 object-cover blur-[40px] saturate-[1.8]"
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-[radial-gradient(70%_130%_at_100%_100%,rgb(var(--accent-rgb)/0.42),transparent_70%),linear-gradient(180deg,rgb(255_255_255/0.06),rgb(0_0_0/0.2)_45%,rgb(0_0_0/0.4))]" />
        <span aria-hidden className="grain absolute inset-0" />

        <div className="relative h-full shrink-0 p-2">
          <Artwork src={track?.artwork} className="aspect-square h-full rounded-[16px] shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_8px_18px_-6px_rgb(0_0_0/0.6)]" />
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="truncate font-display text-[14px] font-semibold tracking-[-0.02em] text-ink">{track?.title ?? "Nothing playing"}</div>
          <div className="truncate text-[12px] font-semibold text-ink-2">{track?.artists.map((a) => a.name).join(", ") ?? "Play something in Vyse Music"}</div>
          <div className="no-drag mt-1.5 flex items-center gap-0.5">
            <button onClick={() => send({ kind: "previous" })} aria-label="Previous" className="pressable rounded-full p-1.5 text-white/85 hover:bg-white/10 hover:text-white">
              <SkipBack className="size-4" fill="currentColor" />
            </button>
            {/* the solid round button, as in the player bar */}
            <button
              onClick={() => send({ kind: "toggle" })}
              aria-label={state.playing ? "Pause" : "Play"}
              className="pressable mx-0.5 grid size-8 place-items-center rounded-full bg-snow text-[#0b0b0b] shadow-[0_4px_14px_-4px_rgb(0_0_0/0.6)] hover:brightness-95"
            >
              {state.playing ? <Pause className="size-[15px]" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 size-[15px]" fill="currentColor" strokeWidth={0} />}
            </button>
            <button onClick={() => send({ kind: "next" })} aria-label="Next" className="pressable rounded-full p-1.5 text-white/85 hover:bg-white/10 hover:text-white">
              <SkipForward className="size-4" fill="currentColor" />
            </button>
            {track && (
              <button onClick={() => send({ kind: "like" })} aria-label={state.liked ? "Remove from Liked Songs" : "Add to Liked Songs"} className="pressable ml-1 rounded-full p-1.5 hover:bg-white/10">
                <Heart className={cn("size-4", state.liked ? "text-accent-ink" : "text-white/70")} fill={state.liked ? "currentColor" : "none"} strokeWidth={state.liked ? 0 : 2} />
              </button>
            )}
          </div>
        </div>

        <div className="no-drag absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={() => void window.encore.mini.expand()} aria-label="Open Vyse Music" title="Open Vyse Music" className="pressable rounded-full bg-black/25 p-1 text-white/80 hover:bg-white/15 hover:text-white">
            <Maximize2 className="size-3.5" />
          </button>
          <button onClick={() => void window.encore.mini.close()} aria-label="Close mini player" title="Close" className="pressable rounded-full bg-black/25 p-1 text-white/80 hover:bg-white/15 hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
        <Progress state={state} />
      </div>
    </div>
  );
}
