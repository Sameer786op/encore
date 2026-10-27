import { useMemo } from "react";
import { motion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { clampDb, EQ_FREQUENCIES, EQ_MAX_DB, EQ_PRESETS, suggestedPreamp } from "@/audio/eq";
import { eqResponse, logFrequencies } from "@/audio/response";
import { useSettings } from "@/settings/store";
import { cn } from "@/lib/cn";

const CURVE_POINTS = 120;
const FREQS = logFrequencies(CURVE_POINTS);
const label = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

function Curve({ bands, preamp, enabled }: { bands: number[]; preamp: number; enabled: boolean }) {
  const path = useMemo(() => {
    const response = eqResponse(enabled ? bands : bands.map(() => 0), enabled ? preamp : 0, FREQS);
    return response
      .map((db, i) => {
        const x = (i / (CURVE_POINTS - 1)) * 100;
        const y = 50 - (Math.max(-18, Math.min(18, db)) / 18) * 45;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [bands, preamp, enabled]);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
      <defs>
        <linearGradient id="eq-stroke" x1="0" x2="1">
          <stop offset="0" style={{ stopColor: "var(--color-accent-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-accent)" }} />
        </linearGradient>
        <linearGradient id="eq-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopOpacity="0.28" style={{ stopColor: "var(--color-accent)" }} />
          <stop offset="1" stopOpacity="0" style={{ stopColor: "var(--color-accent)" }} />
        </linearGradient>
      </defs>
      <line x1="0" x2="100" y1="50" y2="50" style={{ stroke: "color-mix(in srgb, var(--color-white) 12%, transparent)" }} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      <path d={`${path} L100,100 L0,100 Z`} fill="url(#eq-fill)" opacity={enabled ? 1 : 0.3} />
      <path d={path} fill="none" stroke="url(#eq-stroke)" strokeWidth="2" vectorEffect="non-scaling-stroke" opacity={enabled ? 1 : 0.35} />
    </svg>
  );
}

function BandSlider({ value, onChange, label: text, disabled }: { value: number; onChange: (v: number) => void; label: string; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="h-4 text-[11px] font-medium tabular-nums text-ink-2">{value > 0 ? `+${value}` : value}</span>
      <input
        type="range"
        min={-EQ_MAX_DB}
        max={EQ_MAX_DB}
        step={0.5}
        value={value}
        disabled={disabled}
        aria-label={`${text} Hz`}
        onChange={(e) => onChange(clampDb(Number(e.target.value)))}
        onDoubleClick={() => onChange(0)}
        className="eq-range h-36"
      />
      <span className="text-[11px] text-ink-3">{text}</span>
    </div>
  );
}

export function Equalizer() {
  const eq = useSettings((s) => s.eq);
  const updateEq = useSettings((s) => s.updateEq);

  const setBand = (index: number, value: number) => {
    const bands = eq.bands.map((b, i) => (i === index ? value : b));
    updateEq({ bands, preset: "Custom" });
  };

  const choosePreset = (name: string) => {
    const bands = [...EQ_PRESETS[name]];
    updateEq({ preset: name, bands, preamp: suggestedPreamp(bands), enabled: true });
  };

  return (
    <div className={cn("fill-group rounded-[24px] p-5 transition-opacity", !eq.enabled && "opacity-80")}>
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(EQ_PRESETS).map((name) => (
          <button
            key={name}
            onClick={() => choosePreset(name)}
            className={cn(
              "relative rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
              eq.enabled && eq.preset === name ? "text-on-accent" : "bg-white/[0.07] text-ink-2 hover:bg-white/[0.11] hover:text-ink",
            )}
          >
            {eq.enabled && eq.preset === name && <motion.span layoutId="eq-preset" className="absolute inset-0 rounded-full bg-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4)]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{name}</span>
          </button>
        ))}
        {eq.preset === "Custom" && <span className="rounded-full bg-accent/20 px-3 py-1 text-[12.5px] font-medium text-accent-ink">Custom</span>}
      </div>

      <div className="mt-5">
        <Curve bands={eq.bands} preamp={eq.preamp} enabled={eq.enabled} />
      </div>

      <div className="mt-2 flex items-end justify-between gap-1">
        <div className="mr-3 border-r border-white/[0.08] pr-4">
          <BandSlider value={eq.preamp} onChange={(v) => updateEq({ preamp: v })} label="Pre" disabled={!eq.enabled} />
        </div>
        {EQ_FREQUENCIES.map((hz, i) => (
          <BandSlider key={hz} value={eq.bands[i] ?? 0} onChange={(v) => setBand(i, v)} label={label(hz)} disabled={!eq.enabled} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-[12px] text-ink-3">
        <span>Drag a band, or double-click it to reset. Boosts are limited so they never clip.</span>
        <button onClick={() => choosePreset("Flat")} className="pressable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-accent-ink hover:bg-accent/10">
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>
    </div>
  );
}
