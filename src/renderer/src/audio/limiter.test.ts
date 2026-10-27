import { describe, expect, it } from "vitest";
import { dbToLinear, PeakLimiter } from "./limiter";

const RATE = 48000;
const BLOCK = 128;

/** runs stereo signals through a limiter in 128-sample blocks, like the audio thread does */
function run(limiter: PeakLimiter, left: Float32Array, right = left): [Float32Array, Float32Array] {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(left.length);
  for (let start = 0; start < left.length; start += BLOCK) {
    const end = Math.min(left.length, start + BLOCK);
    const out = [new Float32Array(end - start), new Float32Array(end - start)];
    limiter.process([left.subarray(start, end), right.subarray(start, end)], out, end - start);
    outL.set(out[0], start);
    outR.set(out[1], start);
  }
  return [outL, outR];
}

const sine = (seconds: number, amplitude: number, hz = 440) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE));

const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("peak limiter", () => {
  it("passes music under the ceiling through bit for bit, only delayed", () => {
    const limiter = new PeakLimiter(RATE, { ceilingDb: 0 });
    const input = sine(0.5, 0.9);
    const [out] = run(limiter, input);
    const L = limiter.lookahead;
    expect(L).toBe(240); // 5 ms at 48 kHz
    for (let i = L; i < input.length; i++) expect(out[i]).toBe(input[i - L]);
    expect(limiter.takeReductionDb()).toBe(0);
  });

  it("never lets a peak past the ceiling", () => {
    const ceiling = dbToLinear(-0.5);
    const limiter = new PeakLimiter(RATE, { ceilingDb: -0.5 });
    // a loud tone with sudden spikes on top
    const input = sine(1, 1.4, 97);
    for (const at of [3000, 3001, 20000, 33333]) input[at] = at % 2 ? -3 : 3;
    const [outL, outR] = run(limiter, input);
    expect(peakOf(outL)).toBeLessThanOrEqual(ceiling * (1 + 1e-6));
    expect(peakOf(outR)).toBeLessThanOrEqual(ceiling * (1 + 1e-6));
    expect(limiter.takeReductionDb()).toBeLessThan(-9); // the spikes were 3x full scale
  });

  it("links the channels, so a peak on one side doesn't shift the stereo image", () => {
    const limiter = new PeakLimiter(RATE, { ceilingDb: 0 });
    const left = sine(0.2, 2);
    const right = sine(0.2, 0.5);
    const [outL, outR] = run(limiter, left, right);
    for (let i = 2000; i < left.length; i += 97) if (Math.abs(outR[i]) > 1e-4) expect(outL[i] / outR[i]).toBeCloseTo(4, 3);
  });

  it("lowers the volume smoothly before a peak and lets it back up slowly", () => {
    const limiter = new PeakLimiter(RATE, { ceilingDb: 0, releaseMs: 150 });
    // quiet steady signal with one loud click in the middle
    const input = new Float32Array(3 * RATE).fill(0.25);
    input[24000] = 2;
    const [out] = run(limiter, input);
    const L = limiter.lookahead;
    // the gain on each sample: what came out over what went in, a look-ahead earlier
    const gain = Array.from(out, (v, i) => (i < L ? 1 : v / input[i - L]));
    const peakOut = 24000 + L;
    // the ramp down starts a look-ahead early and never jumps by much in one sample
    expect(gain[peakOut - L - 1]).toBe(1);
    for (let i = peakOut - L; i < peakOut + 2 * L; i++) expect(Math.abs(gain[i + 1] - gain[i])).toBeLessThan(0.005);
    expect(out[peakOut]).toBeCloseTo(1, 5);
    // 50 ms later it's still on its way back up; a couple of seconds on it's untouched again
    expect(gain[peakOut + 2400]).toBeLessThan(0.95);
    expect(gain[peakOut + 2400]).toBeGreaterThan(out[peakOut] / 2);
    const settled = peakOut + Math.round(2.2 * RATE);
    expect(out.subarray(settled).every((v, i) => v === input[settled + i - L])).toBe(true);
  });

  it("treats a mono input as silence on the missing channel, and can change its ceiling", () => {
    const limiter = new PeakLimiter(RATE, { ceilingDb: 0 });
    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    limiter.process([new Float32Array(BLOCK).fill(0.5)], out, BLOCK);
    expect(peakOf(out[1])).toBe(0);
    limiter.setCeiling(-6);
    const [loud] = run(limiter, sine(0.2, 0.9));
    expect(peakOf(loud.subarray(2000))).toBeLessThanOrEqual(dbToLinear(-6) * (1 + 1e-6));
  });
});
