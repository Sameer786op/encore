// Keeping a Jam guest's song at the same spot as the host's. The host says
// where it was and when, by its own clock; each guest works out the
// difference between the two clocks from pings, and from that where the
// host is right now.

/** where the host's song was, by the host's clock */
export interface Anchor {
  /** seconds into the song */
  position: number;
  /** the host's clock (ms) when it was there */
  at: number;
  playing: boolean;
  /** how fast it plays: 1 is normal */
  rate: number;
}

/** further apart than this (seconds), jump to the host's spot */
export const SEEK_DRIFT = 0.6;
/** closer than this, it's in time */
export const IN_TIME = 0.04;
/** at most this much faster or slower while catching up, so it isn't heard */
export const MAX_NUDGE = 0.03;
/** the seconds over which a small gap is made up */
const CATCH_UP_SECONDS = 3;

/** where the host's song is at `hostNow` */
export function positionAt(anchor: Anchor, hostNow: number): number {
  if (!anchor.playing) return anchor.position;
  return anchor.position + (Math.max(0, hostNow - anchor.at) / 1000) * anchor.rate;
}

export type Correction = { kind: "seek"; to: number } | { kind: "nudge"; rate: number };

/** what to do about the gap between where the host is and where we are; the nudge multiplies the host's speed */
export function correction(expected: number, actual: number): Correction {
  const drift = expected - actual;
  if (Math.abs(drift) > SEEK_DRIFT) return { kind: "seek", to: expected };
  if (Math.abs(drift) < IN_TIME) return { kind: "nudge", rate: 1 };
  return { kind: "nudge", rate: 1 + Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, drift / CATCH_UP_SECONDS)) };
}

interface Sample {
  offset: number;
  roundTrip: number;
}

/**
 * The host's clock, worked out from pings as NTP does: a reply that came back
 * quickly says the most about the difference, so the quickest recent one is used.
 */
export class HostClock {
  private samples: Sample[] = [];

  /** a ping sent at `sentAt` (our clock) came back at `receivedAt`, saying the host's clock read `hostTime` */
  add(sentAt: number, hostTime: number, receivedAt: number): void {
    const roundTrip = receivedAt - sentAt;
    if (!(roundTrip >= 0 && roundTrip < 10_000) || !Number.isFinite(hostTime)) return;
    this.samples.push({ offset: hostTime - (sentAt + receivedAt) / 2, roundTrip });
    if (this.samples.length > 12) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  private get best(): Sample | undefined {
    return this.samples.reduce<Sample | undefined>((best, s) => (!best || s.roundTrip < best.roundTrip ? s : best), undefined);
  }

  /** the host's clock minus ours, in ms */
  get offset(): number {
    return this.best?.offset ?? 0;
  }

  /** the quickest round trip, in ms */
  get roundTrip(): number | null {
    return this.best?.roundTrip ?? null;
  }

  /** the host's clock now */
  now(local = Date.now()): number {
    return local + this.offset;
  }
}
