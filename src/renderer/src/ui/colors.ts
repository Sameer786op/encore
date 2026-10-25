// Accent colours: the presets, and the small amount of colour maths needed to
// keep any accent readable on a dark or a light window.

export interface AccentPreset {
  id: string;
  name: string;
  color: string;
  /** a two-colour swatch of its own instead of a flat one */
  logo?: [string, string];
}

export const ACCENTS: AccentPreset[] = [
  { id: "encore", name: "Ruby", color: "#fa2d48" },
  { id: "sunset", name: "Sunset", color: "#ff7a1a" },
  { id: "amber", name: "Amber", color: "#ffb800" },
  { id: "forest", name: "Forest", color: "#34c759" },
  { id: "mint", name: "Mint", color: "#00c7be" },
  { id: "ocean", name: "Ocean", color: "#0a84ff" },
  { id: "indigo", name: "Indigo", color: "#5e5ce6" },
  { id: "violet", name: "Violet", color: "#af52de" },
  { id: "berry", name: "Berry", color: "#ff2d87" },
  { id: "aurora", name: "Aurora", color: "#40c8f4", logo: ["#2ee6c5", "#7a5cff"] },
  { id: "graphite", name: "Graphite", color: "#8e8e93", logo: ["#9a9aa1", "#3a3a40"] },
];

export const DEFAULT_ACCENT = ACCENTS[0];

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** nudge a colour toward black or white until it stands out from the background */
function readable(color: Rgb, background: Rgb, minimum: number): Rgb {
  const toward = luminance(background) > 0.5 ? BLACK : WHITE;
  let out = color;
  for (let step = 1; step <= 10 && contrast(out, background) < minimum; step++) out = mix(color, toward, step * 0.06);
  return out;
}

export interface AccentShades {
  /** buttons, highlights and links */
  accent: string;
  /** a lighter partner for gradients */
  light: string;
  /** a deeper one for the bottom of gradients */
  deep: string;
  /** "r g b", for shadows and glows with their own transparency */
  rgb: string;
  /** white or near-black, whichever reads better on the accent */
  onAccent: string;
  /** the logo's gradient, top to bottom */
  logo: [string, string, string];
}

// roughly what sits behind the accent in each theme
const DARK_SURFACE: Rgb = [24, 24, 28];
const LIGHT_SURFACE: Rgb = [242, 242, 247];

export function accentShades(color: string, theme: "dark" | "light", logo?: [string, string]): AccentShades {
  const base = parseHex(color) ?? parseHex(DEFAULT_ACCENT.color)!;
  // the accent is also used for text and small icons, so it must stand out from the window
  const accent = readable(base, theme === "light" ? LIGHT_SURFACE : DARK_SURFACE, 2.6);
  const onAccent = contrast(WHITE, accent) >= 3 ? "#ffffff" : "#16161a";
  return {
    accent: toHex(accent),
    light: toHex(mix(accent, WHITE, 0.32)),
    deep: toHex(mix(accent, BLACK, 0.35)),
    rgb: accent.map(Math.round).join(" "),
    onAccent,
    logo: logo ? [logo[0], toHex(mix(parseHex(logo[0])!, parseHex(logo[1])!, 0.5)), logo[1]] : [toHex(mix(base, WHITE, 0.3)), toHex(base), toHex(mix(base, BLACK, 0.22))],
  };
}

export function presetFor(id: string): AccentPreset | undefined {
  return ACCENTS.find((a) => a.id === id);
}
