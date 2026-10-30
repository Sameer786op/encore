import type { LinkContents } from "../imports/links";
import { getJson, type ApiAuth, type Fetch } from "./http";
import { AccountRefusedError, SignedOutError, type AccountProvider, type RemoteArtist, type RemotePlaylist, type RemoteSong } from "./provider";

// Reads a Spotify account through the Web API, signed in through Spotify's
// official sign-in (spotifyAuth.ts). Since 2026 Spotify only lets an app like
// this read accounts added in its developer dashboard, while its owner has Premium.

const API = "https://api.spotify.com/v1";
const LIKED = "liked";

interface Page<T> {
  items?: T[];
  next?: string | null;
  total?: number;
}

interface SpotifyTrack {
  type?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { name?: string };
}

/** a playlist entry; the 2026 API calls the song `item`, the older one `track` */
interface SpotifyEntry {
  added_at?: string;
  item?: SpotifyTrack | null;
  track?: SpotifyTrack | null;
}

interface SpotifyPlaylist {
  id?: string;
  name?: string;
  snapshot_id?: string;
}

export function songFromEntry(entry: SpotifyEntry): RemoteSong | null {
  const t = entry.item ?? entry.track;
  if (!t || (t.type && t.type !== "track") || !t.name) return null;
  const artists = (t.artists ?? []).map((a) => a.name ?? "").filter(Boolean);
  return {
    title: t.name,
    artists,
    album: t.album?.name || undefined,
    durationMs: t.duration_ms || undefined,
    externalId: t.uri || undefined,
    addedAt: entry.added_at || undefined,
  };
}

export class SpotifyProvider implements AccountProvider {
  constructor(
    private readonly auth: ApiAuth,
    /** the public embed page: other people's playlists only share their first 100 songs that way */
    private readonly readEmbed: (id: string) => Promise<LinkContents>,
    private readonly fetchImpl: Fetch = fetch,
    /** a stand-in for api.spotify.com/v1, for tests */
    private readonly api = API,
  ) {}

  private get<T>(pathOrUrl: string): Promise<T | null> {
    // Spotify says 401 for a token that ran out; 403 only means that one thing isn't yours to read
    return getJson<T>(/^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.api}${pathOrUrl}`, this.auth, this.fetchImpl, [401]);
  }

  /** why Spotify won't say who's signed in: an account that isn't on the app's list, or an owner without Premium */
  private async refusal(): Promise<Error> {
    const res = await this.fetchImpl(`${this.api}/me`, { headers: await this.auth.headers(), signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.status !== 403) return new SignedOutError("No Spotify account");
    const said = await res.text().catch(() => "");
    if (/premium/i.test(said)) return new AccountRefusedError("Spotify has paused Vyse Music's Spotify app: the app's owner needs Spotify Premium for it to work.");
    return new AccountRefusedError(
      "Spotify hasn't let this account in yet. An app like Vyse Music can only read Spotify accounts added by email in its Spotify developer dashboard, up to 5. Ask whoever set up its Spotify app to add your Spotify email, then connect again.",
    );
  }

  /** every item across "next" pages */
  private async all<T>(first: string, max = 10_000): Promise<{ items: T[]; found: boolean }> {
    const items: T[] = [];
    let next: string | null | undefined = first;
    let found = false;
    while (next && items.length < max) {
      const page: Page<T> | null = await this.get<Page<T>>(next);
      if (!page) break;
      found = true;
      items.push(...(page.items ?? []));
      next = page.next;
    }
    return { items, found };
  }

  async whoAmI(): Promise<{ name?: string }> {
    const me = await this.get<{ id?: string; display_name?: string | null }>("/me");
    if (!me?.id) throw await this.refusal();
    return { name: me.display_name || me.id };
  }

  async playlists(): Promise<RemotePlaylist[]> {
    // one liked song is enough to tell whether the list changed: its count and newest song
    const liked = await this.get<Page<SpotifyEntry>>("/me/tracks?limit=1");
    const { items } = await this.all<SpotifyPlaylist>("/me/playlists?limit=50");
    return [
      ...(liked ? [{ remoteId: LIKED, name: "Liked Songs", liked: true, version: `${liked.total ?? 0}:${liked.items?.[0]?.added_at ?? ""}` }] : []),
      ...items.filter((p) => p.id && p.name).map((p) => ({ remoteId: p.id!, name: p.name!, version: p.snapshot_id })),
    ];
  }

  async songs(playlist: RemotePlaylist): Promise<RemoteSong[]> {
    if (playlist.remoteId === LIKED) {
      const { items } = await this.all<SpotifyEntry>("/me/tracks?limit=50");
      return items.map(songFromEntry).filter((s): s is RemoteSong => s !== null);
    }
    const id = encodeURIComponent(playlist.remoteId);
    let read = await this.all<SpotifyEntry>(`/playlists/${id}/items?limit=100`);
    if (!read.found) read = await this.all<SpotifyEntry>(`/playlists/${id}/tracks?limit=100`);
    if (read.found && read.items.length > 0) return read.items.map(songFromEntry).filter((s): s is RemoteSong => s !== null);
    // Spotify only lists the songs of playlists you made or collaborate on; for ones you follow, the embed page has the first 100
    const embed = await this.readEmbed(playlist.remoteId).catch(() => null);
    return embed?.tracks ?? [];
  }

  async artists(): Promise<RemoteArtist[]> {
    const out: RemoteArtist[] = [];
    let next: string | null | undefined = "/me/following?type=artist&limit=50";
    while (next && out.length < 2_000) {
      const page: { artists?: Page<{ name?: string }> } | null = await this.get(next);
      if (!page?.artists) break;
      out.push(...(page.artists.items ?? []).filter((a) => a.name).map((a) => ({ name: a.name! })));
      next = page.artists.next;
    }
    return out;
  }
}
