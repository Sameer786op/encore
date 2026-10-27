import { useCallback, useState } from "react";
import { AudioLines, MicVocal } from "lucide-react";
import { SoundPanel } from "@/components/SoundPanel";
import { PlayingBars } from "@/components/PlayingBars";
import { soundLabel } from "@/player/quality";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { cn } from "@/lib/cn";
import { rampAt } from "@/ui/ramp";
import { TileHead, Tile } from "./Tile";
import { useLiveLevels } from "./hooks";

// Live bass and vocal-range meters, read from the music as it plays, and the
// sound chain at a glance (it opens Speed & sound).

const SEGMENTS = 16;

function Meter({ icon, label, hint, level }: { icon: React.ReactNode; label: string; hint: string; level: number }) {
  const lit = Math.round(level * SEGMENTS);
  return (
    <div title={hint} className="flex items-center gap-3 rounded-[14px] bg-[var(--row-on)] py-[7px] pl-[7px] pr-2 shadow-[inset_0_0_0_1px_var(--ring)]">
      <span className="grid size-7 place-items-center rounded-full bg-white/[0.08] text-ink moss:bg-snow">{icon}</span>
      <b className="w-[58px] text-[12.5px] font-bold">{label}</b>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="ml-auto flex gap-[2.5px]">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} className={cn("h-[18px] w-[5px] rounded-[2px] transition-[opacity] duration-100", i >= lit && "opacity-25")} style={{ background: i < lit ? rampAt(i / (SEGMENTS - 1)) : "var(--color-ink-3)" }} />
        ))}
      </div>
    </div>
  );
}

export function SoundMeters({ height, index = 0 }: { height: number; index?: number }) {
  const status = usePlayer((s) => s.status);
  const pure = useSettings((s) => s.pureSound);
  const levelling = useSettings((s) => s.levelling);
  const levels = useLiveLevels();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = soundLabel(status === "loading", pure, levelling);

  return (
    <Tile index={index} label="Sound" className="flex flex-col px-6 py-5" style={{ height }}>
      <TileHead title="Sound">
        <button
          ref={setAnchor}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Speed & sound"
          className="pressable inline-flex items-center gap-2 rounded-full bg-[var(--row-on)] py-1 pl-2 pr-2.5 text-[11px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--ring)] hover:text-ink"
        >
          <PlayingBars paused={status !== "playing"} className="h-2.5" />
          {label}
        </button>
      </TileHead>
      <div className="mt-auto flex flex-col gap-[7px]">
        <Meter icon={<AudioLines className="size-3.5" />} label="Bass" hint="How loud the low end is right now, 30 to 250 Hz" level={levels.bass} />
        <Meter icon={<MicVocal className="size-3.5" />} label="Vocals" hint="How loud the vocal range is right now, 300 Hz to 3.4 kHz" level={levels.vocals} />
      </div>
      <SoundPanel anchor={anchor} open={open} onClose={close} />
    </Tile>
  );
}
