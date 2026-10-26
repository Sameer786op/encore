import type { Settings } from "@/settings/store";
import { forGlow, type RGB } from "./palette";

// The colours of the edge light, the line of light that runs round the window
// while the full-screen player shows lyrics.

export interface EdgePreset {
  id: string;
  name: string;
  colors: [string, string, string];
}

export const EDGE_PRESETS: EdgePreset[] = [
  { id: "neon", name: "Neon", colors: ["#ff2fd0", "#8f3bff", "#ff5c9d"] },
  { id: "aurora", name: "Aurora", colors: ["#00f5c4", "#00a3ff", "#8b5cff"] },
  { id: "sunset", name: "Sunset", colors: ["#ff8a00", "#ff2d6f", "#ffd23f"] },
  { id: "ocean", name: "Ocean", colors: ["#00d4ff", "#3a5bff", "#00ffc8"] },
  { id: "ember", name: "Ember", colors: ["#ff4000", "#ff0a54", "#ffb300"] },
  { id: "ice", name: "Ice", colors: ["#e8f6ff", "#7cc8ff", "#b9a8ff"] },
];

/** "#f0a" or "#ff00aa"; anything else is null */
export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

export interface EdgeLook {
  /** two or three colours, spread round the edge and back to the first */
  colors: RGB[];
  /** every colour in turn instead */
  rainbow: boolean;
}

const NEON = EDGE_PRESETS[0].colors.map((c) => hexToRgb(c)!);

/** what the edge light shows for these settings; `cover` is the playing song's palette */
export function edgeLook(config: Settings["edgeLight"], cover: RGB[]): EdgeLook {
  if (config.colors === "rainbow") return { colors: NEON, rainbow: true };
  if (config.colors === "artwork") return { colors: forGlow(cover, 3), rainbow: false };
  if (config.colors === "custom") {
    const custom = config.custom.map(hexToRgb).filter((c): c is RGB => c !== null);
    return { colors: custom.length >= 2 ? custom.slice(0, 3) : NEON, rainbow: false };
  }
  const preset = EDGE_PRESETS.find((p) => p.id === config.colors) ?? EDGE_PRESETS[0];
  return { colors: preset.colors.map((c) => hexToRgb(c)!), rainbow: false };
}
