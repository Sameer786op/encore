import type { Track } from "@shared/types";
import type { QueueItem } from "@/player/queue";

// What Jam players say to each other, and the checks on what comes in.
// Anything from another computer is taken apart and rebuilt from the fields
// Vyse Music knows, so a bad message can't reach the player or the screen.

/** 2: the host lets guests in with its rules, and can turn them away */
export const JAM_VERSION = 2;
/** people in one Jam, the host included */
export const MAX_PEOPLE = 32;
/** songs one message can add */
export const MAX_ADD = 50;
/** songs the host shares from before and after the current one */
export const SHARE_BEHIND = 10;
export const SHARE_AHEAD = 150;
const MAX_NAME = 32;

/** first thing each player says to every other */
export interface Hello {
  v: number;
  name: string;
  host: boolean;
}

export interface Person {
  id: string;
  name: string;
  host: boolean;
}

/** the host's queue: a window round the current song */
export interface SharedQueue {
  items: QueueItem[];
  /** the current song's uid, or null when nothing is loaded */
  current: string | null;
}

/** where the host's song is, by the host's clock */
export interface Clock {
  /** the queue item it's about */
  uid: string | null;
  position: number;
  playing: boolean;
  rate: number;
  keepPitch: boolean;
  at: number;
}

/** a guest's songs for the host's queue */
export interface Add {
  tracks: Track[];
  next: boolean;
}

/** what the host lets guests do; the first thing a guest it lets in hears */
export interface Rules {
  /** guests can play, pause, skip, seek and arrange the queue, not just add songs */
  control: boolean;
}

/** why the host turned a guest away */
export type Goodbye = "removed" | "locked" | "full";
const GOODBYES: Goodbye[] = ["removed", "locked", "full"];

/** a guest changing what plays, when the host lets them */
export type Command =
  | { do: "play" | "pause" | "next" | "previous" }
  | { do: "seek"; uid: string; to: number }
  | { do: "jump" | "remove"; uid: string }
  | { do: "move"; uids: string[] };

export interface Ping {
  t: number;
}

export interface Pong {
  t: number;
  host: number;
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): number | null => (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null);

/** text without control characters, squeezed and cut to `max`, or null when there's none left */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return clean ? [...clean].slice(0, max).join("") : null;
}

const ID = /^[\w.:-]{1,128}$/;
const id = (value: unknown): string | null => (typeof value === "string" && ID.test(value) ? value : null);

/** a name people go by in a Jam */
export function cleanName(value: unknown): string {
  return text(value, MAX_NAME) ?? "Someone";
}

// cover art only from YouTube's own image servers, so no one can make the others' computers fetch from theirs
const ARTWORK_HOSTS = /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/;
function artwork(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ARTWORK_HOSTS.test(url.hostname) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const VIDEO_ID = /^[\w-]{11}$/;
const LOCAL_ID = /^[0-9a-f]{8,16}$/;

/** a song from another player, rebuilt; null if it isn't one */
export function cleanTrack(value: unknown): Track | null {
  if (!isObject(value)) return null;
  const { sourceId } = value;
  const source = value.source === "youtube" || value.source === "local" ? value.source : null;
  const title = text(value.title, 300);
  const durationMs = finite(value.durationMs, 0, 24 * 3600 * 1000);
  if (!source || !title || durationMs === null || typeof sourceId !== "string") return null;
  if (!(source === "youtube" ? VIDEO_ID : LOCAL_ID).test(sourceId)) return null;
  const artists = (Array.isArray(value.artists) ? value.artists : [])
    .slice(0, 12)
    .map((a) => (isObject(a) ? { name: text(a.name, 200), id: id(a.id) ?? undefined } : null))
    .filter((a): a is { name: string; id: string | undefined } => !!a?.name)
    .map((a) => (a.id ? { name: a.name, id: a.id } : { name: a.name }));
  const albumTitle = isObject(value.album) ? text(value.album.title, 300) : null;
  const albumId = isObject(value.album) ? id(value.album.id) : null;
  const track: Track = { id: `${source}:${sourceId}`, source, sourceId, title, artists, durationMs };
  if (albumTitle) track.album = albumId ? { title: albumTitle, id: albumId } : { title: albumTitle };
  const cover = source === "youtube" ? artwork(value.artwork) : undefined;
  if (cover) track.artwork = cover;
  if (value.explicit === true) track.explicit = true;
  return track;
}

/** a song as the host shares it: a song file keeps its name, but not where it is on the host's computer */
export function shareTrack(track: Track): Track {
  const shared: Track = { id: track.id, source: track.source, sourceId: track.sourceId, title: track.title, artists: track.artists, durationMs: track.durationMs };
  if (track.album) shared.album = track.album;
  if (track.explicit) shared.explicit = true;
  if (track.source === "local") {
    const hidden = hash(track.id);
    const local: Track = { ...shared, id: `local:${hidden}`, sourceId: hidden, artists: track.artists.map((a) => ({ name: a.name })) };
    if (track.album) local.album = { title: track.album.title };
    return local;
  }
  if (track.artwork) shared.artwork = track.artwork;
  return shared;
}

/** FNV-1a, as 8 hex digits: the same file always gets the same stand-in */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function cleanHello(value: unknown): Hello | null {
  if (!isObject(value) || finite(value.v, 1, 1000) === null) return null;
  return { v: value.v as number, name: cleanName(value.name), host: value.host === true };
}

export function cleanPeople(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PEOPLE)
    .map((p) => (isObject(p) && id(p.id) ? { id: p.id as string, name: cleanName(p.name), host: p.host === true } : null))
    .filter((p): p is Person => !!p);
}

/** the host's queue window, as shared */
export function shareQueue(items: QueueItem[], index: number): SharedQueue {
  const start = Math.max(0, index - SHARE_BEHIND);
  const window = items.slice(start, Math.max(index, 0) + SHARE_AHEAD + 1);
  return {
    items: window.map((item) => (item.by ? { uid: item.uid, track: shareTrack(item.track), by: item.by } : { uid: item.uid, track: shareTrack(item.track) })),
    current: items[index]?.uid ?? null,
  };
}

export function cleanQueue(value: unknown): SharedQueue | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const seen = new Set<string>();
  const items: QueueItem[] = [];
  for (const raw of value.items.slice(0, SHARE_BEHIND + SHARE_AHEAD + 1)) {
    if (!isObject(raw)) continue;
    const uid = id(raw.uid);
    const track = cleanTrack(raw.track);
    if (!uid || !track || seen.has(uid)) continue;
    seen.add(uid);
    const by = text(raw.by, MAX_NAME);
    items.push(by ? { uid, track, by } : { uid, track });
  }
  const current = id(value.current);
  return { items, current: current && seen.has(current) ? current : null };
}

export function cleanClock(value: unknown): Clock | null {
  if (!isObject(value)) return null;
  const position = finite(value.position, 0, 24 * 3600);
  const rate = finite(value.rate, 0.25, 4);
  const at = finite(value.at, 0, Number.MAX_SAFE_INTEGER);
  if (position === null || rate === null || at === null) return null;
  return { uid: id(value.uid), position, playing: value.playing === true, rate, keepPitch: value.keepPitch !== false, at };
}

/** songs a guest asked for: YouTube Music songs only, since a song file only plays on its own computer */
export function cleanAdd(value: unknown): Add | null {
  if (!isObject(value) || !Array.isArray(value.tracks)) return null;
  const tracks = value.tracks
    .slice(0, MAX_ADD)
    .map(cleanTrack)
    .filter((t): t is Track => !!t && t.source === "youtube");
  return tracks.length ? { tracks, next: value.next === true } : null;
}

export function cleanRules(value: unknown): Rules | null {
  return isObject(value) ? { control: value.control === true } : null;
}

export function cleanGoodbye(value: unknown): Goodbye | null {
  return isObject(value) && GOODBYES.includes(value.reason as Goodbye) ? (value.reason as Goodbye) : null;
}

export function cleanCommand(value: unknown): Command | null {
  if (!isObject(value)) return null;
  const what = value.do;
  if (what === "play" || what === "pause" || what === "next" || what === "previous") return { do: what };
  const uid = id(value.uid);
  if (what === "seek") {
    const to = finite(value.to, 0, 24 * 3600);
    return uid && to !== null ? { do: what, uid, to } : null;
  }
  if (what === "jump" || what === "remove") return uid ? { do: what, uid } : null;
  if (what === "move" && Array.isArray(value.uids)) {
    const uids = [...new Set(value.uids.slice(0, SHARE_AHEAD).map(id).filter((u): u is string => !!u))];
    return uids.length > 1 ? { do: what, uids } : null;
  }
  return null;
}

export function cleanPing(value: unknown): Ping | null {
  const t = isObject(value) ? finite(value.t, 0, Number.MAX_SAFE_INTEGER) : null;
  return t === null ? null : { t };
}

export function cleanPong(value: unknown): Pong | null {
  if (!isObject(value)) return null;
  const t = finite(value.t, 0, Number.MAX_SAFE_INTEGER);
  const host = finite(value.host, 0, Number.MAX_SAFE_INTEGER);
  return t === null || host === null ? null : { t, host };
}
