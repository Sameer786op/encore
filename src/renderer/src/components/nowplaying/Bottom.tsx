import { useCallback, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AudioLines, ListMusic, MicVocal } from "lucide-react";
import type { Track } from "@shared/types";
import { SPRING } from "@/components/common";
import { EASE } from "@/components/Specimen";
import { Transport } from "@/components/PlayerBar";
import { SoundPanel } from "@/components/SoundPanel";
import { WaveSeek } from "@/components/WaveSeek";
import { useLyrics } from "@/lyrics/useLyrics";
import { upcomingItems } from "@/player/queue";
import { soundLabel } from "@/player/quality";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { useHints } from "@/ui/shortcuts";
import { useView } from "@/ui/view";
import { cn } from "@/lib/cn";
import { formatTime, plural } from "@/lib/format";

// The full-screen player's controls: the buttons, the waveform you seek on,
// and three chips that say how the lyrics, the queue and the sound stand and
// open them. Volume lives in the Sound chip's panel.

function Chip({ icon, label, note, on, ref, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: string; note: string; on?: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.95 }}
      transition={SPRING}
      aria-label={label}
      title={`${label}: ${note}`}
      className="flex h-[46px] shrink-0 items-center gap-2.5 rounded-full bg-[var(--row-on)] py-[5px] pl-[5px] pr-4 text-left shadow-[inset_0_0_0_1px_var(--ring)] transition-colors duration-200 hover:bg-white/[0.16] moss:hover:bg-snow @max-[880px]:pr-[5px]"
      {...(props as object)}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-300", on ? "bg-ink text-bg" : "bg-white/[0.08] text-ink moss:bg-snow")}>{icon}</span>
      <span className="leading-tight @max-[880px]:hidden">
        <b className="block font-display text-[12.5px] font-semibold">{label}</b>
        <small className="block whitespace-nowrap text-[10.5px] font-semibold text-ink-3">{note}</small>
      </span>
    </motion.button>
  );
}

function LyricsChip({ track }: { track: Track }) {
  const shown = useView((s) => s.lyrics);
  const state = useLyrics(track);
  const hint = useHints();
  const lyrics = state.status === "ready" ? state.lyrics : null;
  const note = !shown ? "hidden" : state.status === "loading" ? "finding…" : lyrics?.synced ? "synced" : lyrics ? "not synced" : "none found";
  return (
    <Chip
      icon={<MicVocal className="size-4" />}
      label="Lyrics"
      note={note}
      on={shown}
      aria-pressed={shown}
      onClick={() => useView.getState().setLyrics(!shown)}
      title={hint("lyrics", `Lyrics: ${note}`)}
    />
  );
}

function QueueChip({ open, onClick }: { open: boolean; onClick: () => void }) {
  const count = usePlayer((s) => upcomingItems(s.queue).length);
  return <Chip icon={<ListMusic className="size-4" />} label="Queue" note={count === 0 ? "nothing next" : plural(count, "song")} on={open} aria-pressed={open} onClick={onClick} />;
}

function SoundChip() {
  const loading = usePlayer((s) => s.status === "loading");
  const muted = usePlayer((s) => s.muted || s.volume === 0);
  const pure = useSettings((s) => s.pureSound);
  const levelling = useSettings((s) => s.levelling);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = soundLabel(loading, pure, levelling);
  return (
    <>
      <Chip
        ref={setAnchor}
        icon={<AudioLines className="size-4" />}
        label="Sound"
        note={muted ? "muted" : label.charAt(0).toLowerCase() + label.slice(1)}
        on={open}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      />
      <SoundPanel anchor={anchor} open={open} onClose={close} volume />
    </>
  );
}

export function BottomBar({ track, queueOpen, onQueue }: { track: Track; queueOpen: boolean; onQueue: () => void }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const still = useReducedMotion();
  // not a Tile: the seek bar's time tip shows above the bar, so nothing here clips
  return (
    <motion.section
      aria-label="Playback"
      initial={still ? false : { opacity: 0, y: 24, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
      className="tile @container absolute inset-x-[22px] bottom-[22px] isolate z-[1] flex h-[96px] items-center gap-[22px] px-5 @max-[880px]:gap-3.5"
    >
      {/* a faint ember glow behind the buttons, in Ember */}
      <span aria-hidden className="ember-only pointer-events-none absolute inset-0 -z-[1] rounded-[24px] bg-[radial-gradient(30%_160%_at_0%_50%,rgb(var(--accent-rgb)/0.16),transparent_70%)]" />
      <Transport />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="w-10 shrink-0 text-right font-display text-[13px] tabular-nums text-ink-2">{formatTime(position)}</span>
        <WaveSeek className="h-[54px] min-w-0 flex-1" />
        <span className="w-10 shrink-0 font-display text-[13px] tabular-nums text-ink-3">{formatTime(duration)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <LyricsChip track={track} />
        <QueueChip open={queueOpen} onClick={onQueue} />
        <SoundChip />
      </div>
    </motion.section>
  );
}
