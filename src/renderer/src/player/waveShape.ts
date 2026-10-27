// The seek bar's shape, as plain data: a song split into stretches, each
// with how loud it was when it played. player/waveform.ts measures it.

/** how many stretches a song is split into, whatever its length */
export const BUCKETS = 120;
// 36 steps of loudness, one character each; "." is a stretch not heard yet
const STEPS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** loudness of each stretch from 0 to 1, or null where it hasn't been heard */
export type Shape = (number | null)[];

export const emptyShape = (): Shape => Array.from({ length: BUCKETS }, () => null);

export function encodeShape(shape: Shape): string {
  return shape.map((v) => (v === null ? "." : STEPS[Math.round(Math.min(1, Math.max(0, v)) * (STEPS.length - 1))])).join("");
}

export function decodeShape(text: string): Shape {
  const shape = emptyShape();
  for (let i = 0; i < Math.min(BUCKETS, text.length); i++) {
    const step = STEPS.indexOf(text[i]);
    shape[i] = step < 0 ? null : step / (STEPS.length - 1);
  }
  return shape;
}

/** a stretch's average signal level on a scale that looks like what you hear: -48 dBFS is silence, -6 dBFS is full */
export function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 48) / 42));
}

export interface Bar {
  /** 0 to 1 of the bar's full height */
  height: number;
  /** false for a stretch not heard yet, drawn as the preview */
  known: boolean;
}

/** the shape as `count` bars: each bar takes the loudest stretch under it, scaled so the song's loudest is full height */
export function barHeights(shape: Shape, count: number): Bar[] {
  const known = shape.filter((v): v is number => v !== null);
  const top = Math.max(0.2, ...known);
  const bottom = Math.min(top - 0.2, ...known);
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * shape.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * shape.length) / count));
    let value: number | null = null;
    for (let b = from; b < to; b++) {
      const v = shape[b];
      if (v !== null && (value === null || v > value)) value = v;
    }
    if (value === null) return { height: 0.3 + 0.05 * Math.sin(i * 0.9) * Math.sin(i * 0.23), known: false };
    // spread what the song actually uses over most of the height, keeping quiet parts visible
    const spread = (value - bottom) / Math.max(0.05, top - bottom);
    return { height: 0.16 + 0.84 * Math.min(1, Math.max(0, spread)) ** 1.15, known: true };
  });
}

/** collects samples into stretches; a stretch is written when playback moves to another one */
export class ShapeRecorder {
  private bucket = -1;
  private sum = 0;
  private count = 0;

  constructor(readonly shape: Shape) {}

  /** a sample at `position` seconds into a song `duration` long; true when a stretch was written */
  add(position: number, duration: number, rms: number): boolean {
    if (!(duration > 0)) return false;
    const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor((position / duration) * BUCKETS)));
    const wrote = bucket !== this.bucket && this.flush();
    if (bucket !== this.bucket) {
      this.bucket = bucket;
      this.sum = 0;
      this.count = 0;
    }
    this.sum += rms * rms;
    this.count++;
    return wrote;
  }

  /** writes the stretch being heard; true if it had any samples */
  flush(): boolean {
    if (this.bucket < 0 || this.count === 0) return false;
    this.shape[this.bucket] = levelFromRms(Math.sqrt(this.sum / this.count));
    this.count = 0;
    this.sum = 0;
    return true;
  }
}
