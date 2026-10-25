import { BAND_Q, bandType, EQ_FREQUENCIES } from "./eq";

// The equalizer's frequency response, worked out from the same filter
// formulas the browser uses (the Audio EQ Cookbook), so the curve on screen
// matches what you hear and updates instantly while dragging.

const SAMPLE_RATE = 48_000;

function biquadDb(type: BiquadFilterType, f0: number, gainDb: number, q: number, f: number): number {
  if (gainDb === 0) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === "peaking") {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    // shelves, with the browser's fixed slope of 1
    const alpha = (sin / 2) * Math.sqrt(2);
    const sq = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      b0 = A * (A + 1 - (A - 1) * cos + sq);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sq);
      a0 = A + 1 + (A - 1) * cos + sq;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sq;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sq);
      a0 = A + 1 - (A - 1) * cos + sq;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sq;
    }
  }
  const w = (2 * Math.PI * f) / SAMPLE_RATE;
  // |H(e^jw)| from the transfer function
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2w = Math.cos(2 * w);
  const s2w = Math.sin(2 * w);
  const numRe = b0 + b1 * cw + b2 * c2w;
  const numIm = -(b1 * sw + b2 * s2w);
  const denRe = a0 + a1 * cw + a2 * c2w;
  const denIm = -(a1 * sw + a2 * s2w);
  const mag = Math.sqrt((numRe ** 2 + numIm ** 2) / (denRe ** 2 + denIm ** 2));
  return 20 * Math.log10(mag);
}

/** total gain in dB at each frequency for a set of band gains */
export function eqResponse(bands: number[], preamp: number, frequencies: number[]): number[] {
  return frequencies.map((f) => preamp + bands.reduce((sum, gain, i) => sum + biquadDb(bandType(i), EQ_FREQUENCIES[i], gain, BAND_Q, f), 0));
}

/** frequencies spaced evenly on a log scale, 20 Hz to 20 kHz */
export function logFrequencies(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 20 * Math.pow(1000, i / (count - 1)));
}
