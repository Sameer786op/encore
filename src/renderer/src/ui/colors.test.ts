import { describe, expect, it } from "vitest";
import { ACCENTS, accentShades, contrast, parseHex } from "./colors";

// what accent-coloured text sits on: Ember's black window, and Moss's glass and its slightly darker page
const EMBER_WINDOW = parseHex("#030303")!;
const MOSS_GLASS = parseHex("#f2f2f7")!;
const MOSS_PAGE = parseHex("#ecede7")!;

describe("accent colours", () => {
  it("keeps accent text at 4.5:1 or better in both modes, for every preset and odd custom colours", () => {
    const colors = [...ACCENTS.map((a) => a.color), "#ffff00", "#0000ff", "#7fff00", "#222222"];
    for (const color of colors) {
      const ember = parseHex(accentShades(color, "dark").ink)!;
      const moss = parseHex(accentShades(color, "light").ink)!;
      expect(contrast(ember, EMBER_WINDOW), `${color} on Ember`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(moss, MOSS_GLASS), `${color} on Moss glass`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(moss, MOSS_PAGE), `${color} on the Moss page`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves the Ember accent as it is where it already reads", () => {
    const shades = accentShades("#ff5a1f", "dark");
    expect(shades.ink).toBe(shades.accent);
  });
});
