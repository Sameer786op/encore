import { AnimatePresence, motion } from "motion/react";
import { Disc3, Pipette } from "lucide-react";
import { Toggle } from "@/components/common";
import { useCurrentTrack } from "@/player/store";
import { useSettings, type Settings } from "@/settings/store";
import { EDGE_PRESETS, edgeLook } from "@/visuals/edgeColors";
import { EdgeLight } from "@/visuals/EdgeLight";
import { forGlow, type RGB } from "@/visuals/palette";
import { usePalette } from "@/visuals/usePalette";
import { Range, Swatch } from "./AppearanceSettings";
import { Row } from "./parts";

// Settings → Lyrics: the edge light, a line of light round the window while
// the full-screen player shows lyrics. Its colours, how fast they travel,
// how far the glow reaches, and whether it pulses with the music.

type EdgeConfig = Settings["edgeLight"];

const css = (c: RGB) => `rgb(${c.join(" ")})`;
const RAINBOW = "conic-gradient(from 180deg, #ff3b30, #ffcc00, #34c759, #00c7be, #0a84ff, #af52de, #ff2d87, #ff3b30)";

/** a tiny full-screen player with the light running round it */
function Preview({ edge, cover }: { edge: EdgeConfig; cover: RGB[] }) {
  const [a, b] = cover;
  return (
    <div
      className="relative isolate aspect-[16/10] w-[208px] shrink-0 overflow-hidden rounded-[12px] bg-[#0b0b10]"
      style={{ background: `radial-gradient(circle at 25% 30%, ${css(a)}, transparent 70%), radial-gradient(circle at 80% 80%, ${css(b)}, transparent 65%), #0b0b10` }}
      aria-label="Edge light preview"
      role="img"
    >
      <div className="absolute inset-y-0 left-[9%] flex w-[30%] flex-col justify-center gap-1.5">
        <div className="aspect-square w-full rounded-[5px] bg-[rgb(255_255_255/0.16)]" />
        <div className="h-1 w-4/5 rounded-full bg-[rgb(255_255_255/0.5)]" />
        <div className="h-1 w-1/2 rounded-full bg-[rgb(255_255_255/0.25)]" />
      </div>
      <div className="absolute inset-y-0 left-[48%] right-[9%] flex flex-col justify-center gap-2">
        <div className="h-1.5 w-3/4 rounded-full bg-[rgb(255_255_255/0.22)]" />
        <div className="h-1.5 w-full rounded-full bg-[rgb(255_255_255/0.92)]" />
        <div className="h-1.5 w-2/3 rounded-full bg-[rgb(255_255_255/0.22)]" />
        <div className="h-1.5 w-5/6 rounded-full bg-[rgb(255_255_255/0.22)]" />
      </div>
      <EdgeLight
        {...edgeLook(edge, cover)}
        speed={edge.speed}
        glow={edge.glow}
        pulse={edge.pulse}
        radius={12}
        followPlayback={false}
        className="absolute inset-0 mix-blend-plus-lighter"
      />
    </div>
  );
}

/** a colour well that looks like a swatch; a click opens the system colour picker */
function ColorWell({ value, label, onChange }: { value: string; label: string; onChange: (hex: string) => void }) {
  return (
    <span className="pressable relative grid size-7 place-items-center rounded-full" style={{ background: value }} title={label}>
      <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.35),inset_0_0_0_0.5px_rgb(0_0_0/0.15)]" />
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </span>
  );
}

function ColorPicker({ edge, cover, set }: { edge: EdgeConfig; cover: RGB[]; set: (patch: Partial<EdgeConfig>) => void }) {
  const glow = forGlow(cover, 3);
  const name =
    edge.colors === "rainbow"
      ? "Rainbow"
      : edge.colors === "artwork"
        ? "Match the cover"
        : edge.colors === "custom"
          ? "Your colors"
          : (EDGE_PRESETS.find((p) => p.id === edge.colors)?.name ?? "Neon");
  const note = edge.colors === "artwork" ? "Changes with each song." : edge.colors === "custom" ? "Pick the two colors it flows between." : null;

  return (
    <div>
      <div role="radiogroup" aria-label="Edge light colors" className="flex flex-wrap items-center gap-3">
        {EDGE_PRESETS.map((p) => (
          <Swatch key={p.id} color={`linear-gradient(135deg, ${p.colors.join(", ")})`} label={p.name} selected={edge.colors === p.id} onClick={() => set({ colors: p.id })} />
        ))}
        <Swatch color={RAINBOW} label="Rainbow" selected={edge.colors === "rainbow"} onClick={() => set({ colors: "rainbow" })} />
        <Swatch color={`linear-gradient(135deg, ${glow.map(css).join(", ")})`} label="Match the cover" selected={edge.colors === "artwork"} onClick={() => set({ colors: "artwork" })}>
          <Disc3 className="relative size-3.5 text-snow drop-shadow" />
        </Swatch>
        <Swatch color={`linear-gradient(135deg, ${edge.custom.join(", ")})`} label="Your colors" selected={edge.colors === "custom"} onClick={() => set({ colors: "custom" })}>
          <Pipette className="relative size-3.5 text-snow drop-shadow" />
        </Swatch>
      </div>
      <div className="mt-2.5 flex min-h-7 items-center gap-2.5 text-[12.5px] text-ink-3">
        <span className="font-medium text-ink-2">{name}</span>
        {note && <span>{note}</span>}
        {edge.colors === "custom" && (
          <span className="ml-1 flex items-center gap-2">
            {edge.custom.map((hex, i) => (
              <ColorWell
                key={i}
                value={hex}
                label={`Edge light color ${i + 1}`}
                onChange={(value) => set({ custom: (i === 0 ? [value, edge.custom[1]] : [edge.custom[0], value]) as [string, string] })}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export function EdgeLightSettings() {
  const edge = useSettings((s) => s.edgeLight);
  const update = useSettings((s) => s.update);
  const cover = usePalette(useCurrentTrack()?.artwork);
  const set = (patch: Partial<EdgeConfig>) => update({ edgeLight: { ...useSettings.getState().edgeLight, ...patch } });

  return (
    <>
      <Row title="Edge light" body="A line of light runs round the window while lyrics show in the full-screen player.">
        <Toggle checked={edge.enabled} onChange={(enabled) => set({ enabled })} label="Edge light" />
      </Row>
      <AnimatePresence initial={false}>
        {edge.enabled && (
          <motion.div
            key="edge-options"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-6 border-b border-white/[0.07] py-4">
              <Preview edge={edge} cover={cover} />
              <div className="min-w-0 flex-1 space-y-4">
                <ColorPicker edge={edge} cover={cover} set={set} />
                <div className="space-y-2.5">
                  <Range label="Speed" value={edge.speed} min={0} max={100} format={(v) => (v === 0 ? "Still" : `${v}%`)} onChange={(speed) => set({ speed })} />
                  <Range label="Glow" value={edge.glow} min={0} max={100} format={(v) => `${v}%`} onChange={(glow) => set({ glow })} />
                </div>
              </div>
            </div>
            <Row title="Pulse with the music" body="The light swells with the bass and flashes on the beat.">
              <Toggle checked={edge.pulse} onChange={(pulse) => set({ pulse })} label="Pulse with the music" />
            </Row>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
