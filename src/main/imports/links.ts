import type { SourceTrack } from "@shared/types";
import { splitArtists } from "../matching/text";

// Public playlist and album links, read without signing in to anything.

export type ParsedLink =
  | { service: "spotify"; kind: "playlist" | "album" | "track"; id: string }
  | { service: "apple"; kind: "playlist" | "album" | "song"; url: string; songId?: string }
  | { service: "youtube"; kind: "playlist"; id: string }
  | { service: "youtube"; kind: "album"; id: string }
  | { service: "youtube"; kind: "video"; id: string };

export interface LinkContents {
  name: string;
  tracks: SourceTrack[];
  /** shown on the import, e.g. when a service only shared part of a playlist */
  note?: string;
}

export class LinkError extends Error {}

export function parseLink(raw: string): ParsedLink | null {
  const text = raw.trim();
  const spotifyUri = /^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/.exec(text);
  if (spotifyUri) return { service: "spotify", kind: spotifyUri[1] as "playlist", id: spotifyUri[2] };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.split("/").filter(Boolean);

  if (host === "open.spotify.com" || host === "play.spotify.com") {
    // /intl-de/playlist/<id> and /embed/playlist/<id> both happen
    const at = path.findIndex((p) => p === "playlist" || p === "album" || p === "track");
    const id = path[at + 1];
    if (at >= 0 && id && /^[A-Za-z0-9]{22}$/.test(id)) return { service: "spotify", kind: path[at] as "playlist", id };
    return null;
  }

  if (host === "music.apple.com" || host === "itunes.apple.com") {
    const kind = path.find((p) => p === "playlist" || p === "album" || p === "song");
    if (!kind) return null;
    const songId = url.searchParams.get("i") ?? undefined;
    url.protocol = "https:";
    return { service: "apple", kind: kind as "playlist", url: url.toString(), songId: kind === "album" ? songId : undefined };
  }

  if (host === "music.youtube.com" || host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const list = url.searchParams.get("list");
    // personal mixes (RD...) are generated on the fly, not saved playlists, except YouTube Music's curated RDCLAK lists
    if (list && (!list.startsWith("RD") || list.startsWith("RDCLAK"))) return { service: "youtube", kind: "playlist", id: list };
    if (path[0] === "browse" && path[1]) {
      if (path[1].startsWith("MPREb_")) return { service: "youtube", kind: "album", id: path[1] };
      if (path[1].startsWith("VL")) return { service: "youtube", kind: "playlist", id: path[1].slice(2) };
    }
    const video = host === "youtu.be" ? path[0] : url.searchParams.get("v");
    if (video && /^[\w-]{11}$/.test(video)) return { service: "youtube", kind: "video", id: video };
    return null;
  }
  return null;
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new LinkError("That link doesn't exist anymore, or it's private.");
  if (!res.ok) throw new LinkError(`The page answered with an error (${res.status}). Try again in a minute.`);
  return res.text();
}

// ---- Spotify: the embed player page carries up to 100 tracks as JSON ----

interface SpotifyEntity {
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  uri?: string;
  trackList?: { title?: string; subtitle?: string; duration?: number; uri?: string }[];
}

export const SPOTIFY_EMBED_LIMIT = 100;

export function spotifyFromEmbed(html: string, kind: "playlist" | "album" | "track"): LinkContents {
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new LinkError("Spotify didn't share this one. Make sure the playlist is public.");
  const entity = (JSON.parse(json) as { props?: { pageProps?: { state?: { data?: { entity?: SpotifyEntity } } } } }).props?.pageProps?.state?.data?.entity;
  if (!entity) throw new LinkError("Spotify didn't share this one. Make sure the playlist is public.");
  const name = entity.name ?? entity.title ?? "Spotify playlist";

  if (kind === "track") {
    return { name, tracks: [{ title: name, artists: splitArtists(entity.subtitle ?? ""), durationMs: entity.duration, externalId: entity.uri }] };
  }
  const tracks = (entity.trackList ?? [])
    .filter((t) => t.title)
    .map((t): SourceTrack => ({
      title: t.title!,
      // the embed lists credits as "A, B"
      artists: (t.subtitle ?? "").split(/,\s*/).map((a) => a.trim()).filter(Boolean),
      album: kind === "album" ? name : undefined,
      durationMs: t.duration,
      externalId: t.uri,
    }));
  const note =
    kind === "playlist" && tracks.length >= SPOTIFY_EMBED_LIMIT
      ? "Spotify only shares the first 100 songs of a playlist without signing in. For the whole thing, import your Spotify data export or an Exportify CSV."
      : undefined;
  return { name, tracks, note };
}

export async function readSpotify(link: Extract<ParsedLink, { service: "spotify" }>): Promise<LinkContents> {
  return spotifyFromEmbed(await fetchPage(`https://open.spotify.com/embed/${link.kind}/${link.id}`), link.kind);
}

// ---- Apple Music: the web page carries the tracklist as JSON ----

interface AppleItem {
  title?: string;
  artistName?: string;
  duration?: number;
  subtitleLinks?: { title?: string }[];
  tertiaryLinks?: { title?: string }[];
  contentDescriptor?: { identifiers?: { storeAdamID?: string } };
  description?: string;
}

export function appleFromPage(html: string, kind: "playlist" | "album" | "song", songId?: string): LinkContents {
  const json = html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new LinkError("Apple Music didn't share this one. Make sure the playlist is public.");
  const data = JSON.parse(json) as { data?: { data?: { sections?: { itemKind?: string; items?: AppleItem[] }[] } }[] };
  const sections = data.data?.[0]?.data?.sections ?? [];
  const header = sections.find((s) => s.itemKind === "containerDetailHeaderLockup")?.items?.[0];
  const name = header?.title ?? "Apple Music playlist";
  let items = sections.filter((s) => s.itemKind === "trackLockup").flatMap((s) => s.items ?? []);
  if (songId) items = items.filter((i) => i.contentDescriptor?.identifiers?.storeAdamID === songId);

  const tracks = items
    .filter((i) => i.title)
    .map((i): SourceTrack => ({
      title: i.title!,
      artists: i.artistName ? splitArtists(i.artistName) : (i.subtitleLinks ?? []).map((l) => l.title ?? "").filter(Boolean),
      album: kind === "playlist" ? i.tertiaryLinks?.[0]?.title : name,
      durationMs: i.duration,
      externalId: i.contentDescriptor?.identifiers?.storeAdamID,
    }));

  // the footer says e.g. "250 songs, 14 hours"
  const footer = sections.find((s) => s.itemKind === "containerDetailTracklistFooterLockup")?.items?.[0]?.description ?? "";
  const total = Number(footer.match(/^([\d,.]+)\s/)?.[1]?.replace(/[,.]/g, ""));
  const note =
    !songId && total > tracks.length
      ? `Apple Music's page showed ${tracks.length} of ${total} songs. For the whole playlist, import your Apple data export.`
      : undefined;
  return { name: songId ? (tracks[0]?.title ?? name) : name, tracks, note };
}

export async function readApple(link: Extract<ParsedLink, { service: "apple" }>): Promise<LinkContents> {
  return appleFromPage(await fetchPage(link.url), link.kind, link.songId);
}
