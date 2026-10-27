import { useCallback, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines, Gauge, ListMusic, LoaderCircle, MicVocal, Pause, PictureInPicture2, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { useView } from "@/ui/view";
import { navigate } from "@/nav/store";
import { useCurrentTrack, usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { useHints } from "@/ui/shortcuts";
import { Artwork } from "./Artwork";
import { ArtistLinks, LikeButton, SPRING } from "./common";
import { LiquidGlass } from "./LiquidGlass";
import { Slider } from "./Slider";
import { formatSpeed, isNormalSound, SoundPanel } from "./SoundPanel";
import { trackMenu } from "./trackMenu";

/** a borderless glyph button; a soft round highlight appears under it on hover */
function Glyph({ children, className, active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; children: ReactNode; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <motion.button
      whileTap={{ scale: 0.86 }}
      transition={SPRING}
      className={cn(
        "grid size-9 place-items-center rounded-full transition-colors duration-200 disabled:pointer-events-none disabled:opacity-30",
        active ? "bg-accent/15 text-accent" : "text-ink/90 hover:bg-white/[0.08] hover:text-ink",
        className,
      )}
      {...(props as object)}
    >
      {children}
    </motion.button>
  );
}

function Transport() {
  const status = usePlayer((s) => s.status);
  const shuffle = usePlayer((s) => s.queue.shuffle);
  const repeat = usePlayer((s) => s.queue.repeat);
  const hasTrack = usePlayer((s) => s.queue.index >= 0);
  const { togglePlay, next, previous, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const playing = status === "playing";
  const loading = status === "loading";
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const hint = useHints();

  return (
    <div className="flex items-center gap-0.5">
      <Glyph onClick={toggleShuffle} active={shuffle} aria-label={shuffle ? "Turn shuffle off" : "Turn shuffle on"} aria-pressed={shuffle} title={hint("shuffle", "Shuffle")} className="size-8">
        <Shuffle className="size-[15px]" strokeWidth={2.3} />
      </Glyph>
      <Glyph onClick={previous} disabled={!hasTrack} aria-label="Previous" title={hint("previous", "Previous")}>
        <SkipBack className="size-[19px]" fill="currentColor" strokeWidth={1.5} />
      </Glyph>
      <Glyph onClick={togglePlay} disabled={!hasTrack} aria-label={playing || loading ? "Pause" : "Play"} title={hint("playPause", "Play/Pause")} className="size-11">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={loading ? "loading" : playing ? "pause" : "play"}
            initial={{ opacity: 0, scale: 0.4, filter: "blur(3px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.4, filter: "blur(3px)" }}
            transition={{ type: "spring", stiffness: 600, damping: 32, filter: { duration: 0.16, ease: "easeOut" } }}
            className="grid place-items-center"
          >
            {loading ? (
              <LoaderCircle className="size-[22px] animate-spin" />
            ) : playing ? (
              <Pause className="size-[26px]" fill="currentColor" strokeWidth={0} />
            ) : (
              <Play className="ml-0.5 size-[26px]" fill="currentColor" strokeWidth={0} />
            )}
          </motion.span>
        </AnimatePresence>
      </Glyph>
      <Glyph onClick={next} disabled={!hasTrack} aria-label="Next" title={hint("next", "Next")}>
        <SkipForward className="size-[19px]" fill="currentColor" strokeWidth={1.5} />
      </Glyph>
      <Glyph onClick={cycleRepeat} active={repeat !== "off"} aria-label={`Repeat: ${repeat}`} title={hint("repeat", "Repeat")} className="size-8">
        <RepeatIcon className="size-[15px]" strokeWidth={2.3} />
      </Glyph>
    </div>
  );
}

/** the little screen in the middle: cover, song, artist and where we are in it */
function NowPlaying() {
  const hint = useHints();
  const track = useCurrentTrack();
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);

  return (
    <div className="flex h-[54px] min-w-0 flex-1 items-center rounded-[14px] bg-[var(--well)] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.06),inset_0_1px_3px_rgb(0_0_0/calc(0.25*var(--shadow-k)))]">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.button
          key={track?.id ?? "none"}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          onClick={() => track && useView.getState().openFullscreen()}
          aria-label="Open the full-screen player"
          title={hint("nowPlaying", "Full-screen player")}
          className="group/art relative block shrink-0 p-[5px]"
        >
          {track ? (
            <Artwork src={track.artwork} className="size-[44px] rounded-[9px] shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/art:scale-[1.06]" />
          ) : (
            <span className="grid size-[44px] place-items-center rounded-[9px] bg-white/[0.06] text-ink-3">
              <AudioLines className="size-5" />
            </span>
          )}
        </motion.button>
      </AnimatePresence>

      {track ? (
        <div className="flex min-w-0 flex-1 flex-col justify-center pl-1.5 pr-1" onContextMenu={(e) => openMenu(e, trackMenu(track))}>
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1 leading-tight">
              <button
                onClick={() => track.album?.id && navigate({ name: "album", id: track.album.id })}
                className={cn("block max-w-full truncate text-left text-[13px] font-semibold text-ink", track.album?.id && "hover:underline hover:decoration-white/40 hover:underline-offset-2")}
              >
                {track.title}
              </button>
              <ArtistLinks artists={track.artists} className="block text-[12px] text-ink-2" />
            </div>
            <LikeButton track={track} className="shrink-0" size="size-[15px]" />
          </div>
          <div className="flex items-center gap-2 pr-1.5">
            <span className="w-8 text-right text-[10px] font-medium tabular-nums text-ink-3">{formatTime(position)}</span>
            <Slider value={position} max={duration} label="Seek" onCommit={seek} step={5} formatValue={formatTime} className="h-3 flex-1" thin />
            <span className="w-8 text-[10px] font-medium tabular-nums text-ink-3">{formatTime(duration)}</span>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col justify-center pl-1.5">
          <div className="text-[13px] font-semibold text-ink-2">Not playing</div>
          <div className="text-[12px] text-ink-3">Pick a song to start listening</div>
          {/* the seek bar is always here, so it can be found before anything plays */}
          <div className="sr-only">
            <Slider value={0} max={0} label="Seek" step={5} />
          </div>
        </div>
      )}
    </div>
  );
}

/** opens speed, key lock and reverb; shows the speed while it isn't normal */
function SoundButton() {
  const sound = useSettings((s) => s.sound);
  const pure = useSettings((s) => s.pureSound);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const changed = !pure && !isNormalSound(sound);
  const showSpeed = !pure && sound.speed !== 1;
  return (
    <>
      <Glyph
        ref={setAnchor}
        onClick={() => setOpen(!open)}
        active={changed || pure || open}
        aria-label={`Speed and sound${pure ? ": Pure sound" : changed ? `: ${formatSpeed(sound.speed)}` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Speed & sound"
        className={showSpeed ? "w-auto px-2" : undefined}
      >
        {showSpeed ? <span className="text-[11.5px] font-semibold tabular-nums">{formatSpeed(sound.speed)}</span> : <Gauge className="size-[17px]" />}
      </Glyph>
      <SoundPanel anchor={anchor} open={open} onClose={close} />
    </>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const { setVolume, toggleMute } = usePlayer.getState();
  const shown = muted ? 0 : volume;
  const Icon = shown === 0 ? VolumeX : shown < 0.34 ? Volume : shown < 0.67 ? Volume1 : Volume2;
  const hint = useHints();
  return (
    <div className="flex items-center gap-1">
      <Glyph onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title={hint("mute", "Mute")} className="size-8">
        <Icon className="size-[17px]" />
      </Glyph>
      <Slider value={shown * 100} max={100} label="Volume" onChange={(v) => setVolume(v / 100)} step={5} formatValue={(v) => `${Math.round(v)}%`} className="hidden w-[88px] @min-[760px]:flex" />
    </div>
  );
}

export function PlayerBar({ right }: { right: number }) {
  const queueOpen = usePlayer((s) => s.queueOpen);
  const setQueueOpen = usePlayer((s) => s.setQueueOpen);
  const hasTrack = usePlayer((s) => s.queue.index >= 0);
  const lyricsOpen = useView((s) => s.fullscreen && s.lyrics);
  const miniOpen = useView((s) => s.miniOpen);
  const inset = { left: "calc(var(--sidebar-w) + 8px)", right };
  const hint = useHints();

  return (
    <>
      {/* the page darkens a little as it slides under the player */}
      <div aria-hidden className="pointer-events-none absolute bottom-0 z-20 h-28 bg-gradient-to-t from-[rgb(var(--backdrop-tint)/0.75)] via-[rgb(var(--backdrop-tint)/0.3)] to-transparent" style={inset} />
      <div className="pointer-events-none absolute bottom-3 z-30 flex justify-center px-3" style={inset}>
        <LiquidGlass
          area="player"
          as="footer"
          radius={24}
          sheen
          className="@container pointer-events-auto flex h-[66px] w-full max-w-[1180px] items-center gap-3 pl-2 pr-2.5"
        >
          <Transport />
          <NowPlaying />
          <div className="flex shrink-0 items-center gap-0.5">
            <SoundButton />
            <Glyph
              onClick={() => (lyricsOpen ? useView.getState().closeFullscreen() : useView.getState().openFullscreen(true))}
              disabled={!hasTrack}
              active={lyricsOpen}
              aria-label="Lyrics"
              aria-pressed={lyricsOpen}
              title={hint("lyrics", "Lyrics")}
              className="size-8"
            >
              <MicVocal className="size-[17px]" />
            </Glyph>
            <Glyph
              onClick={() => void (miniOpen ? window.encore.mini.close() : window.encore.mini.open())}
              active={miniOpen}
              aria-label="Mini player"
              aria-pressed={miniOpen}
              title={hint("mini", "Mini player")}
              className="size-8"
            >
              <PictureInPicture2 className="size-[17px]" />
            </Glyph>
            <Glyph onClick={() => setQueueOpen(!queueOpen)} active={queueOpen} aria-label="Queue" aria-pressed={queueOpen} title={hint("queue", "Queue")} className="size-8">
              <ListMusic className="size-[17px]" />
            </Glyph>
            <VolumeControl />
          </div>
        </LiquidGlass>
      </div>
    </>
  );
}
