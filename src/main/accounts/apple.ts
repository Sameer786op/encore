import { getJson, type ApiAuth, type Fetch } from "./http";
import { SignedOutError, type AccountProvider, type RemotePlaylist, type RemoteSong } from "./provider";

// Reads an Apple Music library through the same API music.apple.com uses, with
// the tokens that page holds once you've signed in there.

const API = "https://amp-api.music.apple.com";

interface Page<T> {
  data?: T[];
  next?: string;
}

interface LibraryPlaylist {
  id?: string;
  attributes?: { name?: string; lastModifiedDate?: string; dateAdded?: string };
}

interface LibrarySong {
  type?: string;
  attributes?: { name?: string; artistName?: string; albumName?: string; durationInMillis?: number; playParams?: { catalogId?: string } };
}

export function songFromLibrary(song: LibrarySong): RemoteSong | null {
  const a = song.attributes;
  if (!a?.name || (song.type && !/song|music-video/i.test(song.type))) return null;
  return {
    title: a.name,
    artists: a.artistName ? [a.artistName] : [],
    album: a.albumName || undefined,
    durationMs: a.durationInMillis || undefined,
    externalId: a.playParams?.catalogId ? `apple:${a.playParams.catalogId}` : undefined,
  };
}

export class AppleProvider implements AccountProvider {
  constructor(
    private readonly auth: ApiAuth,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private get<T>(path: string): Promise<T | null> {
    return getJson<T>(`${API}${path}`, this.auth, this.fetchImpl);
  }

  /** every item across "next" pages; Apple gives the next page as a path */
  private async all<T>(first: string, max = 20_000): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = first;
    while (next && items.length < max) {
      const page: Page<T> | null = await this.get<Page<T>>(next);
      if (!page) break;
      items.push(...(page.data ?? []));
      next = page.next ? `${page.next}${page.next.includes("limit=") ? "" : `${page.next.includes("?") ? "&" : "?"}limit=100`}` : undefined;
    }
    return items;
  }

  async whoAmI(): Promise<{ name?: string }> {
    // Apple's web API doesn't share your name; being able to read your storefront means you're signed in
    const storefront = await this.get<Page<unknown>>("/v1/me/storefront");
    if (!storefront?.data?.length) throw new SignedOutError("No Apple Music account");
    return {};
  }

  async playlists(): Promise<RemotePlaylist[]> {
    const lists = await this.all<LibraryPlaylist>("/v1/me/library/playlists?limit=100");
    return lists
      .filter((p) => p.id && p.attributes?.name)
      .map((p) => ({ remoteId: p.id!, name: p.attributes!.name!, version: p.attributes!.lastModifiedDate || undefined }));
  }

  async songs(playlist: RemotePlaylist): Promise<RemoteSong[]> {
    // an empty playlist answers 404
    const songs = await this.all<LibrarySong>(`/v1/me/library/playlists/${encodeURIComponent(playlist.remoteId)}/tracks?limit=100`);
    return songs.map(songFromLibrary).filter((s): s is RemoteSong => s !== null);
  }
}
