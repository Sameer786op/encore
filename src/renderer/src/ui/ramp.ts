/** a colour along the signature gradient, t from 0 (its start) to 1 (its end) */
export function rampAt(t: number): string {
  return t < 0.5 ? `color-mix(in oklab, var(--ramp-2) ${t * 200}%, var(--ramp-1))` : `color-mix(in oklab, var(--ramp-3) ${(t - 0.5) * 200}%, var(--ramp-2))`;
}
