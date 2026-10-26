import type { Track } from "@shared/types";
import type { Mood } from "@shared/moods";
import { songKey } from "../matching/text";
import { shuffle } from "./taste";

// Mood mixes: your own songs that suit a mood, woven together with YouTube
// Music radios tuned to that mood and started from a few of them.

/** longer than this is a full album or an hour-long mix, not a song */
const MAX_TRACK_MS = 12 * 60_000;

export interface TaggedSong {
  track: Track;
  /** the tuning chips YouTube Music offers for the song: "Chill", "Romance", "2010s"… */
  tags: string[];
}

export const suits = (song: TaggedSong, mood: Mood) => song.tags.some((t) => mood.tags.includes(t));

/** your songs to start the radios from: ones that suit the mood first, then your top songs, since any song can be tuned */
export function pickSeeds(songs: TaggedSong[], mood: Mood, random: () => number, count = 3): Track[] {
  const fitting = songs.filter((s) => suits(s, mood));
  const others = songs.filter((s) => !suits(s, mood));
  const seeds = [...shuffle(fitting.slice(0, 8), random), ...shuffle(others.slice(0, 8), random)];
  return seeds.slice(0, count).map((s) => s.track);
}

export interface MoodSources {
  /** your own songs that suit the mood */
  yours: Track[];
  /** tuned radios, closest songs first */
  radios: Track[][];
}

/** one of yours to open and about every 4th song after, the radios taking turns between: no repeats, never the same artist twice in a row */
export function assembleMoodMix(sources: MoodSources, random: () => number, length = 40): Track[] {
  const fits = (t: Track) => !t.durationMs || t.durationMs <= MAX_TRACK_MS;
  const yours = shuffle(sources.yours.filter(fits), random);
  const radios = sources.radios.map((r) => r.filter(fits));
  const seen = new Set<string>();
  const key = (t: Track) => songKey(t.artists[0]?.name ?? "", t.title);
  const out: Track[] = [];
  const add = (t: Track) => {
    seen.add(t.id);
    seen.add(key(t));
    out.push(t);
  };
  const take = (list: Track[]): boolean => {
    for (let i = list.length - 1; i >= 0; i--) if (seen.has(list[i].id) || seen.has(key(list[i]))) list.splice(i, 1);
    const previous = out[out.length - 1]?.artists[0]?.name;
    const index = list.findIndex((t) => t.artists[0]?.name !== previous);
    if (index < 0) return false;
    add(list.splice(index, 1)[0]);
    return true;
  };

  let turn = 0;
  while (out.length < length) {
    let placed = out.length % 4 === 0 && take(yours);
    for (let tries = 0; !placed && tries < radios.length; tries++) placed = take(radios[turn++ % radios.length]);
    if (!placed) placed = take(yours);
    if (placed) continue;
    // only the same artist is left: better that than a short mix
    const rest = [...radios, yours].find((list) => list.length > 0);
    if (!rest) break;
    add(rest.splice(0, 1)[0]);
  }
  return out;
}

/** "Chill songs like Kesariya and Tum Hi Ho", or "Focus music inspired by…" when none of those songs suit the mood themselves */
export function describeMood(mood: Mood, seeds: Track[], suitsMood: (t: Track) => boolean = () => true): string {
  const suiting = seeds.filter(suitsMood).slice(0, 2);
  const named = suiting.length > 0 ? suiting : seeds.slice(0, 2);
  if (named.length === 0) return `${mood.name} picks from YouTube Music`;
  const titles = named.map((t) => t.title).join(" and ");
  return suiting.length > 0 ? `${mood.name} songs like ${titles}` : `${mood.name} music inspired by ${titles}`;
}
