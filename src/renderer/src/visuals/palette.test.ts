import { describe, expect, it } from "vitest";
import { extractPalette, FALLBACK_PALETTE, forBackground, type RGB } from "./palette";

function image(colors: [RGB, number][]): number[] {
  const pixels: number[] = [];
  for (const [[r, g, b], count] of colors) for (let i = 0; i < count; i++) pixels.push(r, g, b, 255);
  return pixels;
}

describe("palette", () => {
  it("finds the main colours of a cover, biggest first", () => {
    const palette = extractPalette(image([[[220, 30, 40], 300], [[20, 40, 200], 150], [[10, 10, 10], 50]]), 3);
    expect(palette[0][0]).toBeGreaterThan(180); // red leads
    expect(palette.some((c) => c[2] > 150 && c[0] < 80)).toBe(true); // blue is there
  });

  it("falls back when there is nothing to look at", () => {
    expect(extractPalette([], 4)).toBe(FALLBACK_PALETTE);
    expect(extractPalette([255, 0, 0, 0], 4)).toBe(FALLBACK_PALETTE);
  });

  it("keeps background colours dark enough for white text", () => {
    for (const [r, g, b] of forBackground([[255, 255, 200], [250, 240, 20]])) {
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      expect(lightness).toBeLessThanOrEqual(0.43);
      expect(lightness).toBeGreaterThanOrEqual(0.11);
    }
    expect(forBackground([], 4)).toHaveLength(4);
  });
});
