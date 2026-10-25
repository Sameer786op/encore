import type { Track } from "@shared/types";
import { cleanArtistName, fold, songKey, splitArtists } from "../matching/text";

// What you've been listening to, with recent plays counting most. A play
// from two months ago counts half as much as one today.

export const HALF_LIFE_DAYS = 60;
const DAY_MS = 86_400_000;
/** a liked song counts like this many plays today */
const LIKE_WEIGHT = 3;

export interface Play {
  title: string;
  artist: string;
  /** when known, the YouTube Music artist */
  artistId?: string;
  playedAt: string;
  count: number;
  track?: Track;
  videoId?: string;
}

export interface SongTaste {
  key: string;
  title: string;
  artist: string;
  score: number;
  totalPlays: number;
  /** plays in the last 30 days */
  recentPlays: number;
  lastPlayedAt: string;
  track?: Track;
  videoId?: string;
}

export interface ArtistTaste {
  key: string;
  name: string;
  artistId?: string;
  score: number;
  totalPlays: number;
  recentPlays: number;
  lastPlayedAt: string;
}

export interface Taste {
  songs: SongTaste[];
  artists: ArtistTaste[];
}

export const recencyWeight = (playedAt: string, now: number) => Math.pow(0.5, Math.max(0, now - Date.parse(playedAt)) / (HALF_LIFE_DAYS * DAY_MS));

export function primaryArtist(name: string): string {
  return splitArtists(cleanArtistName(name))[0] ?? name;
}

export function buildTaste(plays: Play[], liked: Track[], now = Date.now()): Taste {
  const songs = new Map<string, SongTaste>();
  const artists = new Map<string, ArtistTaste>();
  const monthAgo = now - 30 * DAY_MS;

  const add = (p: Play, weight: number, countsAsPlay: boolean) => {
    const artistName = primaryArtist(p.artist);
    const sKey = songKey(p.artist, p.title);
    const recent = countsAsPlay && Date.parse(p.playedAt) >= monthAgo ? p.count : 0;
    const song = songs.get(sKey) ?? { key: sKey, title: p.title, artist: p.artist, score: 0, totalPlays: 0, recentPlays: 0, lastPlayedAt: "" };
    song.score += weight;
    if (countsAsPlay) {
      song.totalPlays += p.count;
      song.recentPlays += recent;
      if (p.playedAt > song.lastPlayedAt) song.lastPlayedAt = p.playedAt;
    }
    song.track ??= p.track;
    song.videoId ??= p.videoId ?? (p.track?.source === "youtube" ? p.track.sourceId : undefined);
    songs.set(sKey, song);

    const aKey = fold(artistName);
    if (!aKey || aKey === "unknown artist") return;
    const artist = artists.get(aKey) ?? { key: aKey, name: artistName, score: 0, totalPlays: 0, recentPlays: 0, lastPlayedAt: "" };
    artist.score += weight;
    artist.artistId ??= p.artistId;
    if (countsAsPlay) {
      artist.totalPlays += p.count;
      artist.recentPlays += recent;
      if (p.playedAt > artist.lastPlayedAt) artist.lastPlayedAt = p.playedAt;
    }
    artists.set(aKey, artist);
  };

  for (const p of plays) add(p, p.count * recencyWeight(p.playedAt, now), true);
  for (const track of liked) {
    const artist = track.artists[0];
    add({ title: track.title, artist: artist?.name ?? "", artistId: artist?.id, playedAt: new Date(now).toISOString(), count: 1, track }, LIKE_WEIGHT, false);
  }

  return {
    songs: [...songs.values()].sort((a, b) => b.score - a.score),
    artists: [...artists.values()].sort((a, b) => b.score - a.score),
  };
}

/** songs played a lot lately */
export function onRepeat(taste: Taste, limit = 16): SongTaste[] {
  return taste.songs.filter((s) => s.recentPlays >= 2).sort((a, b) => b.recentPlays - a.recentPlays || b.score - a.score).slice(0, limit);
}

/** old favourites: played a lot in total, not at all for a few months */
export function forgottenFavourites(taste: Taste, now = Date.now(), limit = 16): SongTaste[] {
  const cutoff = now - 90 * DAY_MS;
  return taste.songs
    .filter((s) => s.totalPlays >= 4 && s.lastPlayedAt && Date.parse(s.lastPlayedAt) < cutoff)
    .sort((a, b) => b.totalPlays - a.totalPlays)
    .slice(0, limit);
}

/** a small, repeatable random generator, so a day's mixes stay the same all day */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
