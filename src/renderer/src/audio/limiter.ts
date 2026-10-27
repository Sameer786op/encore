// A look-ahead peak limiter: it keeps the music under a ceiling without
// touching anything that's already under it. The sound is delayed by a few
// milliseconds so the limiter sees a peak coming and can lower the volume
// smoothly before it arrives, then let it back up gently afterwards. When no
// peak is near, the volume stays at exactly 1 and every sample passes through
// unchanged.
//
// This runs inside an AudioWorklet (player/limiter.worklet.ts), and on its own
// in tests.

export interface LimiterOptions {
  /** the loudest a sample may be, in dB below full scale (0 is full scale) */
  ceilingDb: number;
  /** how far ahead it looks, which is also how long it takes to lower the volume */
  lookaheadMs?: number;
  /** how long the volume takes to come back after a peak */
  releaseMs?: number;
  channels?: number;
}

export const dbToLinear = (db: number) => Math.pow(10, db / 20);

export class PeakLimiter {
  /** samples of look-ahead, L */
  readonly lookahead: number;
  private ceiling: number;
  private readonly releaseCoef: number;
  /** the music, delayed by L samples */
  private readonly delay: Float32Array[];
  private pos = 0;
  /** the smallest gain needed over the last L + 1 samples, as a monotonic queue */
  private readonly queueGain: Float32Array;
  private readonly queueAt: Float64Array;
  private head = 0;
  private tail = 0;
  private count = 0;
  /** the held gains of the last L samples, averaged into a smooth ramp */
  private readonly held: Float32Array;
  private heldSum: number;
  /** how many of those are below 1, so "no peak near" is exact and never drifts */
  private heldBelow = 0;
  private gain = 1;
  private lowest = 1;

  constructor(sampleRate: number, { ceilingDb, lookaheadMs = 5, releaseMs = 150, channels = 2 }: LimiterOptions) {
    this.lookahead = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
    this.ceiling = dbToLinear(ceilingDb);
    this.releaseCoef = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.lookahead));
    this.queueGain = new Float32Array(this.lookahead + 2);
    this.queueAt = new Float64Array(this.lookahead + 2);
    this.held = new Float32Array(this.lookahead).fill(1);
    this.heldSum = this.lookahead;
  }

  setCeiling(db: number): void {
    this.ceiling = dbToLinear(db);
  }

  /** the lowest gain applied since the last call, in dB (0 when nothing was limited) */
  takeReductionDb(): number {
    const db = 20 * Math.log10(this.lowest);
    this.lowest = 1;
    return db;
  }

  /**
   * Limits `frames` samples from `input` into `output`, channel by channel. Missing input
   * channels count as silence; output channels past the limiter's own are left alone.
   */
  process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
    const L = this.lookahead;
    const size = this.queueGain.length;
    const channels = Math.min(output.length, this.delay.length);
    for (let i = 0; i < frames; i++) {
      // the gain this sample needs, from its loudest channel
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const v = Math.abs(input[c]?.[i] ?? 0);
        if (v > peak) peak = v;
      }
      const need = peak > this.ceiling ? this.ceiling / peak : 1;

      // hold the smallest need of the last L + 1 samples
      const at = this.count++;
      while (this.tail > this.head && this.queueGain[(this.tail - 1) % size] >= need) this.tail--;
      this.queueGain[this.tail % size] = need;
      this.queueAt[this.tail % size] = at;
      this.tail++;
      while (this.queueAt[this.head % size] < at - L) this.head++;
      const hold = this.queueGain[this.head % size];

      // average the held gain over L samples: a ramp that reaches the needed gain just as the peak comes out
      const old = this.held[this.pos];
      this.held[this.pos] = hold;
      this.heldSum += hold - old;
      this.heldBelow += (hold < 1 ? 1 : 0) - (old < 1 ? 1 : 0);
      let target = 1;
      if (this.heldBelow === 0) this.heldSum = L;
      else target = this.heldSum / L;

      // down at once (the ramp already makes that smooth), back up slowly
      if (target <= this.gain) this.gain = target;
      else {
        this.gain += (target - this.gain) * this.releaseCoef;
        if (target === 1 && this.gain > 0.999999) this.gain = 1;
      }
      if (this.gain < this.lowest) this.lowest = this.gain;

      for (let c = 0; c < channels; c++) {
        const line = this.delay[c];
        const out = line[this.pos];
        line[this.pos] = input[c]?.[i] ?? 0;
        output[c][i] = this.gain === 1 ? out : out * this.gain;
      }
      this.pos = this.pos + 1 === L ? 0 : this.pos + 1;
    }
  }
}
