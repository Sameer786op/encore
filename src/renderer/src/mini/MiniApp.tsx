import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { NowPlaying } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { cn } from "@/lib/cn";

// The floating mini player. It mirrors what the main window plays and sends
// button presses back; all the audio stays in the main window.

const empty: NowPlaying = { track: null, playing: false, position: 0, duration: 0, liked: false, at: 0 };

function Progress({ state }: { state: NowPlaying }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const position = state.playing ? state.position + (Date.now() - state.at) / 1000 : state.position;
      const ratio = state.duration > 0 ? Math.min(1, position / state.duration) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${ratio.toFixed(4)})`;
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state]);
  return (
    <div
      className="no-drag group/bar absolute inset-x-4 bottom-2 h-[3px] cursor-pointer overflow-hidden rounded-full bg-white/15 transition-[height] duration-300 hover:h-[5px]"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        window.encore.nowPlaying.command({ kind: "seek", seconds: ((e.clientX - rect.left) / rect.width) * state.duration });
      }}
    >
      <div ref={bar} className="h-full origin-left rounded-full bg-white/90" />
    </div>
  );
}

export function MiniApp() {
  const [state, setState] = useState<NowPlaying>(empty);
  const send = window.encore.nowPlaying.command;

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return window.encore.nowPlaying.onUpdate(setState);
  }, []);

  const track = state.track;
  return (
    <div className="h-screen w-screen p-2">
      {/* the window can't see the desktop behind it, so the glass is lit by the song's own cover */}
      <div className="drag group relative flex h-full items-center gap-3 overflow-hidden rounded-[22px] bg-[#101014] pr-3 shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.3),inset_0_0_0_0.5px_rgb(255_255_255/0.14),0_8px_30px_rgb(0_0_0/0.6)]">
        <AnimatePresence initial={false}>
          {track?.artwork && (
            <motion.img
              key={track.artwork}
              src={track.artwork}
              alt=""
              referrerPolicy="no-referrer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.55 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 size-full scale-150 object-cover blur-[40px] saturate-[1.8]"
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] via-black/25 to-black/45" />

        <div className="relative h-full shrink-0 p-2">
          <Artwork src={track?.artwork} className="aspect-square h-full rounded-[14px] shadow-[0_6px_16px_-4px_rgb(0_0_0/0.5)]" />
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-white">{track?.title ?? "Nothing playing"}</div>
          <div className="truncate text-[12px] text-white/60">{track?.artists.map((a) => a.name).join(", ") ?? "Play something in Encore"}</div>
          <div className="no-drag mt-1.5 flex items-center gap-0.5">
            <button onClick={() => send({ kind: "previous" })} aria-label="Previous" className="pressable rounded-full p-1.5 text-white/85 hover:bg-white/10 hover:text-white">
              <SkipBack className="size-4" fill="currentColor" />
            </button>
            <button onClick={() => send({ kind: "toggle" })} aria-label={state.playing ? "Pause" : "Play"} className="pressable grid size-9 place-items-center rounded-full text-white hover:bg-white/10">
              {state.playing ? <Pause className="size-[22px]" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 size-[22px]" fill="currentColor" strokeWidth={0} />}
            </button>
            <button onClick={() => send({ kind: "next" })} aria-label="Next" className="pressable rounded-full p-1.5 text-white/85 hover:bg-white/10 hover:text-white">
              <SkipForward className="size-4" fill="currentColor" />
            </button>
            {track && (
              <button onClick={() => send({ kind: "like" })} aria-label={state.liked ? "Remove from Liked Songs" : "Add to Liked Songs"} className="pressable ml-1 rounded-full p-1.5 hover:bg-white/10">
                <Heart className={cn("size-4", state.liked ? "text-accent" : "text-white/70")} fill={state.liked ? "currentColor" : "none"} strokeWidth={state.liked ? 0 : 2} />
              </button>
            )}
          </div>
        </div>

        <div className="no-drag absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={() => void window.encore.mini.expand()} aria-label="Open Encore" title="Open Encore" className="pressable rounded-full bg-black/25 p-1 text-white/80 hover:bg-white/15 hover:text-white">
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
