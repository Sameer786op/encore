import { randomUUID } from "node:crypto";
import type { AlbumDetails, ArtistDetails, ArtistSummary, HomeSection, RemotePlaylist, RemotePlaylistDetails, SearchKind, SearchKindResults, SearchResults, SearchSuggestions, SuggestedItem, Track } from "@shared/types";
import { trackId } from "@shared/types";
import { cleanArtistName } from "../matching/text";
import { getYouTube } from "./client";
import { artistsFromRuns, bestArtwork, compact, mapAlbum, mapArtist, mapPlaylist, mapTrack, text, uniqueById } from "./mappers";
import { aboutTheSong, matchesQuery, normalize, offTarget } from "./ranking";

type Loose = Record<string, any>;

// "Show more" pages of song and video results, by token; only the latest searches keep theirs
const morePages = new Map<string, Loose>();

function keepMore(page: Loose | null): string | undefined {
  if (!page?.has_continuation) return undefined;
  const token = randomUUID();
  morePages.set(token, page);
  if (morePages.size > 30) morePages.delete(morePages.keys().next().value!);
  return token;
}

export async function searchMore(token: string): Promise<{ tracks: Track[]; more?: string }> {
  const page = morePages.get(token);
  if (!page) throw new Error("Those results are too old; search again");
  morePages.delete(token);
  const next = (await page.getContinuation()) as Loose;
  const items = (next.contents?.contents ?? []) as Loose[];
  return { tracks: uniqueById(compact(items.map((i) => mapTrack(i)))), more: keepMore(next) };
}

/** what YouTube Music answers for one search, before it's sorted */
export interface RawSearch {
  general: Loose | null;
  songs: Loose | null;
  videos: Loose | null;
  suggestions: Loose[];
}

const settled = <T>(result: PromiseSettledResult<T>): T | null => (result.status === "fulfilled" ? result.value : null);

async function fetchSearch(query: string): Promise<RawSearch> {
  const yt = await getYouTube();
  const [general, songs, videos, suggestions] = await Promise.allSettled([
    yt.music.search(query),
    // the song filter gives richer rows (album, duration) than the mixed results
    yt.music.search(query, { type: "song" }),
    // songs that are only uploads, such as many regional releases, are found here
    yt.music.search(query, { type: "video" }),
    yt.music.getSearchSuggestions(query),
  ]);
  // one kind failing still leaves the others to show
  if (general.status === "rejected" && songs.status === "rejected" && videos.status === "rejected") throw general.reason;
  return { general: settled(general) as Loose | null, songs: settled(songs) as Loose | null, videos: settled(videos) as Loose | null, suggestions: (settled(suggestions) ?? []) as Loose[] };
}

/** the searches YouTube Music suggests, as text */
function suggestedQueries(sections: Loose[]): string[] {
  return sections.flatMap((s) => ((s.contents ?? []) as Loose[]).map((c) => text(c.suggestion).trim()).filter(Boolean));
}

/** each search once, ignoring case and punctuation, leaving out any in `skip` */
function distinct(list: (string | undefined)[], skip: (string | undefined)[]): string[] {
  const seen = new Set(skip.filter((s): s is string => Boolean(s)).map(normalize));
  const out: string[] = [];
  for (const item of list) {
    const key = item ? normalize(item) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item!.trim());
  }
  return out;
}

const isEmpty = (r: SearchResults) => r.tracks.length + r.albums.length + r.artists.length + r.videos.length + r.playlists.length === 0;

/** sorts what YouTube Music answered: songs that hold the words searched first, then videos when the songs don't have it */
export function searchResults(query: string, raw: RawSearch): SearchResults {
  const shelves = (raw.general?.contents ?? []) as Loose[];
  const items = shelves.flatMap((shelf) => (shelf.type === "MusicCardShelf" ? [] : ((shelf.contents ?? []) as Loose[])));
  const byType = (type: string) => items.filter((i) => i.item_type === type);

  // YouTube Music searches a corrected spelling by itself when it's sure, e.g. "blinding lights" for "blinding lites"
  const showingFor = text(raw.general?.showing_results_for?.corrected_query).trim() || undefined;
  const didYouMean = showingFor ? undefined : text(raw.general?.did_you_mean?.corrected_query).trim() || undefined;
  const meant = showingFor ?? query;
  // a result fits when it holds the words typed, or the spelling YouTube Music suggests for them
  const holds = (title: string, names: string[] = []) => matchesQuery(meant, title, names) || (didYouMean !== undefined && matchesQuery(didYouMean, title, names));
  const fits = (t: Track) => holds(t.title, [...t.artists.map((a) => a.name), t.album?.title ?? ""]);

  const songs = uniqueById(compact([...((raw.songs?.songs?.contents ?? []) as Loose[]), ...byType("song")].map((i) => mapTrack(i))));
  const videos = uniqueById(compact([...((raw.videos?.videos?.contents ?? []) as Loose[]), ...byType("video")].map((i) => mapTrack(i)))).filter(
    (v) => !songs.some((s) => s.id === v.id),
  );
  const matching = songs.filter((s) => fits(s) && !aboutTheSong(s.title, meant));
  const clean = videos.filter((v) => !offTarget(v.title, meant));
  const matchingVideos = clean.filter(fits);
  // YouTube Music's order stands while its songs fit the search; when they don't have it
  // (an upload, a regional release), the songs and videos that do fit move to the top
  const promoted = matching.length >= 3 ? [] : matchingVideos.slice(0, 8);
  const tracks = matching.length >= 3 ? songs : uniqueById([...matching, ...promoted, ...songs]);

  const artists = uniqueById(compact(byType("artist").filter((i) => !text(i.subtitle).startsWith("Profile")).map(mapArtist)));
  const results: SearchResults = {
    query,
    showingFor,
    didYouMean,
    related: distinct([didYouMean, ...suggestedQueries(raw.suggestions), ...artists.slice(0, 3).map((a) => a.name)], [query, showingFor]).slice(0, 8),
    tracks,
    albums: uniqueById(compact(byType("album").map(mapAlbum))),
    // "Profile" rows are regular channels, not artists
    artists,
    // the videos people want first: the song itself, not reactions or edits
    videos: [...clean, ...videos.filter((v) => !clean.includes(v))].filter((v) => !promoted.includes(v)),
    playlists: uniqueById(compact(byType("playlist").map(mapPlaylist))),
    moreSongs: keepMore(raw.songs),
    moreVideos: keepMore(raw.videos),
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

  const top = results.top;
  const topFits =
    top?.kind === "track" ? fits(top.track) : top?.kind === "artist" ? holds(top.artist.name) : top?.kind === "album" ? holds(top.album.title, top.album.artists.map((a) => a.name)) : false;
  results.noExactMatch = matching.length === 0 && matchingVideos.length === 0 && !topFits;
  return results;
}

export async function search(query: string): Promise<SearchResults> {
  const results = searchResults(query, await fetchSearch(query));
  const words = query.trim().split(/\s+/);
  if (results.related.length < 3 && words.length > 1) {
    // a long search YouTube Music has no ideas for: ask about the start of it instead
    const shorter = words.slice(0, -1).join(" ");
    const yt = await getYouTube();
    const more = suggestedQueries(((await yt.music.getSearchSuggestions(shorter).catch(() => [])) as unknown as Loose[]) ?? []);
    results.related = distinct([...results.related, ...more, shorter], [query, results.showingFor]).slice(0, 8);
  }
  if (isEmpty(results)) {
    // nothing at all: search what YouTube Music thinks was meant instead
    const instead = results.didYouMean ?? results.related[0];
    if (instead) {
      const retry = await fetchSearch(instead)
        .then((raw) => searchResults(instead, raw))
        .catch(() => null);
      if (retry && !isEmpty(retry)) {
        const showingFor = retry.showingFor ?? instead;
        return { ...retry, query, showingFor, didYouMean: undefined, related: distinct([...retry.related, ...results.related], [query, showingFor]).slice(0, 8) };
      }
    }
  }
  return results;
}

function suggestedItem(row: Loose): SuggestedItem | null {
  // the row's second column reads like "Song • Arijit Singh • 4.1M plays"
  const line = text(row.flex_columns?.[1]?.title).trim() || text(row.subtitle).trim();
  if (row.item_type === "song" || row.item_type === "video") {
    const track = mapTrack(row);
    return track && { kind: "track", track, subtitle: line || `Song • ${track.artists.map((a) => a.name).join(", ")}` };
  }
  if (row.item_type === "artist") {
    const artist = mapArtist(row);
    return artist && { kind: "artist", artist, subtitle: line ? `Artist • ${line.replace(/^Artist\s*•\s*/, "")}` : "Artist" };
  }
  if (row.item_type === "album") {
    const album = mapAlbum(row);
    return album && { kind: "album", album, subtitle: line || "Album" };
  }
  if (row.item_type === "playlist") {
    const playlist = mapPlaylist(row);
    return playlist && { kind: "playlist", playlist, subtitle: line || "Playlist" };
  }
  return null;
}

/** what YouTube Music suggests while typing: searches, and songs, artists, albums and playlists to open right away */
export async function suggestions(query: string): Promise<SearchSuggestions> {
  if (!query.trim()) return { queries: [], items: [] };
  const yt = await getYouTube();
  const sections = (await yt.music.getSearchSuggestions(query)) as unknown as Loose[];
  const rows = sections.flatMap((s) => (s.contents ?? []) as Loose[]).filter((c) => c.type !== "SearchSuggestion");
  return { queries: [...new Set(suggestedQueries(sections))].slice(0, 6), items: compact(rows.map(suggestedItem)).slice(0, 5) };
}

/** artists, albums or playlists only, for the tabs over search results */
export async function searchKind(query: string, kind: SearchKind): Promise<SearchKindResults> {
  const none: SearchKindResults = { artists: [], albums: [], playlists: [] };
  if (kind === "artists") return { ...none, artists: await searchArtists(query) };
  const yt = await getYouTube();
  const results = (await yt.music.search(query, { type: kind === "albums" ? "album" : "playlist" })) as unknown as Loose;
  const items = ((results.contents ?? []) as Loose[]).flatMap((s) => (s.contents ?? []) as Loose[]);
  return kind === "albums"
    ? { ...none, albums: uniqueById(compact(items.filter((i) => i.item_type === "album").map(mapAlbum))) }
    : { ...none, playlists: uniqueById(compact(items.filter((i) => i.item_type === "playlist").map(mapPlaylist))) };
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

/** the chips a song's radio offers for tuning it ("Chill", "Romance", "2010s"…), which say what moods it suits */
export function moodChips(raw: unknown): string[] {
  const labels: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const chip = (node as Loose).chipCloudChipRenderer as Loose | undefined;
    if (chip) {
      const playlistId = chip.navigationEndpoint?.queueUpdateCommand?.fetchContentsCommand?.watchEndpoint?.playlistId;
      const label = ((chip.text?.runs ?? []) as Loose[]).map((r) => r?.text ?? "").join("").trim() || text(chip.text?.simpleText);
      // "All" plays the plain radio; the tuned ones start with RDAT
      if (typeof playlistId === "string" && playlistId.startsWith("RDAT") && label) labels.push(label);
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(raw);
  return [...new Set(labels)];
}

export async function songMoods(videoId: string): Promise<string[]> {
  const yt = await getYouTube();
  const next = (await yt.actions.execute("/next", { client: "YTMUSIC", videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true })) as unknown as Loose;
  return moodChips(next.data);
}

/** a song's radio tuned to a mood by YouTube Music, e.g. "RDAT" + "mXv" (chill) + the video id */
export async function moodRadio(videoId: string, code: string): Promise<Track[]> {
  const yt = await getYouTube();
  const next = (await yt.actions.execute("/next", { client: "YTMUSIC", videoId, playlistId: `RDAT${code}${videoId}`, isAudioOnly: true, parse: true })) as unknown as Loose;
  const items = (next.contents_memo?.get("PlaylistPanelVideo") ?? []) as Loose[];
  return uniqueById(compact(items.map((i) => mapTrack(i))));
}

/** YouTube Music's own playlists for a mood, from its Moods & moments page of that name */
export async function moodPlaylists(page: string): Promise<RemotePlaylist[]> {
  const yt = await getYouTube();
  const grid = (await yt.actions.execute("/browse", { client: "YTMUSIC", browseId: "FEmusic_moods_and_genres", parse: true })) as unknown as Loose;
  const buttons = (grid.contents_memo?.get("MusicNavigationButton") ?? []) as Loose[];
  const target = buttons.find((b) => text(b?.button_text).trim().toLowerCase() === page.toLowerCase())?.endpoint?.payload as Loose | undefined;
  if (!target?.browseId) throw new Error(`YouTube Music has no ${page} page`);
  const moodPage = (await yt.actions.execute("/browse", { client: "YTMUSIC", browseId: target.browseId, params: target.params, parse: true })) as unknown as Loose;
  const items = ((moodPage.contents_memo?.get("MusicTwoRowItem") ?? []) as Loose[]).filter((i) => i?.item_type === "playlist");
  return uniqueById(compact(items.map((i) => mapPlaylist(i))));
}
