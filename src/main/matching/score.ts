import { CONFIDENT, PLAUSIBLE } from "@shared/matching";
import type { ImportItemStatus, MatchCandidate, SourceTrack, Track } from "@shared/types";
import { cleanArtistName, coreTitle, fold, similarity, splitArtists, stripFeatures, versionTags } from "./text";

export interface ScoreParts {
  title: number;
  artist: number;
  duration: number;
  versionPenalty: number;
  total: number;
}

export { CONFIDENT, PLAUSIBLE } from "@shared/matching";

function artistNames(names: string[]): string[] {
  return names.flatMap((n) => splitArtists(cleanArtistName(n))).map(fold).filter(Boolean);
}

/** 1 when the main artist matches, partial credit for close spellings */
export function artistScore(source: string[], candidate: string[]): number {
  const a = artistNames(source);
  const b = artistNames(candidate);
  if (a.length === 0) return 0.6; // nothing to compare: neutral
  if (b.length === 0) return 0.3;
  const best = (name: string) => Math.max(...b.map((other) => similarity(name, other)));
  // the first credited artist matters most, the rest are a bonus
  const primary = best(a[0]);
  const others = a.length > 1 ? a.slice(1).map(best).reduce((s, v) => s + v, 0) / (a.length - 1) : primary;
  // "Artist - Topic" channels sometimes list only the main artist; never punish missing extras much
  return Math.min(1, primary * 0.85 + others * 0.15);
}

export function titleScore(source: string, candidate: string): number {
  const exact = similarity(fold(stripFeatures(source)), fold(stripFeatures(candidate)));
  const core = similarity(coreTitle(source), coreTitle(candidate));
  return Math.max(exact, core * 0.97);
}

export function durationScore(sourceMs: number | undefined, candidateMs: number): number {
  if (!sourceMs || !candidateMs) return 0.7; // unknown: neutral-ish
  const diff = Math.abs(sourceMs - candidateMs) / 1000;
  if (diff <= 3) return 1;
  if (diff <= 8) return 0.85;
  if (diff <= 15) return 0.55;
  if (diff <= 30) return 0.25;
  return 0;
}

/** different versions (live vs studio, remix, sped up...) are different songs */
export function versionPenalty(source: string, candidate: string): number {
  const a = versionTags(source);
  const b = versionTags(candidate);
  let penalty = 0;
  for (const tag of b) if (!a.has(tag)) penalty += 0.25;
  for (const tag of a) if (!b.has(tag)) penalty += 0.2;
  return Math.min(0.6, penalty);
}

export function scoreCandidate(source: SourceTrack, candidate: Track): ScoreParts {
  const title = titleScore(source.title, candidate.title);
  const artist = artistScore(
    source.artists,
    candidate.artists.map((a) => a.name),
  );
  const duration = durationScore(source.durationMs, candidate.durationMs);
  const penalty = versionPenalty(source.title, candidate.title);
  let total = Math.max(0, Math.min(1, title * 0.5 + artist * 0.32 + duration * 0.18 - penalty));
  // minutes apart is a different recording, however alike the names are
  if (duration === 0) total = Math.min(total, CONFIDENT - 0.05);
  return { title, artist, duration, versionPenalty: penalty, total };
}

export function rankCandidates(source: SourceTrack, tracks: Track[], limit = 5): MatchCandidate[] {
  const seen = new Set<string>();
  return tracks
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .map((track) => ({ track, parts: scoreCandidate(source, track) }))
    .sort((a, b) => b.parts.total - a.parts.total)
    .slice(0, limit)
    .map(({ track, parts }) => ({ track, score: Math.round(parts.total * 1000) / 1000 }));
}

export function classify(source: SourceTrack, best: MatchCandidate | undefined): ImportItemStatus {
  if (!best) return "missing";
  const parts = scoreCandidate(source, best.track);
  if (parts.total >= CONFIDENT && parts.title >= 0.8 && parts.artist >= 0.7) return "matched";
  if (parts.total >= PLAUSIBLE) return "review";
  return "missing";
}

/** what to type into YouTube Music's search for a song */
export function searchQueries(source: SourceTrack): string[] {
  const title = stripFeatures(source.title).trim();
  const artist = cleanArtistName(source.artists[0] ?? "");
  const queries = [artist ? `${title} ${artist}` : title];
  // a second, looser try without the artist for songs with unusual credits
  if (artist) queries.push(title);
  return queries;
}
