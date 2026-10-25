import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { drawGlyph, encodePng } from "./glyphs";

const alpha = (pixels: Buffer, size: number, x: number, y: number) => pixels[(y * size + x) * 4 + 3];

describe("player glyphs", () => {
  it("draws white shapes on a clear background", () => {
    const play = drawGlyph("play", 16);
    expect(play.length).toBe(16 * 16 * 4);
    expect(alpha(play, 16, 7, 8)).toBe(255); // inside the triangle
    expect(alpha(play, 16, 0, 0)).toBe(0); // the corner
    expect(alpha(play, 16, 14, 2)).toBe(0); // beside the point
    expect([...play.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it("leaves the gap between the pause bars clear", () => {
    const pause = drawGlyph("pause", 32);
    expect(alpha(pause, 32, 10, 16)).toBe(255);
    expect(alpha(pause, 32, 16, 16)).toBe(0);
    expect(alpha(pause, 32, 22, 16)).toBe(255);
  });

  it("smooths the edges", () => {
    const play = drawGlyph("play", 16);
    const partial = [...Array(256).keys()].map((i) => play[i * 4 + 3]).filter((a) => a > 0 && a < 255);
    expect(partial.length).toBeGreaterThan(4);
  });

  it("mirrors previous and next", () => {
    const next = drawGlyph("next", 16);
    const previous = drawGlyph("previous", 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(Math.abs(alpha(next, 16, x, y) - alpha(previous, 16, 15 - x, y))).toBeLessThan(40);
  });

  it("writes a PNG that holds the same pixels", () => {
    const pixels = drawGlyph("next", 20);
    const png = encodePng(pixels, 20);
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(20);
    const idat = png.indexOf("IDAT");
    const length = png.readUInt32BE(idat - 4);
    const rows = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    expect(rows.length).toBe(20 * (20 * 4 + 1));
    expect(rows.subarray(1, 81).equals(pixels.subarray(0, 80))).toBe(true);
  });
});
