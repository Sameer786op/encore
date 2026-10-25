import type { AlbumSummary, ArtistRef, ArtistSummary, Track } from "@shared/types";
import { trackId } from "@shared/types";

// youtubei.js parses YouTube's responses into many node classes. We only read
// a handful of fields, so these helpers accept loose shapes and never throw.

type Loose = Record<string, any> | null | undefined;

interface Thumb {
  url: string;
  width?: number;
  height?: number;
}

export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const t = (value as { text?: unknown }).text;
    if (typeof t === "string") return t;
    const s = String(value);
    if (s !== "[object Object]") return s;
  }
  return "";
}

function thumbList(value: unknown): Thumb[] {
  if (Array.isArray(value)) return value.filter((t): t is Thumb => typeof t?.url === "string");
  if (value && typeof value === "object") {
    const contents = (value as { contents?: unknown }).contents;
    if (Array.isArray(contents)) return thumbList(contents);
  }
  return [];
}

/** the largest thumbnail, re-requested square at `size` px when the CDN allows resizing */
export function bestArtwork(value: unknown, size: number | null = 544): string | undefined {
  const thumbs = thumbList(value);
  if (thumbs.length === 0) return undefined;
  const largest = thumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
  const url = largest.url.startsWith("//") ? `https:${largest.url}` : largest.url;
  if (size !== null && /googleusercontent\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+/, `=s${size}`);
  }
  return url;
}

function artistRefs(item: Loose): ArtistRef[] {
  const list: Loose[] = item?.artists?.length ? item.artists : item?.authors?.length ? item.authors : item?.author ? [item.author] : [];
  return list
    .map((a) => ({ id: a?.channel_id || undefined, name: text(a?.name).trim() }))
    .filter((a) => a.name.length > 0);
}

function isExplicit(item: Loose): boolean {
  const badges = Array.isArray(item?.badges) ? item.badges : [];
  return badges.some((b: Loose) => b?.icon_type === "MUSIC_EXPLICIT_BADGE");
}

export interface TrackFallback {
  album?: { id?: string; title: string };
  artwork?: string;
  artists?: ArtistRef[];
}

export function mapTrack(item: Loose, fallback: TrackFallback = {}): Track | null {
  const videoId: unknown = item?.id ?? item?.video_id;
  if (typeof videoId !== "string" || videoId.length === 0) return null;
  const title = text(item?.title).trim();
  if (!title) return null;
  const artists = artistRefs(item);
  const album = item?.album?.name ? { id: item.album.id || undefined, title: text(item.album.name) } : fallback.album;
  const seconds = Number(item?.duration?.seconds ?? 0);
  return {
    id: trackId("youtube", videoId),
    source: "youtube",
    sourceId: videoId,
    title,
    artists: artists.length > 0 ? artists : (fallback.artists ?? []),
    album,
    durationMs: Number.isFinite(seconds) ? seconds * 1000 : 0,
    artwork: bestArtwork(item?.thumbnails ?? item?.thumbnail) ?? fallback.artwork,
    explicit: isExplicit(item) || undefined,
  };
}

export function mapAlbum(item: Loose): AlbumSummary | null {
  const id: unknown = item?.id;
  if (typeof id !== "string" || !id) return null;
  const title = text(item?.title).trim();
  if (!title) return null;
  const subtitle = text(item?.subtitle);
  const kind = subtitle.includes("•") ? subtitle.split("•")[0].trim() : undefined;
  return {
    id,
    title,
    artists: artistRefs(item),
    year: item?.year ? String(item.year) : undefined,
    kind: kind && !/^\d{4}$/.test(kind) ? kind : undefined,
    artwork: bestArtwork(item?.thumbnails ?? item?.thumbnail),
  };
}

export function mapArtist(item: Loose): ArtistSummary | null {
  const id: unknown = item?.id;
  if (typeof id !== "string" || !id) return null;
  const name = text(item?.name ?? item?.title).trim();
  if (!name) return null;
  return { id, name, subtitle: text(item?.subtitle) || undefined, artwork: bestArtwork(item?.thumbnails ?? item?.thumbnail) };
}

/** artist links inside a text run, e.g. an album header's "The Weeknd, Playboi Carti & Doechii" */
export function artistsFromRuns(value: Loose): ArtistRef[] {
  const runs: Loose[] = Array.isArray(value?.runs) ? value.runs : [];
  const linked = runs
    .map((r) => ({ id: r?.endpoint?.payload?.browseId as string | undefined, name: text(r?.text).trim() }))
    .filter((r) => r.id?.startsWith("UC") && r.name);
  if (linked.length > 0) return linked;
  const plain = text(value).trim();
  return plain ? plain.split(/,\s*|\s+&\s+/).map((name) => ({ name })) : [];
}

export function compact<T>(items: (T | null | undefined)[]): T[] {
  return items.filter((x): x is T => x != null);
}

export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
