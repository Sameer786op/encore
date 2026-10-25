// When a listen counts, by Last.fm's rules (ListenBrainz asks for the same):
// the song is longer than 30 seconds, and you've heard half of it or
// 4 minutes, whichever comes first.

const MIN_TRACK_MS = 30_000;
const ENOUGH_MS = 240_000;

/** how long you must listen before it counts; null when the song is too short to ever count */
export function scrobbleThreshold(durationMs: number): number | null {
  if (durationMs > 0 && durationMs <= MIN_TRACK_MS) return null;
  return durationMs > 0 ? Math.min(durationMs / 2, ENOUGH_MS) : ENOUGH_MS;
}

export function shouldScrobble(durationMs: number, listenedMs: number): boolean {
  const threshold = scrobbleThreshold(durationMs);
  return threshold !== null && listenedMs >= threshold;
}
