// The main colours of a cover, for the full-screen player's moving background.

export type RGB = [number, number, number];

export const FALLBACK_PALETTE: RGB[] = [
  [76, 29, 149],
  [190, 24, 93],
  [30, 58, 138],
  [17, 24, 39],
];

function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

const distance = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means over the cover's pixels; returns the biggest, most colourful groups first */
export function extractPalette(pixels: Uint8ClampedArray | number[], count = 4): RGB[] {
  const points: RGB[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    points.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  if (points.length === 0) return FALLBACK_PALETTE;

  // start from points spread across the brightness range
  const byLight = [...points].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers: RGB[] = Array.from({ length: count }, (_, i) => byLight[Math.floor(((i + 0.5) / count) * (byLight.length - 1))]);
  let groups: RGB[][] = [];
  for (let round = 0; round < 10; round++) {
    groups = centers.map(() => []);
    for (const p of points) {
      let best = 0;
      for (let c = 1; c < centers.length; c++) if (distance(p, centers[c]) < distance(p, centers[best])) best = c;
      groups[best].push(p);
    }
    centers = groups.map((g, i) =>
      g.length === 0 ? centers[i] : ([0, 1, 2].map((ch) => Math.round(g.reduce((s, p) => s + p[ch], 0) / g.length)) as RGB),
    );
  }
  return centers
    .map((color, i) => ({ color, weight: groups[i].length * (0.35 + saturation(color)) }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((c) => c.color);
}

function toHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round) as RGB;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255)) as RGB;
}

/** rich but dark enough that white text stays readable on top */
export function forBackground(palette: RGB[], count = 4): RGB[] {
  const colors = palette.length > 0 ? palette : FALLBACK_PALETTE;
  return Array.from({ length: count }, (_, i) => {
    const [h, s, l] = toHsl(colors[i % colors.length]);
    return fromHsl([h, s < 0.08 ? s : Math.max(0.35, Math.min(0.85, s * 1.15)), Math.max(0.12, Math.min(0.42, l * 0.8))]);
  });
}
