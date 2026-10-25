import type { Track } from "@shared/types";

// Rules for moving from one song to the next: when to start a crossfade,
// when to get the next song ready, and how loud each song should be.

/** get the next song buffered this long before the current one ends */
export const PRELOAD_SECONDS = 30;

export interface TransitionInput {
  remaining: number;
  crossfadeSeconds: number;
  /** a different song comes next (not repeat-one, not the end) */
  next: Track | null;
  current: Track | null;
  crossfadeSameAlbum: boolean;
  alreadyStarted: boolean;
}

/** albums are often mixed without gaps; play them through instead of fading */
export function sameAlbum(a: Track | null, b: Track | null): boolean {
  if (!a?.album || !b?.album) return false;
  if (a.album.id && b.album.id) return a.album.id === b.album.id;
  return a.album.title.toLowerCase() === b.album.title.toLowerCase() && a.artists[0]?.name === b.artists[0]?.name;
}

export function shouldCrossfade(input: TransitionInput): boolean {
  const { remaining, crossfadeSeconds, next, current, crossfadeSameAlbum, alreadyStarted } = input;
  if (alreadyStarted || !next || crossfadeSeconds <= 0 || !Number.isFinite(remaining)) return false;
  if (!crossfadeSameAlbum && sameAlbum(current, next)) return false;
  // never fade a song that is barely longer than the fade itself
  return remaining > 0 && remaining <= crossfadeSeconds;
}

export function shouldPreload(remaining: number, crossfadeSeconds: number): boolean {
  return Number.isFinite(remaining) && remaining > 0 && remaining <= Math.max(PRELOAD_SECONDS, crossfadeSeconds + 5);
}

/** a crossfade can't be longer than half of either song */
export function fadeLength(crossfadeSeconds: number, currentDuration: number, nextDuration: number): number {
  const limit = Math.min(currentDuration > 0 ? currentDuration / 2 : Infinity, nextDuration > 0 ? nextDuration / 2 : Infinity);
  return Math.max(0, Math.min(crossfadeSeconds, limit));
}

/** equal-power fade: the total loudness stays even across the fade */
export function fadeCurve(direction: "in" | "out", points = 64): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    curve[i] = direction === "in" ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
  }
  return curve;
}

/**
 * How many dB to adjust a song by so everything plays at about the same
 * loudness. YouTube reports how much louder than its target a song is;
 * local files may carry ReplayGain, which aims 4 dB quieter than YouTube.
 */
export function levellingDb(info: { youtubeLoudnessDb?: number | null; replayGainDb?: number | null }): number {
  let db = 0;
  if (typeof info.youtubeLoudnessDb === "number") {
    // turn loud songs down fully; lift quiet ones only a little
    db = info.youtubeLoudnessDb > 0 ? -info.youtubeLoudnessDb : Math.min(-info.youtubeLoudnessDb, 4);
  } else if (typeof info.replayGainDb === "number") {
    db = info.replayGainDb + 4;
  }
  return Math.max(-15, Math.min(6, Math.round(db * 10) / 10));
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
