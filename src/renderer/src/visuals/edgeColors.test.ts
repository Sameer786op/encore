import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/settings/store";
import { EDGE_PRESETS, edgeLook, hexToRgb } from "./edgeColors";
import type { RGB } from "./palette";

const config = (patch: Partial<typeof DEFAULT_SETTINGS.edgeLight>) => ({ ...DEFAULT_SETTINGS.edgeLight, ...patch });
const lightness = ([r, g, b]: RGB) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

describe("edge light colours", () => {
  it("reads short and long hex colours", () => {
    expect(hexToRgb("#ff00aa")).toEqual([255, 0, 170]);
    expect(hexToRgb("#F0A")).toEqual([255, 0, 170]);
    expect(hexToRgb("pink")).toBeNull();
  });

  it("starts as neon pink and purple", () => {
    expect(DEFAULT_SETTINGS.edgeLight.enabled).toBe(true);
    const look = edgeLook(DEFAULT_SETTINGS.edgeLight, []);
    expect(look.rainbow).toBe(false);
    expect(look.colors).toEqual(EDGE_PRESETS[0].colors.map(hexToRgb));
  });

  it("uses your two colours, or neon if they can't be read", () => {
    expect(edgeLook(config({ colors: "custom", custom: ["#00ff00", "#0000ff"] }), []).colors).toEqual([
      [0, 255, 0],
      [0, 0, 255],
    ]);
    expect(edgeLook(config({ colors: "custom", custom: ["nope", "#0000ff"] }), []).colors).toHaveLength(3);
  });

  it("turns a dark cover palette into bright light", () => {
    const look = edgeLook(config({ colors: "artwork" }), [
      [60, 20, 30],
      [20, 30, 70],
      [40, 40, 40],
    ]);
    expect(look.colors).toHaveLength(3);
    for (const c of look.colors) expect(lightness(c)).toBeGreaterThan(0.55);
    expect(look.colors[0][0]).toBeGreaterThan(look.colors[0][2]); // the red stays red
  });

  it("knows rainbow, and falls back to neon for a preset it doesn't know", () => {
    expect(edgeLook(config({ colors: "rainbow" }), []).rainbow).toBe(true);
    expect(edgeLook(config({ colors: "gone" }), []).colors).toEqual(EDGE_PRESETS[0].colors.map(hexToRgb));
  });
});
