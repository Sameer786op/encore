import { describe, expect, it } from "vitest";
import { clampDb, EQ_FREQUENCIES, EQ_PRESETS, suggestedPreamp } from "./eq";
import { eqResponse, logFrequencies } from "./response";

describe("equalizer", () => {
  it("has a full set of bands in every preset", () => {
    for (const [name, bands] of Object.entries(EQ_PRESETS)) {
      expect(bands, name).toHaveLength(EQ_FREQUENCIES.length);
      for (const db of bands) expect(Math.abs(db)).toBeLessThanOrEqual(12);
    }
  });

  it("is flat when every band is at zero", () => {
    for (const db of eqResponse(EQ_PRESETS.Flat, 0, logFrequencies(30))) expect(db).toBeCloseTo(0, 6);
  });

  it("boosts around a raised band and leaves far frequencies alone", () => {
    const bands = [...EQ_PRESETS.Flat];
    bands[5] = 6; // 1 kHz
    const [at1k, at60, at15k] = eqResponse(bands, 0, [1000, 60, 15000]);
    expect(at1k).toBeCloseTo(6, 0);
    expect(Math.abs(at60)).toBeLessThan(0.5);
    expect(Math.abs(at15k)).toBeLessThan(0.5);
  });

  it("shelves lift everything below the lowest band", () => {
    const bands = [...EQ_PRESETS.Flat];
    bands[0] = 6;
    const [at20, at10k] = eqResponse(bands, 0, [20, 10000]);
    expect(at20).toBeGreaterThan(5);
    expect(Math.abs(at10k)).toBeLessThan(0.2);
  });

  it("adds the preamp across the whole range", () => {
    for (const db of eqResponse(EQ_PRESETS.Flat, -3, [50, 1000, 12000])) expect(db).toBeCloseTo(-3, 6);
  });

  it("suggests a preamp that leaves room for boosts and rounds to half dB steps", () => {
    expect(suggestedPreamp(EQ_PRESETS["Bass boost"])).toBe(-6);
    expect(suggestedPreamp(EQ_PRESETS["Bass cut"])).toBe(-0);
    expect(clampDb(13)).toBe(12);
    expect(clampDb(2.26)).toBe(2.5);
  });
});
