import type { Innertube } from "youtubei.js";
import type { Track } from "@shared/types";
import { fold } from "../matching/text";
import { refused } from "./google";
import { SignedOutError, type AccountProvider, type RemoteArtist, type RemotePlaylist, type RemoteSong } from "./provider";

// Reads a YouTube library the way YouTube's TV app does: that's the only
// reading YouTube allows with the TV sign-in Vyse Music connects with (see
// google.ts). Its songs are YouTube videos already, so nothing needs matching.

type Loose = Record<string, any>;

const LIKED = "LM";
// YouTube's own lists that aren't music: liked videos (Liked Music has the songs), Watch later, saved Shorts, Sounds
const SKIP = new Set(["LL", "WL", "YS", "SS"]);
// saved Mixes ("RD…") are endless radio that's different every time
const MIX = /^RD/;
// the TV pages say when a playlist changed only roughly ("Updated today"), so each one is read again at least this often
const REREAD_MS = 3 * 60 * 60_000;
const MAX_PAGES = 400;

/** the text of a TV page's text field */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  const v = value as Loose | undefined;
  return String(v?.simpleText ?? v?.runs?.map((r: Loose) => r.text).join("") ?? v?.content ?? "");
}

/** every `key` object anywhere under `node` */
function findAll(node: unknown, key: string, out: Loose[] = []): Loose[] {
  if (Array.isArray(node)) for (const n of node) findAll(n, key, out);
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v as Loose);
      else findAll(v, key, out);
    }
  return out;
}

/** a tile's lines of small print under its title */
function tileLines(tile: Loose): string[] {
  return ((tile.metadata?.tileMetadataRenderer?.lines ?? []) as Loose[]).map((line) =>
    ((line.lineRenderer?.items ?? []) as Loose[]).map((item) => text(item.lineItemRenderer?.text)).join(""),
  );
}

/** the label on a tile's picture: a song's length, or a playlist's number of videos */
function tileBadge(tile: Loose): string {
  return findAll(tile.header, "thumbnailOverlayTimeStatusRenderer").map((o) => text(o.text))[0] ?? "";
}

/** "3:05" or "1:02:03" in milliseconds */
export function badgeMs(badge: string): number {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(badge.trim())) return 0;
  return badge.trim().split(":").reduce((total, part) => total * 60 + Number(part), 0) * 1_000;
}

/** "A, B, & C" or "A & B" as names */
export function splitArtists(line: string): string[] {
  return line
    .split(/\s*,\s*&\s*|\s*,\s*|\s+&\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** a video tile as a song, ready to play; `music` when YouTube already counts it as music (everything in Liked Music) */
export function songFromTile(tile: Loose, music = false): RemoteSong | null {
  const videoId = (tile.onSelectCommand?.watchEndpoint?.videoId ?? tile.contentId) as string | undefined;
  if (tile.contentType !== "TILE_CONTENT_TYPE_VIDEO" || !videoId || !/^[\w-]{11}$/.test(videoId)) return null;
  let title = text(tile.metadata?.tileMetadataRenderer?.title).trim();
  if (!title) return null;
  const [byline = "", details = ""] = tileLines(tile);
  let artists = splitArtists(byline.replace(/\s+-\s+Topic$/, ""));
  // music uploaded by someone other than the artist is usually called "Artist - Title"; songs YouTube knows as music
  // already name the artist, and outside music a dash means anything ("Lecture 1 - …")
  const dash = /^(.+?)\s+[-–]\s+(.+)$/.exec(title);
  if (music && !/^Song\b/.test(details) && dash) {
    artists = splitArtists(dash[1]);
    title = dash[2].trim();
  }
  const thumbnails = findAll(tile.header, "thumbnails")[0] as Loose[] | undefined;
  const artwork = thumbnails?.at(-1)?.url as string | undefined;
  const track: Track = {
    id: `youtube:${videoId}`,
    source: "youtube",
    sourceId: videoId,
    title,
    artists: artists.map((name) => ({ name })),
    durationMs: badgeMs(tileBadge(tile)),
    ...(artwork ? { artwork } : {}),
  };
  return { title, artists, durationMs: track.durationMs, videoId, track };
}

export class YouTubeProvider implements AccountProvider {
  // artists of the Liked Music songs read so far: a subscribed channel counts as an artist only if it's one of these
  private songArtists = new Set<string>();
  // Liked Music's first page, already read to tell whether it changed
  private likedFirstPage: Loose | null = null;

  /** `client` gives an Innertube session with the account's TV sign-in; it throws SignedOutError when there's none */
  constructor(
    private readonly client: () => Promise<Innertube>,
    private readonly now: () => number = Date.now,
  ) {}

  private async browse(args: Loose): Promise<Loose> {
    const yt = await this.client();
    try {
      const response = await yt.actions.execute("/browse", { ...args, client: "TV", skip_auth_check: true });
      return response.data as Loose;
    } catch (error) {
      if (refused(error)) throw new SignedOutError("YouTube no longer takes the sign-in");
      throw error;
    }
  }

  /** every tile of a page, across its "more" pages */
  private async tiles(browseId: string, first?: Loose): Promise<Loose[]> {
    let page = first ?? (await this.browse({ browseId }));
    const tiles = findAll(page.contents, "tileRenderer");
    const seen = new Set(tiles.map((t) => t.contentId));
    for (let pages = 1; pages < MAX_PAGES; pages++) {
      const token = findAll(page, "nextContinuationData")[0]?.continuation as string | undefined;
      if (!token) break;
      page = await this.browse({ continuation: token });
      const more = findAll(page.continuationContents ?? page.onResponseReceivedActions ?? page, "tileRenderer").filter((t) => !seen.has(t.contentId));
      // some pages hand back the same tiles again instead of ending
      if (more.length === 0) break;
      for (const t of more) seen.add(t.contentId);
      tiles.push(...more);
    }
    return tiles;
  }

  async whoAmI(): Promise<{ name?: string }> {
    const yt = await this.client();
    try {
      const response = await yt.actions.execute("/account/accounts_list", { client: "TV" });
      const accounts = findAll(response.data, "accountItem");
      const me = accounts.find((a) => a.isSelected) ?? accounts[0];
      return { name: text(me?.accountName).trim() || undefined };
    } catch (error) {
      if (refused(error)) throw new SignedOutError("YouTube no longer takes the sign-in");
      // the name is only for show; reading the library tells whether the sign-in still works
      return {};
    }
  }

  async playlists(): Promise<RemotePlaylist[]> {
    const round = Math.floor(this.now() / REREAD_MS);
    // Liked Music isn't among the playlists; its newest songs come first, so they tell when it changed
    const liked = await this.browse({ browseId: `VL${LIKED}` });
    const newest = findAll(liked.contents, "tileRenderer")
      .slice(0, 15)
      .map((t) => t.contentId)
      .join(",");
    const out: RemotePlaylist[] = [{ remoteId: LIKED, name: "Liked Music", liked: true, version: `${newest}|${round}` }];
    this.likedFirstPage = liked;
    for (const tile of await this.tiles("FEplaylist_aggregation")) {
      const id = tile.contentId as string | undefined;
      if (tile.contentType !== "TILE_CONTENT_TYPE_PLAYLIST" || !id || SKIP.has(id) || MIX.test(id) || out.some((p) => p.remoteId === id)) continue;
      const name = text(tile.metadata?.tileMetadataRenderer?.title).trim();
      if (name) out.push({ remoteId: id, name, version: `${tileBadge(tile)}|${tileLines(tile).join("|")}|${round}` });
    }
    return out;
  }

  async songs(list: RemotePlaylist): Promise<RemoteSong[]> {
    // only music goes in Liked Music, YouTube decides; other playlists can hold anything
    const music = list.remoteId === LIKED;
    const first = music ? (this.likedFirstPage ?? undefined) : undefined;
    this.likedFirstPage = null;
    const songs: RemoteSong[] = [];
    for (const tile of await this.tiles(`VL${list.remoteId}`, first)) {
      const song = songFromTile(tile, music);
      if (!song) continue;
      songs.push(song);
      if (music) for (const name of song.artists) this.songArtists.add(fold(name));
    }
    return songs;
  }

  async artists(): Promise<RemoteArtist[]> {
    const out: RemoteArtist[] = [];
    for (const tile of await this.tiles("FEchannels")) {
      if (tile.contentType !== "TILE_CONTENT_TYPE_CHANNEL") continue;
      const name = text(tile.metadata?.tileMetadataRenderer?.title)
        .replace(/\s+-\s+Topic$/, "")
        .trim();
      // most subscriptions are channels of every kind; only ones you've liked songs by are followed as artists
      if (name && this.songArtists.has(fold(name))) out.push({ name });
    }
    return out;
  }
}
