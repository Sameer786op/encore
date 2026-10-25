// The 10-band equalizer: band layout, presets and the maths for drawing its curve.

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MAX_DB = 12;

export interface EqSettings {
  enabled: boolean;
  preset: string;
  /** gain before the bands, to make room for boosts */
  preamp: number;
  /** one gain in dB per frequency in EQ_FREQUENCIES */
  bands: number[];
}

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass boost": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  "Bass cut": [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
  "Treble boost": [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-3, -2, -1, 1, 3, 4, 3, 2, 0, -1],
  Rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  Pop: [-1, 1, 3, 4, 3, 1, -1, -1, 0, 1],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  "Hip-hop": [5, 4, 2, 3, -1, -1, 1, 0, 2, 3],
  Acoustic: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1],
  "Late night": [3, 2, 1, 0, -1, -1, 0, 1, 1, 0],
};

export const DEFAULT_EQ: EqSettings = { enabled: false, preset: "Flat", preamp: 0, bands: [...EQ_PRESETS.Flat] };

export function bandType(index: number): BiquadFilterType {
  if (index === 0) return "lowshelf";
  if (index === EQ_FREQUENCIES.length - 1) return "highshelf";
  return "peaking";
}

/** about an octave wide, so neighbouring bands blend smoothly */
export const BAND_Q = 1.1;

/** keep any boost from clipping: lower the preamp by the biggest boost */
export function suggestedPreamp(bands: number[]): number {
  return -Math.max(0, ...bands);
}

export function clampDb(value: number): number {
  return Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, Math.round(value * 2) / 2));
}
