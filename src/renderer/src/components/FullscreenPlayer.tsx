import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Expand, LoaderCircle, MicVocal, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { navigate } from "@/nav/store";
import { useCurrentTrack, usePlayer } from "@/player/store";
import { LyricsView } from "@/lyrics/LyricsView";
import { FlowBackground } from "@/visuals/FlowBackground";
import { usePalette } from "@/visuals/usePalette";
import { useView } from "@/ui/view";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { Artwork } from "./Artwork";
import { LikeButton } from "./common";
import { Slider } from "./Slider";

/** the cover sits back while paused and springs forward when the music starts, like Apple Music */
function Cover({ src, title }: { src?: string; title: string }) {
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <motion.div
      animate={{ scale: playing ? 1 : 0.86 }}
      transition={{ type: "spring", stiffness: 210, damping: 22, mass: 0.9 }}
      className="will-change-transform"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={src ?? title}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 180, damping: 24 }}
        >
          <Artwork
            src={src?.replace(/=w544-h544/, "=w1200-h1200")}
            alt={title}
            className={cn(
              "aspect-square w-full rounded-[18px] transition-shadow duration-700",
              playing ? "shadow-[0_40px_90px_-20px_rgb(0_0_0/0.75)]" : "shadow-[0_16px_40px_-16px_rgb(0_0_0/0.6)]",
            )}
          />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/** a white glyph with no border; a soft circle shows under it on hover */
function Glyph({ className, active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.84 }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      className={cn("grid place-items-center rounded-full transition-colors duration-200", active ? "bg-white/20 text-white" : "text-white/90 hover:bg-white/10 hover:text-white", className)}
      {...(props as object)}
    >
      {children}
    </motion.button>
  );
}

function Controls() {
  const status = usePlayer((s) => s.status);
  const shuffle = usePlayer((s) => s.queue.shuffle);
  const repeat = usePlayer((s) => s.queue.repeat);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const p = usePlayer.getState();
  const playing = status === "playing";
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="w-full">
      <Slider value={position} max={duration} label="Seek" onCommit={p.seek} step={5} formatValue={formatTime} />
      <div className="mt-1 flex justify-between text-[12px] font-medium tabular-nums text-white/55">
        <span>{formatTime(position)}</span>
        <span>-{formatTime(Math.max(0, duration - position))}</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Glyph onClick={p.toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle} active={shuffle} className="size-10">
          <Shuffle className="size-[18px]" strokeWidth={2.3} />
        </Glyph>
        <Glyph onClick={p.previous} aria-label="Previous" className="size-14">
          <SkipBack className="size-8" fill="currentColor" strokeWidth={1} />
        </Glyph>
        <Glyph onClick={p.togglePlay} aria-label={playing ? "Pause" : "Play"} className="size-[72px]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status === "loading" ? "loading" : playing ? "pause" : "play"}
              initial={{ opacity: 0, scale: 0.4, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.4, filter: "blur(4px)" }}
              transition={{ type: "spring", stiffness: 600, damping: 32, filter: { duration: 0.16, ease: "easeOut" } }}
              className="grid place-items-center"
            >
              {status === "loading" ? (
                <LoaderCircle className="size-9 animate-spin" />
              ) : playing ? (
                <Pause className="size-11" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="ml-1 size-11" fill="currentColor" strokeWidth={0} />
              )}
            </motion.span>
          </AnimatePresence>
        </Glyph>
        <Glyph onClick={p.next} aria-label="Next" className="size-14">
          <SkipForward className="size-8" fill="currentColor" strokeWidth={1} />
        </Glyph>
        <Glyph onClick={p.cycleRepeat} aria-label={`Repeat: ${repeat}`} active={repeat !== "off"} className="size-10">
          <RepeatIcon className="size-[18px]" strokeWidth={2.3} />
        </Glyph>
      </div>
      <div className="mt-5 flex items-center gap-3 text-white/55">
        <button onClick={p.toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="pressable hover:text-white">
          {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume1 className="size-4" />}
        </button>
        <Slider value={(muted ? 0 : volume) * 100} max={100} label="Volume" onChange={(v) => p.setVolume(v / 100)} step={5} className="flex-1" />
        <Volume2 className="size-4" />
      </div>
    </div>
  );
}

function Fullscreen() {
  const track = useCurrentTrack();
  const context = usePlayer((s) => s.queue.context);
  const showLyrics = useView((s) => s.lyrics);
  const { closeFullscreen, setLyrics } = useView.getState();
  const palette = usePalette(track?.artwork);

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
      className="fixed inset-0 z-30 overflow-hidden bg-black text-white"
    >
      <FlowBackground colors={palette} className="absolute inset-0" />
      {track?.artwork && <img src={track.artwork} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-125 object-cover opacity-[0.18] mix-blend-soft-light blur-3xl" />}

      <div className="drag absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-3 pl-5 pr-[150px]">
        <button onClick={closeFullscreen} aria-label="Close full-screen player" className="glass-clear pressable no-drag grid size-9 place-items-center rounded-full text-white hover:brightness-125">
          <ChevronDown className="size-5" strokeWidth={2.4} />
        </button>
        {context && (
          <span className="truncate text-[12.5px] font-medium text-white/60">
            Playing from <span className="font-semibold text-white/85">{context.label}</span>
          </span>
        )}
        <div className="glass-clear no-drag ml-auto flex items-center gap-0.5 rounded-full p-0.5">
          <button
            onClick={() => setLyrics(!showLyrics)}
            aria-pressed={showLyrics}
            title="Lyrics"
            className={cn("pressable grid size-8 place-items-center rounded-full transition-colors", showLyrics ? "bg-white text-black" : "text-white/80 hover:bg-white/10 hover:text-white")}
          >
            <MicVocal className="size-4" />
          </button>
          <button onClick={() => void window.encore.app.toggleFullScreen()} title="Full screen (F11)" className="pressable grid size-8 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
            <Expand className="size-4" />
          </button>
        </div>
      </div>

      <div className={cn("relative z-[1] mx-auto flex h-full max-w-[1500px] items-center gap-[6vw] px-[6vw] pb-10 pt-20", !showLyrics && "justify-center")}>
        <motion.div layout transition={{ type: "spring", stiffness: 200, damping: 30 }} className={cn("flex shrink-0 flex-col", showLyrics ? "w-[min(38vw,460px)]" : "w-[min(52vh,520px)]")}>
          <Cover src={track?.artwork} title={track?.title ?? ""} />
          <div className="mt-8 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-[26px] font-bold leading-tight tracking-[-0.025em]">{track?.title ?? "Nothing playing"}</h2>
              <button
                onClick={() => {
                  const artist = track?.artists.find((a) => a.id);
                  if (artist?.id) {
                    closeFullscreen();
                    navigate({ name: "artist", id: artist.id });
                  }
                }}
                className="max-w-full truncate text-left text-[17px] text-white/65 transition-colors hover:text-white"
              >
                {track?.artists.map((a) => a.name).join(", ")}
              </button>
            </div>
            {track && <LikeButton track={track} size="size-6" className="mt-1 text-white/70" />}
          </div>
          <div className="mt-6">
            <Controls />
          </div>
        </motion.div>

        <AnimatePresence>
          {showLyrics && (
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
              className="h-full min-w-0 flex-1"
            >
              <LyricsView track={track} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function FullscreenPlayer() {
  const open = useView((s) => s.fullscreen);
  return createPortal(<AnimatePresence>{open && <Fullscreen />}</AnimatePresence>, document.body);
}
