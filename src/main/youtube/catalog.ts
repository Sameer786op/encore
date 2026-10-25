import type { AlbumDetails, ArtistDetails, ArtistSummary, HomeSection, SearchResults, Track } from "@shared/types";
import { trackId } from "@shared/types";
import { cleanArtistName } from "../matching/text";
import { getYouTube } from "./client";
import { artistsFromRuns, bestArtwork, compact, mapAlbum, mapArtist, mapTrack, text, uniqueById } from "./mappers";

type Loose = Record<string, any>;

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

export async function home(): Promise<HomeSection[]> {
  const yt = await getYouTube();
  const feed = (await yt.music.getHomeFeed()) as unknown as Loose;
  const sections = (feed.sections ?? []) as Loose[];
  return sections
    .filter((s) => s.type === "MusicCarouselShelf")
    .map((s) => {
      const items = (s.contents ?? []) as Loose[];
      return {
        title: text(s.header?.title),
        tracks: compact(items.filter((i) => i.item_type === "song" || i.item_type === "video").map((i) => mapTrack(i))),
        albums: compact(items.filter((i) => i.item_type === "album").map(mapAlbum)),
      };
    })
    .filter((s) => s.title && (s.tracks.length > 0 || s.albums.length > 0));
}

/** songs only (no videos), for matching songs from other services */
export async function searchSongs(query: string): Promise<Track[]> {
  const yt = await getYouTube();
  const results = await yt.music.search(query, { type: "song" });
  return uniqueById(compact(((results.songs?.contents ?? []) as Loose[]).map((i) => mapTrack(i))));
}

/** a saved YouTube or YouTube Music playlist, following "load more" pages */
export async function playlist(id: string, maxTracks = 5000): Promise<{ name: string; tracks: Track[] }> {
  const yt = await getYouTube();
  let page = (await yt.music.getPlaylist(id)) as unknown as Loose;
  const name = text(page.header?.title) || "YouTube playlist";
  const items: Loose[] = [...((page.items ?? page.contents ?? []) as Loose[])];
  while (page.has_continuation && items.length < maxTracks) {
    page = (await page.getContinuation()) as Loose;
    const more = (page.items ?? page.contents ?? []) as Loose[];
    if (more.length === 0) break;
    items.push(...more);
  }
  return { name, tracks: compact(items.slice(0, maxTracks).map((i) => mapTrack(i))) };
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
