import { randomUUID } from "node:crypto";
import type { AlbumDetails, ArtistDetails, ArtistSummary, HomeSection, RemotePlaylistDetails, SearchResults, Track } from "@shared/types";
import { trackId } from "@shared/types";
import { cleanArtistName } from "../matching/text";
import { getYouTube } from "./client";
import { artistsFromRuns, bestArtwork, compact, mapAlbum, mapArtist, mapPlaylist, mapTrack, text, uniqueById } from "./mappers";

type Loose = Record<string, any>;

// "Show more" pages of song results, by token; only the latest searches keep theirs
const moreSongs = new Map<string, Loose>();

function keepMore(page: Loose | null): string | undefined {
  if (!page?.has_continuation) return undefined;
  const token = randomUUID();
  moreSongs.set(token, page);
  if (moreSongs.size > 30) moreSongs.delete(moreSongs.keys().next().value!);
  return token;
}

export async function searchMore(token: string): Promise<{ tracks: Track[]; more?: string }> {
  const page = moreSongs.get(token);
  if (!page) throw new Error("Those results are too old; search again");
  moreSongs.delete(token);
  const next = (await page.getContinuation()) as Loose;
  const items = (next.contents?.contents ?? []) as Loose[];
  return { tracks: uniqueById(compact(items.map((i) => mapTrack(i)))), more: keepMore(next) };
}

export async function search(query: string): Promise<SearchResults> {
  const yt = await getYouTube();
  const [general, songSearch] = await Promise.all([
    yt.music.search(query),
    // the song filter gives richer rows (album, duration) than the mixed results
    yt.music.search(query, { type: "song" }).catch(() => null),
  ]);

  const shelves = (general.contents ?? []) as Loose[];
  const items = shelves.flatMap((shelf) => (shelf.type === "MusicCardShelf" ? [] : ((shelf.contents ?? []) as Loose[])));
  const byType = (type: string) => items.filter((i) => i.item_type === type);

  const tracks = uniqueById(compact(((songSearch?.songs?.contents ?? []) as Loose[]).map((i) => mapTrack(i))));
  const extraSongs = compact(byType("song").map((i) => mapTrack(i))).filter((t) => !tracks.some((x) => x.id === t.id));

  const results: SearchResults = {
    query,
    tracks: [...tracks, ...extraSongs],
    albums: uniqueById(compact(byType("album").map(mapAlbum))),
    // "Profile" rows are regular channels, not artists
    artists: uniqueById(compact(byType("artist").filter((i) => !text(i.subtitle).startsWith("Profile")).map(mapArtist))),
    videos: uniqueById(compact(byType("video").map((i) => mapTrack(i)))),
    moreSongs: keepMore(songSearch),
  };

  const card = shelves.find((s) => s.type === "MusicCardShelf");
  if (card) {
    const payload = card.title?.endpoint?.payload ?? card.on_tap?.payload ?? {};
    const pageType: string | undefined = payload.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (payload.videoId) {
      const track = results.tracks.find((t) => t.sourceId === payload.videoId);
      if (track) results.top = { kind: "track", track };
    } else if (payload.browseId && pageType === "MUSIC_PAGE_TYPE_ARTIST") {
      results.top = {
        kind: "artist",
        artist: { id: payload.browseId, name: text(card.title), subtitle: text(card.subtitle) || undefined, artwork: bestArtwork(card.thumbnail) },
      };
    } else if (payload.browseId && pageType === "MUSIC_PAGE_TYPE_ALBUM") {
      const album = results.albums.find((a) => a.id === payload.browseId);
      results.top = {
        kind: "album",
        album: album ?? { id: payload.browseId, title: text(card.title), artists: [], artwork: bestArtwork(card.thumbnail) },
      };
    }
  }
  return results;
}

export async function suggestions(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  const yt = await getYouTube();
  const sections = (await yt.music.getSearchSuggestions(query)) as unknown as Loose[];
  const words = sections.flatMap((s) => ((s.contents ?? []) as Loose[]).map((c) => text(c.suggestion)).filter(Boolean));
  return [...new Set(words)].slice(0, 8);
}

export async function album(id: string): Promise<AlbumDetails> {
  const yt = await getYouTube();
  const page = (await yt.music.getAlbum(id)) as unknown as Loose;
  const header = page.header ?? {};
  const artwork = bestArtwork(header.thumbnail);
  const artists = artistsFromRuns(header.strapline_text_one ?? header.author);
  const title = text(header.title);
  const subtitle = text(header.subtitle);
  const [kind, year] = subtitle.split("•").map((s) => s.trim());
  return {
    id,
    title,
    artists,
    kind: kind || undefined,
    year: year || undefined,
    artwork,
    description: text(header.description) || undefined,
    tracks: compact(((page.contents ?? []) as Loose[]).map((i) => mapTrack(i, { album: { id, title }, artwork, artists }))),
  };
}

export async function artist(id: string): Promise<ArtistDetails> {
  const yt = await getYouTube();
  const page = (await yt.music.getArtist(id)) as unknown as Loose;
  const header = page.header ?? {};
  const sections = (page.sections ?? []) as Loose[];
  const carousel = (pattern: RegExp) =>
    sections.find((s) => s.type === "MusicCarouselShelf" && pattern.test(text(s.header?.title)));
  const topShelf = sections.find((s) => s.type === "MusicShelf");
  const name = text(header.title);
  return {
    id,
    name,
    description: text(header.description) || undefined,
    // the header image is a wide banner, keep it as it is
    artwork: bestArtwork(header.thumbnail, null),
    topTracks: compact(((topShelf?.contents ?? []) as Loose[]).map((i) => mapTrack(i, { artists: [{ id, name }] }))),
    albums: compact(((carousel(/album/i)?.contents ?? []) as Loose[]).map(mapAlbum)).map((a) => ({ ...a, artists: a.artists.length ? a.artists : [{ id, name }] })),
    singles: compact(((carousel(/single/i)?.contents ?? []) as Loose[]).map(mapAlbum)).map((a) => ({ ...a, artists: a.artists.length ? a.artists : [{ id, name }] })),
    related: compact(((carousel(/fans might also like|similar|related/i)?.contents ?? []) as Loose[]).map(mapArtist)),
  };
}

/** YouTube Music artists by name, best match first */
export async function searchArtists(query: string): Promise<ArtistSummary[]> {
  const yt = await getYouTube();
  const results = (await yt.music.search(query, { type: "artist" })) as unknown as Loose;
  const shelves = (results.contents ?? []) as Loose[];
  const items = shelves.flatMap((s) => (s.contents ?? []) as Loose[]).filter((i) => i.item_type === "artist");
  return uniqueById(compact(items.map(mapArtist)));
}

/** what's new and popular comes first */
export function homeRank(title: string): number {
  if (/quick picks/i.test(title)) return 0;
  if (/^new (releases|albums)/i.test(title)) return 1;
  if (/trending/i.test(title)) return 2;
  if (/hits|top |chart|biggest/i.test(title)) return 3;
  if (/new music videos/i.test(title)) return 4;
  return 5;
}

function homeSection(shelf: Loose): HomeSection | null {
  if (shelf?.type !== "MusicCarouselShelf") return null;
  const title = text(shelf.header?.title).trim();
  // community playlists are anyone's uploads; moods and podcasts aren't songs
  if (!title || /community/i.test(title)) return null;
  const items = (shelf.contents ?? []) as Loose[];
  const section: HomeSection = {
    title,
    tracks: uniqueById(compact(items.filter((i) => i.item_type === "song" || i.item_type === "video").map((i) => mapTrack(i)))),
    albums: uniqueById(compact(items.filter((i) => i.item_type === "album").map(mapAlbum))),
    playlists: uniqueById(compact(items.filter((i) => i.item_type === "playlist").map(mapPlaylist))),
  };
  return section.tracks.length + section.albums.length + section.playlists.length > 0 ? section : null;
}

/** shelves from YouTube Music's home (both pages) and Explore, newest and most popular first */
export function homeSections(shelves: Loose[]): HomeSection[] {
  const sections: HomeSection[] = [];
  for (const shelf of shelves) {
    const section = homeSection(shelf);
    if (!section) continue;
    // "New releases" and "New albums & singles" are one list
    const same = sections.find((s) => s.title === section.title || (homeRank(s.title) === 1 && homeRank(section.title) === 1));
    if (!same) sections.push(section);
    else {
      same.tracks = uniqueById([...same.tracks, ...section.tracks]);
      same.albums = uniqueById([...same.albums, ...section.albums]);
      same.playlists = uniqueById([...same.playlists, ...section.playlists]);
    }
  }
  return sections.map((section, i) => ({ section, i })).sort((a, b) => homeRank(a.section.title) - homeRank(b.section.title) || a.i - b.i).map((x) => x.section);
}

export async function home(): Promise<HomeSection[]> {
  const yt = await getYouTube();
  const [feed, explore] = (await Promise.all([yt.music.getHomeFeed().catch(() => null), yt.music.getExplore().catch(() => null)])) as (Loose | null)[];
  if (!feed && !explore) throw new Error("YouTube Music didn't answer");
  const more = feed?.has_continuation ? ((await feed.getContinuation().catch(() => null)) as Loose | null) : null;
  return homeSections([...(feed?.sections ?? []), ...(more?.sections ?? []), ...(explore?.sections ?? [])]);
}

/** songs only (no videos), for matching songs from other services */
export async function searchSongs(query: string): Promise<Track[]> {
  const yt = await getYouTube();
  const results = await yt.music.search(query, { type: "song" });
  return uniqueById(compact(((results.songs?.contents ?? []) as Loose[]).map((i) => mapTrack(i))));
}

/** a saved YouTube or YouTube Music playlist, following "load more" pages */
async function playlistPages(id: string, maxTracks: number): Promise<{ header: Loose; items: Loose[] }> {
  const yt = await getYouTube();
  let page = (await yt.music.getPlaylist(id)) as unknown as Loose;
  const header = (page.header ?? {}) as Loose;
  const items: Loose[] = [...((page.items ?? page.contents ?? []) as Loose[])];
  while (page.has_continuation && items.length < maxTracks) {
    page = (await page.getContinuation()) as Loose;
    const more = (page.items ?? page.contents ?? []) as Loose[];
    if (more.length === 0) break;
    items.push(...more);
  }
  return { header, items: items.slice(0, maxTracks) };
}

export async function playlist(id: string, maxTracks = 5000): Promise<{ name: string; tracks: Track[] }> {
  const { header, items } = await playlistPages(id, maxTracks);
  return { name: text(header.title) || "YouTube playlist", tracks: compact(items.map((i) => mapTrack(i))) };
}

/** who made a playlist, from a header like "Playlist • YouTube Music • 2026"; the page counts the songs itself */
export function playlistByline(subtitle: string): string | undefined {
  const parts = subtitle
    .split("•")
    .map((part) => part.trim())
    .filter((part) => part && !/^(playlist|album|single|ep)$/i.test(part) && !/^\d{4}$/.test(part) && !/\d[\d.,]*\s*[KMB]?\s+(songs?|tracks?|views?)\b/i.test(part) && !/\b(hours?|minutes?|hr|min)\b/i.test(part));
  return parts.join(" • ") || undefined;
}

/** a YouTube Music playlist to open as a page, such as a chart */
export async function remotePlaylist(id: string): Promise<RemotePlaylistDetails> {
  const { header, items } = await playlistPages(id, 300);
  return {
    id,
    title: text(header.title) || "Playlist",
    subtitle: playlistByline(`${text(header.subtitle)} • ${text(header.second_subtitle)}`),
    description: text(header.description?.description ?? header.description) || undefined,
    artwork: bestArtwork(header.thumbnail ?? header.thumbnails),
    tracks: uniqueById(compact(items.map((i) => mapTrack(i)))),
  };
}

/** one song's details from its video id */
export async function trackById(videoId: string): Promise<Track> {
  const yt = await getYouTube();
  const info = (await yt.music.getInfo(videoId)) as unknown as Loose;
  const basic = info.basic_info ?? {};
  if (!basic.title) throw new Error(`No details for ${videoId}`);
  return {
    id: trackId("youtube", videoId),
    source: "youtube",
    sourceId: videoId,
    title: String(basic.title),
    artists: [{ id: basic.channel_id || undefined, name: cleanArtistName(String(basic.author ?? "")) || "Unknown artist" }],
    durationMs: Number(basic.duration ?? 0) * 1000,
    artwork: bestArtwork(basic.thumbnail),
  };
}

/** YouTube Music's own lyrics for a song, as plain text */
export async function lyricsText(videoId: string): Promise<string | null> {
  const yt = await getYouTube();
  const shelf = (await yt.music.getLyrics(videoId)) as unknown as Loose | undefined;
  return text(shelf?.description) || null;
}

/** an endless "radio" of similar songs, seeded by a track */
export async function radio(seed: Track): Promise<Track[]> {
  const yt = await getYouTube();
  const panel = (await yt.music.getUpNext(seed.sourceId, true)) as unknown as Loose;
  const items = ((panel.contents ?? []) as Loose[]).map((i) => (i.type === "PlaylistPanelVideoWrapper" ? i.primary : i));
  return uniqueById(compact(items.map((i) => mapTrack(i)))).filter((t) => t.id !== seed.id);
}
