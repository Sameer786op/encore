import { describe, expect, it } from "vitest";
import { barHeights, BUCKETS, decodeShape, emptyShape, encodeShape, levelFromRms, ShapeRecorder } from "./waveShape";

describe("waveform shapes", () => {
  it("round-trips through its stored text, keeping unheard stretches unknown", () => {
    const shape = emptyShape();
    shape[0] = 0;
    shape[5] = 0.5;
    shape[BUCKETS - 1] = 1;
    const text = encodeShape(shape);
    expect(text).toHaveLength(BUCKETS);
    const back = decodeShape(text);
    expect(back[0]).toBe(0);
    expect(back[5]).toBeCloseTo(0.5, 1);
    expect(back[BUCKETS - 1]).toBe(1);
    expect(back[1]).toBeNull();
  });

  it("reads a damaged or short stored shape without throwing", () => {
    const back = decodeShape("z!3");
    expect(back).toHaveLength(BUCKETS);
    expect(back[0]).toBe(1);
    expect(back[1]).toBeNull();
    expect(back[3]).toBeNull();
  });

  it("puts loudness on a scale from silence to full", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(0.001)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(0.1)).toBeGreaterThan(levelFromRms(0.03));
  });

  it("writes a stretch once playback moves past it", () => {
    const recorder = new ShapeRecorder(emptyShape());
    const duration = BUCKETS; // one second per stretch
    expect(recorder.add(0.1, duration, 0.2)).toBe(false);
    expect(recorder.add(0.6, duration, 0.2)).toBe(false);
    expect(recorder.shape[0]).toBeNull();
    expect(recorder.add(1.2, duration, 0.05)).toBe(true);
    expect(recorder.shape[0]).toBeCloseTo(levelFromRms(0.2));
    expect(recorder.flush()).toBe(true);
    expect(recorder.shape[1]).toBeCloseTo(levelFromRms(0.05));
    // a seek leaves the stretches skipped over unknown
    recorder.add(60.5, duration, 0.3);
    recorder.flush();
    expect(recorder.shape[30]).toBeNull();
    expect(recorder.shape[60]).toBeCloseTo(levelFromRms(0.3));
  });

  it("ignores samples before the length is known", () => {
    const recorder = new ShapeRecorder(emptyShape());
    expect(recorder.add(3, 0, 0.5)).toBe(false);
    expect(recorder.flush()).toBe(false);
    expect(recorder.shape.every((v) => v === null)).toBe(true);
  });

  it("draws heard stretches to scale and the rest as an even preview", () => {
    const shape = emptyShape();
    for (let i = 0; i < 60; i++) shape[i] = i < 30 ? 0.4 : 0.9;
    const bars = barHeights(shape, 40);
    expect(bars).toHaveLength(40);
    expect(bars[0].known).toBe(true);
    expect(bars[15].known).toBe(true);
    expect(bars[39].known).toBe(false);
    // the loudest heard stretch is full height, the quiet half lower
    expect(bars[15].height).toBeCloseTo(1, 2);
    expect(bars[0].height).toBeLessThan(0.5);
    // the preview stays low and even
    const preview = bars.filter((b) => !b.known).map((b) => b.height);
    expect(Math.max(...preview) - Math.min(...preview)).toBeLessThan(0.11);
    expect(Math.max(...preview)).toBeLessThan(0.4);
  });

  it("gives more bars than stretches without gaps", () => {
    const shape = emptyShape().map(() => 0.5);
    const bars = barHeights(shape, BUCKETS * 2);
    expect(bars.every((b) => b.known)).toBe(true);
  });
});
