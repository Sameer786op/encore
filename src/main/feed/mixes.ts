import type { ArtistSummary, Track } from "@shared/types";
import { songKey } from "../matching/text";
import { shuffle } from "./taste";

// Daily mixes: groups of artists you play who sound alike, each turned into
// a playlist of your favourites, their best-known songs, and a few
// discoveries in the same vein.

export interface MixArtist extends ArtistSummary {
  score: number;
}

/** artists → the artists their page calls similar */
export type Related = Map<string, Set<string>>;

const related = (rel: Related, a: string, b: string) => !!rel.get(a)?.has(b) || !!rel.get(b)?.has(a);

/**
 * Greedy grouping: the strongest artist not yet used starts a mix and pulls
 * in up to three more of your artists that YouTube Music links to it.
 */
export function groupArtists(artists: MixArtist[], rel: Related, mixes = 5, perMix = 4): MixArtist[][] {
  const pool = [...artists].sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const groups: MixArtist[][] = [];
  for (const seed of pool) {
    if (groups.length >= mixes) break;
    if (used.has(seed.id)) continue;
    used.add(seed.id);
    const group = [seed];
    for (const other of pool) {
      if (group.length >= perMix) break;
      if (used.has(other.id)) continue;
      // close to the seed, or to someone already in the group
      if (group.some((g) => related(rel, g.id, other.id))) {
        group.push(other);
        used.add(other.id);
      }
    }
    groups.push(group);
  }
  return groups;
}

export interface MixSources {
  /** your own favourite songs by these artists, best first */
  favourites: Track[];
  /** the artists' popular songs */
  popular: Track[];
  /** similar songs from a radio seeded by a favourite */
  discoveries: Track[];
}

/** weave the three sources together: no repeats, and never the same artist twice in a row */
export function assembleMix(sources: MixSources, random: () => number, length = 40): Track[] {
  const buckets = [shuffle(sources.favourites.slice(0, 30), random), shuffle(sources.popular, random), shuffle(sources.discoveries, random)];
  // roughly 40% favourites, 30% popular, 30% discoveries
  const pattern = [0, 1, 2, 0, 1, 0, 2, 1, 0, 2];
  const seen = new Set<string>();
  const out: Track[] = [];
  const key = (t: Track) => songKey(t.artists[0]?.name ?? "", t.title);
  let turn = 0;
  let stalled = 0;
  while (out.length < length && buckets.some((b) => b.length > 0) && stalled < 40) {
    const bucket = buckets[pattern[turn++ % pattern.length]];
    const previousArtist = out[out.length - 1]?.artists[0]?.name;
    const index = bucket.findIndex((t) => !seen.has(key(t)) && t.artists[0]?.name !== previousArtist);
    if (index < 0) {
      // drop songs we've already used, and allow the same artist if nothing else is left
      for (let i = bucket.length - 1; i >= 0; i--) if (seen.has(key(bucket[i]))) bucket.splice(i, 1);
      if (bucket.length > 0 && buckets.every((b) => b.every((t) => t.artists[0]?.name === previousArtist || seen.has(key(t))))) {
        const [t] = bucket.splice(0, 1);
        seen.add(key(t));
        out.push(t);
        stalled = 0;
      } else stalled++;
      continue;
    }
    const [track] = bucket.splice(index, 1);
    seen.add(key(track));
    out.push(track);
    stalled = 0;
  }
  return out;
}

export function describeMix(artists: ArtistSummary[]): string {
  const names = artists.map((a) => a.name);
  if (names.length === 1) return `${names[0]} and similar artists`;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and more`;
}
