import type { AlbumDetails, ArtistDetails, RemotePlaylistDetails } from "@shared/types";

/** remembers catalog pages for the session (or a while) so going back is instant */
class PageCache<T> {
  private entries = new Map<string, { promise: Promise<T>; at: number }>();
  constructor(
    private readonly load: (id: string) => Promise<T>,
    private readonly limit = 50,
    private readonly maxAgeMs = Infinity,
  ) {}

  get(id: string): Promise<T> {
    const hit = this.entries.get(id);
    if (hit && Date.now() - hit.at < this.maxAgeMs) return hit.promise;
    const promise = this.load(id);
    promise.catch(() => this.entries.get(id)?.promise === promise && this.entries.delete(id));
    this.entries.delete(id);
    this.entries.set(id, { promise, at: Date.now() });
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return promise;
  }
}

export const albumCache = new PageCache<AlbumDetails>((id) => window.encore.catalog.album(id));
// artists put out new singles and charts change through the day, so these are looked at again after 10 minutes
export const artistCache = new PageCache<ArtistDetails>((id) => window.encore.catalog.artist(id), 50, 10 * 60_000);
export const remotePlaylistCache = new PageCache<RemotePlaylistDetails>((id) => window.encore.catalog.playlist(id), 20, 10 * 60_000);
