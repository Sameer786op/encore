import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { describeQuality, useStreamQuality } from "@/player/quality";
import { useCurrentTrack } from "@/player/store";
import { useSettings, type Settings } from "@/settings/store";
import { cn } from "@/lib/cn";
import { Slider } from "./Slider";
import { Toggle } from "./common";

// Speed, key lock and reverb, from a button in the player bar. The presets
// are the popular edits people make of songs: slowed + reverb, sped up and
// nightcore.

type Sound = Settings["sound"];

export const SOUND_PRESETS: { id: string; name: string; speed: number; reverb: number }[] = [
  { id: "normal", name: "Normal", speed: 1, reverb: 0 },
  { id: "slowed", name: "Slowed + reverb", speed: 0.8, reverb: 0.4 },
  { id: "spedup", name: "Sped up", speed: 1.25, reverb: 0 },
  { id: "nightcore", name: "Nightcore", speed: 1.35, reverb: 0 },
];

const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const SPEED_STEP = 0.05;
const WIDTH = 312;
const MARGIN = 8;

export const formatSpeed = (speed: number) => `${Number(speed.toFixed(2))}×`;

export const isNormalSound = (sound: Sound) => sound.speed === 1 && sound.reverb === 0;

function presetOf(sound: Sound): string | null {
  return SOUND_PRESETS.find((p) => Math.abs(p.speed - sound.speed) < 0.001 && Math.abs(p.reverb - sound.reverb) < 0.001)?.id ?? null;
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular-nums text-ink-2">{value}</span>
      </div>
      {children}
    </div>
  );
}

/** what the song that's playing streams at */
function QualityLine() {
  const quality = useStreamQuality(useCurrentTrack());
  if (!quality) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.08] pt-3 text-[12.5px]">
      <span className="font-medium text-ink">Quality</span>
      <span className="truncate tabular-nums text-ink-2" title={quality === "local" ? undefined : "The best YouTube Music offers without Premium"}>
        {quality === "local" ? "Your file, as it is" : describeQuality(quality)}
      </span>
    </div>
  );
}

function Panel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const sound = useSettings((s) => s.sound);
  const update = useSettings((s) => s.update);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const set = (patch: Partial<Sound>) => update({ sound: { ...useSettings.getState().sound, ...patch } });
  const preset = presetOf(sound);

  // sit just above the button, inside the window
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(window.innerWidth - WIDTH - MARGIN, Math.max(MARGIN, rect.left + rect.width / 2 - WIDTH / 2));
      setPos({ left, bottom: window.innerHeight - rect.top + 12 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      anchor.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, onClose]);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="Speed and sound"
      initial={{ opacity: 0, scale: 0.92, y: 8, filter: "blur(3px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.14, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ type: "spring", stiffness: 560, damping: 38, mass: 0.7, filter: { duration: 0.18, ease: "easeOut" } }}
      style={{ left: pos.left, bottom: pos.bottom, width: WIDTH }}
      className="glass-menu fixed z-50 origin-bottom space-y-4 rounded-[20px] p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink">Speed &amp; sound</h2>
        <button
          onClick={() => set({ speed: 1, reverb: 0 })}
          disabled={isNormalSound(sound)}
          className="rounded-full px-2 py-0.5 text-[12.5px] font-medium text-accent transition-opacity hover:bg-white/[0.06] disabled:opacity-0"
        >
          Reset
        </button>
      </div>

      <div role="radiogroup" aria-label="Presets" className="grid grid-cols-2 gap-1.5">
        {SOUND_PRESETS.map((p) => {
          const on = preset === p.id;
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={on}
              // these edits all move the key with the speed; that's what gives them their sound
              onClick={() => set(p.id === "normal" ? { speed: 1, reverb: 0 } : { speed: p.speed, reverb: p.reverb, keepPitch: false })}
              className={cn(
                "flex flex-col items-start rounded-[12px] px-3 py-2 text-left transition-colors duration-200",
                on ? "bg-accent text-on-accent" : "bg-white/[0.06] text-ink hover:bg-white/[0.1]",
              )}
            >
              <span className="text-[12.5px] font-semibold leading-tight">{p.name}</span>
              <span className={cn("text-[11px] tabular-nums", on ? "opacity-80" : "text-ink-3")}>{formatSpeed(p.speed)}</span>
            </button>
          );
        })}
      </div>

      <Row label="Speed" value={formatSpeed(sound.speed)}>
        <Slider
          value={sound.speed - MIN_SPEED}
          max={MAX_SPEED - MIN_SPEED}
          step={SPEED_STEP}
          label="Speed"
          formatValue={(v) => formatSpeed(v + MIN_SPEED)}
          onChange={(v) => set({ speed: Number((Math.round(v / SPEED_STEP) * SPEED_STEP + MIN_SPEED).toFixed(2)) })}
        />
      </Row>

      <Row label="Reverb" value={sound.reverb === 0 ? "Off" : `${Math.round(sound.reverb * 100)}%`}>
        <Slider
          value={sound.reverb * 100}
          max={100}
          step={5}
          label="Reverb"
          formatValue={(v) => `${Math.round(v)}%`}
          onChange={(v) => set({ reverb: Math.round(v) / 100 })}
        />
      </Row>

      <div className="flex items-center gap-3 border-t border-white/[0.08] pt-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink">Key lock</div>
          <div className="text-[11.5px] leading-snug text-ink-3">{sound.keepPitch ? "The speed changes, the key stays the same" : "The key rises and falls with the speed, like a record"}</div>
        </div>
        <Toggle checked={sound.keepPitch} onChange={(keepPitch) => set({ keepPitch })} label="Key lock" />
      </div>

      <QualityLine />
    </motion.div>
  );
}

/** the speed and sound panel, opened from `anchor` */
export function SoundPanel({ anchor, open, onClose }: { anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  return createPortal(<AnimatePresence>{open && anchor && <Panel anchor={anchor} onClose={onClose} />}</AnimatePresence>, document.body);
}
