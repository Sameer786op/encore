import type { ArtistRef, RecentPlays, Track } from "@shared/types";

// The numbers on Home, worked out from your own plays (window.encore.history.recent).
// Days and months are local time, as you'd count them.

export type Play = RecentPlays["plays"][number];

const DAY_MS = 86_400_000;
/** daytime runs from 6 in the morning to 6 in the evening */
const DAY_STARTS = 6;
const NIGHT_STARTS = 18;

export function startOfDay(date: Date, daysBack = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack);
}

export function startOfMonth(date: Date, monthsBack = 0): Date {
  return new Date(date.getFullYear(), date.getMonth() - monthsBack, 1);
}

/** where Home starts asking for plays: the first of last month */
export function statsSince(now: Date): Date {
  return startOfMonth(now, 1);
}

/** the same stretch of last month as this month has had so far, to compare fairly */
function lastMonthSoFar(now: Date): [Date, Date] {
  const from = startOfMonth(now, 1);
  const thisMonth = startOfMonth(now);
  const to = new Date(Math.min(from.getTime() + (now.getTime() - thisMonth.getTime()), thisMonth.getTime()));
  return [from, to];
}

/** which day `when` falls on, counting from `first` (rounded, as days around a clock change aren't 24 hours) */
const dayIndex = (when: Date, first: Date) => Math.round((startOfDay(when).getTime() - first.getTime()) / DAY_MS);
const at = (p: Play) => new Date(p.playedAt).getTime();
const between = (p: Play, from: Date, to: Date) => at(p) >= from.getTime() && at(p) < to.getTime();
const change = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

export interface MonthMinutes {
  minutes: number;
  /** over the same days of last month */
  previous: number;
  /** -0.2 for 20% less; null when there's nothing to compare with */
  change: number | null;
}

/** minutes heard this month so far */
export function monthMinutes(plays: Play[], now: Date): MonthMinutes {
  const [from, to] = lastMonthSoFar(now);
  let ms = 0;
  let before = 0;
  for (const p of plays) {
    if (between(p, startOfMonth(now), now)) ms += p.playedMs;
    else if (between(p, from, to)) before += p.playedMs;
  }
  const minutes = Math.round(ms / 60_000);
  const previous = Math.round(before / 60_000);
  return { minutes, previous, change: change(minutes, previous) };
}

export interface WeekDay {
  date: Date;
  dayMs: number;
  nightMs: number;
}

export interface Week {
  /** oldest first, today last */
  days: WeekDay[];
  totalMs: number;
  /** the day you listened most, if you listened at all */
  busiest: Date | null;
}

/** the last 7 days, split into daytime and night by when each play started */
export function lastSevenDays(plays: Play[], now: Date): Week {
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({ date: startOfDay(now, 6 - i), dayMs: 0, nightMs: 0 }));
  const first = days[0].date.getTime();
  for (const p of plays) {
    const when = new Date(p.playedAt);
    if (when.getTime() < first || when.getTime() > now.getTime()) continue;
    const day = days[dayIndex(when, days[0].date)];
    if (!day) continue;
    const hour = when.getHours();
    if (hour >= DAY_STARTS && hour < NIGHT_STARTS) day.dayMs += p.playedMs;
    else day.nightMs += p.playedMs;
  }
  const totalMs = days.reduce((sum, d) => sum + d.dayMs + d.nightMs, 0);
  const top = days.reduce((a, b) => (b.dayMs + b.nightMs > a.dayMs + a.nightMs ? b : a));
  return { days, totalMs, busiest: totalMs > 0 ? top.date : null };
}

/** heard to the end, near enough: 85% of the song, or all but its last 20 seconds */
export function heardToEnd(playedMs: number, durationMs: number): boolean {
  return durationMs > 0 && playedMs >= Math.min(durationMs * 0.85, durationMs - 20_000);
}

export interface FinishRate {
  plays: number;
  finished: number;
  /** 0 to 1 */
  rate: number;
}

/** how often you've heard a song to the end; null if you've never played it */
export function finishRate(playsMs: number[], durationMs: number): FinishRate | null {
  if (playsMs.length === 0 || durationMs <= 0) return null;
  const finished = playsMs.filter((ms) => heardToEnd(ms, durationMs)).length;
  return { plays: playsMs.length, finished, rate: finished / playsMs.length };
}

export interface OnRepeat {
  track: Track;
  /** this month */
  plays: number;
  /** over the same days of last month */
  previous: number;
  /** of this month's plays, how many went to the end */
  finished: number;
  /** plays on each of the last 30 days, oldest first */
  days: number[];
}

/** the song you've played most this month, if any song has had more than one play */
export function onRepeat(plays: Play[], tracks: Track[], now: Date): OnRepeat | null {
  const month = startOfMonth(now);
  const counts = new Map<string, { plays: number; ms: number; last: number }>();
  for (const p of plays) {
    if (!between(p, month, now)) continue;
    const c = counts.get(p.trackId) ?? { plays: 0, ms: 0, last: 0 };
    c.plays += 1;
    c.ms += p.playedMs;
    c.last = Math.max(c.last, at(p));
    counts.set(p.trackId, c);
  }
  let best: [string, { plays: number; ms: number; last: number }] | null = null;
  for (const entry of counts) {
    const [, c] = entry;
    if (!best || c.plays > best[1].plays || (c.plays === best[1].plays && (c.ms > best[1].ms || (c.ms === best[1].ms && c.last > best[1].last)))) best = entry;
  }
  const track = best && tracks.find((t) => t.id === best[0]);
  if (!best || !track || best[1].plays < 2) return null;

  const [from, to] = lastMonthSoFar(now);
  const mine = plays.filter((p) => p.trackId === track.id);
  const days = Array.from({ length: 30 }, () => 0);
  const firstDay = startOfDay(now, 29);
  for (const p of mine) {
    const index = dayIndex(new Date(p.playedAt), firstDay);
    if (index >= 0 && index < 30) days[index] += 1;
  }
  return {
    track,
    plays: best[1].plays,
    previous: mine.filter((p) => between(p, from, to)).length,
    finished: mine.filter((p) => between(p, month, now) && heardToEnd(p.playedMs, track.durationMs)).length,
    days,
  };
}

const fold = (name: string) => name.toLocaleLowerCase().trim();

export interface ArtistPlays {
  plays: number;
  /** their songs you played, most played first */
  songs: string[];
}

/** how often you played an artist since `since` */
export function artistPlays(plays: Play[], tracks: Track[], artist: ArtistRef, since: Date): ArtistPlays {
  const theirs = new Set(
    tracks.filter((t) => t.artists.some((a) => (artist.id && a.id === artist.id) || fold(a.name) === fold(artist.name))).map((t) => t.id),
  );
  const bySong = new Map<string, number>();
  let count = 0;
  for (const p of plays) {
    if (!theirs.has(p.trackId) || at(p) < since.getTime()) continue;
    count += 1;
    const title = tracks.find((t) => t.id === p.trackId)!.title;
    bySong.set(title, (bySong.get(title) ?? 0) + 1);
  }
  return { plays: count, songs: [...bySong].sort((a, b) => b[1] - a[1]).map(([title]) => title) };
}
