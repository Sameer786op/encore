import { useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, ImagePlus, Pipette, Trash2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Segmented } from "@/components/common";
import { cn } from "@/lib/cn";
import { useSettings, type GlassArea, type Settings } from "@/settings/store";
import { effectiveTheme, revealChange } from "@/ui/appearance";
import { ACCENTS } from "@/ui/colors";
import { toast } from "@/ui/toast";

// Settings → Appearance: light or dark, the accent colour (which also
// recolours the logo and the taskbar icon), what fills the background, and
// how the glass looks.

/** a setting whose control needs the full width, below its title */
function Block({ title, body, action, children }: { title: string; body?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-white/[0.07] py-4 last:border-b-0">
      <div className="flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{title}</div>
          {body && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{body}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </div>
  );
}

export function Range({ label, value, min, max, step = 1, format, onChange }: { label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex items-center gap-3">
      <span className="w-[4.5rem] shrink-0 text-[12.5px] text-ink-2">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range min-w-0 flex-1"
        style={{ "--fill": `${fill}%` } as CSSProperties}
      />
      <span className="w-11 shrink-0 text-right text-[12.5px] tabular-nums text-ink-2">{format(value)}</span>
    </label>
  );
}

const THEMES: { value: Settings["theme"]; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Match Windows" },
];

/** a tiny window in the given theme, drawn in fixed colours so it looks the same in either theme */
function ThemePreview({ theme }: { theme: Settings["theme"] }) {
  const pane = (light: boolean) => {
    const line = light ? "bg-[rgb(0_0_0/0.14)]" : "bg-[rgb(255_255_255/0.2)]";
    const faint = light ? "bg-[rgb(0_0_0/0.08)]" : "bg-[rgb(255_255_255/0.1)]";
    return (
      <div className={cn("absolute inset-0 flex gap-1.5 p-1.5", light ? "bg-[#e9ebf1]" : "bg-[#141418]")}>
        <div className={cn("flex w-[30%] flex-col gap-1 rounded-[5px] p-1.5", light ? "bg-[rgb(255_255_255/0.9)] shadow-sm" : "bg-[rgb(255_255_255/0.07)]")}>
          <div className="size-2.5 rounded-[3px] bg-accent" />
          <div className={cn("mt-0.5 h-1 w-4/5 rounded-full", line)} />
          <div className={cn("h-1 w-3/5 rounded-full", faint)} />
          <div className={cn("h-1 w-2/3 rounded-full", faint)} />
        </div>
        <div className="flex flex-1 flex-col gap-1 pt-1">
          <div className={cn("h-1.5 w-1/2 rounded-full", light ? "bg-[rgb(0_0_0/0.25)]" : "bg-[rgb(255_255_255/0.35)]")} />
          <div className="mt-0.5 flex gap-1">
            <div className="aspect-square flex-1 rounded-[4px] bg-gradient-to-br from-accent-2 to-accent-deep" />
            <div className={cn("aspect-square flex-1 rounded-[4px]", faint)} />
            <div className={cn("aspect-square flex-1 rounded-[4px]", faint)} />
          </div>
          <div className={cn("mt-auto h-2.5 rounded-full", light ? "bg-[rgb(255_255_255/0.95)] shadow-sm" : "bg-[rgb(255_255_255/0.09)]")} />
        </div>
      </div>
    );
  };
  return (
    <div className="relative h-[68px] overflow-hidden rounded-[10px]">
      {theme === "system" ? (
        <>
          {pane(false)}
          <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">{pane(true)}</div>
        </>
      ) : (
        pane(theme === "light")
      )}
    </div>
  );
}

function ThemePicker() {
  const theme = useSettings((s) => s.theme);
  const update = useSettings((s) => s.update);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
      {THEMES.map((t) => {
        const on = theme === t.value;
        return (
          <button
            key={t.value}
            role="radio"
            aria-checked={on}
            onClick={(e) => !on && revealChange(() => update({ theme: t.value }), { x: e.clientX, y: e.clientY })}
            className="pressable group text-left"
          >
            <div className={cn("rounded-[13px] p-[3px] ring-2 transition-[box-shadow] duration-300", on ? "ring-accent" : "ring-transparent group-hover:ring-white/15")}>
              <ThemePreview theme={t.value} />
            </div>
            <div className={cn("mt-2 flex items-center gap-1.5 px-1 text-[12.5px] font-medium", on ? "text-ink" : "text-ink-2")}>
              {on && <Check className="size-3.5 text-accent" strokeWidth={3} />}
              {t.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Swatch({ color, label, selected, onClick, children }: { color: string; label: string; selected: boolean; onClick?: (e: React.MouseEvent) => void; children?: ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="pressable relative grid size-8 place-items-center rounded-full"
      style={{ background: color }}
    >
      <span className={cn("pointer-events-none absolute -inset-[4px] rounded-full ring-2 transition-[box-shadow,opacity] duration-300", selected ? "opacity-100 ring-ink/80" : "opacity-0 ring-transparent")} />
      <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.35),inset_0_0_0_0.5px_rgb(0_0_0/0.15)]" />
      {children}
    </button>
  );
}

function AccentPicker() {
  const accent = useSettings((s) => s.accent);
  const custom = useSettings((s) => s.customAccent);
  const update = useSettings((s) => s.update);
  const name = accent === "custom" ? "Custom" : (ACCENTS.find((a) => a.id === accent)?.name ?? "Encore");

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <Logo className="size-14 drop-shadow-[0_8px_18px_rgb(var(--accent-rgb)/0.45)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap items-center gap-3">
          {ACCENTS.map((a) => (
            <Swatch
              key={a.id}
              color={a.logo ? `linear-gradient(135deg, ${a.logo[0]}, ${a.logo[1]})` : a.color}
              label={a.name}
              selected={accent === a.id}
              onClick={(e) => accent !== a.id && revealChange(() => update({ accent: a.id }), { x: e.clientX, y: e.clientY })}
            />
          ))}
          <Swatch
            color={accent === "custom" ? custom : "conic-gradient(from 180deg, #ff3b30, #ffcc00, #34c759, #00c7be, #0a84ff, #af52de, #ff2d87, #ff3b30)"}
            label="Pick any color"
            selected={accent === "custom"}
          >
            <Pipette className="relative size-3.5 text-snow drop-shadow" />
            {/* the colour well covers the swatch, so a click opens the system colour picker */}
            <input
              type="color"
              aria-label="Pick any color"
              value={custom}
              onClick={() => accent !== "custom" && update({ accent: "custom" })}
              onChange={(e) => update({ accent: "custom", customAccent: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </Swatch>
        </div>
        <div className="mt-2.5 text-[12.5px] text-ink-3">
          <span className="font-medium text-ink-2">{name}</span>
          {accent === "custom" && <span className="ml-1.5 font-mono uppercase">{custom}</span>}
        </div>
      </div>
    </div>
  );
}

function BackgroundSettings() {
  const background = useSettings((s) => s.background);
  const look = useSettings((s) => s.artworkLook);
  const wallpaper = useSettings((s) => s.wallpaper);
  const update = useSettings((s) => s.update);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setBusy(true);
    try {
      const url = await window.encore.app.pickWallpaper();
      if (url) update({ background: "wallpaper", wallpaper: { ...wallpaper, url } });
    } catch (error) {
      toast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That picture couldn't be used");
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    void window.encore.app.clearWallpaper();
    update({ background: "artwork", wallpaper: { ...wallpaper, url: null } });
  };
  const light = effectiveTheme(useSettings((s) => s.theme)) === "light";
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <Block
      title="Background"
      body={
        background === "artwork"
          ? "A soft glow from the cover of what's playing, or of the album you're looking at."
          : background === "wallpaper"
            ? "A picture or animated GIF of your own fills the window."
            : "A plain colour, nothing behind the glass."
      }
      action={
        <Segmented
          label="Background"
          value={background}
          onChange={(value) => (value === "wallpaper" && !wallpaper.url ? void choose() : update({ background: value }))}
          options={[
            { value: "artwork", label: "Artwork" },
            { value: "wallpaper", label: "Wallpaper" },
            { value: "plain", label: "Plain" },
          ]}
        />
      }
    >
      {background === "wallpaper" && wallpaper.url && (
        <div className="mb-3.5 flex items-center gap-4">
          <div className="relative h-[72px] w-32 shrink-0 overflow-hidden rounded-[10px] bg-surface-3">
            <img src={wallpaper.url} alt="Your wallpaper" className="size-full object-cover" style={{ filter: wallpaper.blur ? `blur(${wallpaper.blur / 4}px)` : undefined }} />
            <div className="absolute inset-0" style={{ backgroundColor: `rgb(var(--backdrop-tint) / ${wallpaper.dim})` }} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => void choose()} disabled={busy} className="glass-control pressable inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125 disabled:opacity-60">
              <ImagePlus className="size-4" /> Change
            </button>
            <button onClick={remove} className="glass-control pressable inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125">
              <Trash2 className="size-4" /> Remove
            </button>
          </div>
        </div>
      )}
      {background === "artwork" && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          <Range label="Blur" value={look.blur} min={20} max={160} format={(v) => `${v}px`} onChange={(blur) => update({ artworkLook: { ...look, blur } })} />
          <Range label={light ? "Fade" : "Dim"} value={look.dim} min={0} max={0.9} step={0.01} format={percent} onChange={(dim) => update({ artworkLook: { ...look, dim } })} />
        </div>
      )}
      {background === "wallpaper" && wallpaper.url && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          <Range label="Blur" value={wallpaper.blur} min={0} max={60} format={(v) => `${v}px`} onChange={(blur) => update({ wallpaper: { ...wallpaper, blur } })} />
          <Range label={light ? "Fade" : "Dim"} value={wallpaper.dim} min={0} max={0.9} step={0.01} format={percent} onChange={(dim) => update({ wallpaper: { ...wallpaper, dim } })} />
        </div>
      )}
    </Block>
  );
}

const AREAS: { value: GlassArea; label: string }[] = [
  { value: "sidebar", label: "Sidebar" },
  { value: "player", label: "Player and queue" },
  { value: "panels", label: "Everything else" },
];

function GlassSettings() {
  const glass = useSettings((s) => s.glass);
  const areas = useSettings((s) => s.glassAreas);
  const update = useSettings((s) => s.update);
  const [area, setArea] = useState<GlassArea>("sidebar");
  const current = areas[area];
  const tune = (patch: Partial<Settings["glassAreas"][GlassArea]>) => update({ glassAreas: { ...areas, [area]: { ...current, ...patch } } });

  return (
    <Block
      title="Glass"
      body={
        glass === "custom"
          ? "Set how see-through and how blurred each part of the window is."
          : glass === "clear"
            ? "Clear lets more of the background show through."
            : "Tinted is darker and easier to read."
      }
      action={
        <Segmented
          label="Glass"
          value={glass}
          onChange={(value) => {
            // custom starts from the look you had
            if (value === "custom" && glass !== "custom") {
              const opacity = glass === "tinted" ? 64 : 30;
              update({ glass: value, glassAreas: { sidebar: { opacity, blur: 22 }, player: { opacity, blur: 22 }, panels: { opacity, blur: 22 } } });
            } else update({ glass: value });
          }}
          options={[
            { value: "clear", label: "Clear" },
            { value: "tinted", label: "Tinted" },
            { value: "custom", label: "Custom" },
          ]}
        />
      }
    >
      {glass === "custom" && (
        <div>
          <div className="flex items-center gap-1.5">
            {AREAS.map((a) => (
              <button
                key={a.value}
                onClick={() => setArea(a.value)}
                className={cn("relative rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors", area === a.value ? "text-on-accent" : "bg-white/[0.07] text-ink-2 hover:bg-white/[0.11] hover:text-ink")}
              >
                {area === a.value && <motion.span layoutId="glass-area" className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="relative">{a.label}</span>
              </button>
            ))}
            <button
              onClick={() => update({ glassAreas: { sidebar: { ...current }, player: { ...current }, panels: { ...current } } })}
              className="ml-auto rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-accent hover:bg-accent/10"
            >
              Use for all
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2">
            <Range label="Opacity" value={current.opacity} min={5} max={100} format={(v) => `${v}%`} onChange={(opacity) => tune({ opacity })} />
            <Range label="Blur" value={current.blur} min={0} max={48} format={(v) => `${v}px`} onChange={(blur) => tune({ blur })} />
          </div>
        </div>
      )}
    </Block>
  );
}

export function AppearanceSettings() {
  return (
    <div className="fill-group rounded-[20px] px-5">
      <Block title="Theme" body="Dark, light, or whichever Windows is using.">
        <ThemePicker />
      </Block>
      <Block title="Color" body="Recolours buttons and highlights, the Encore logo, and its icon on the taskbar.">
        <AccentPicker />
      </Block>
      <BackgroundSettings />
      <GlassSettings />
    </div>
  );
}
