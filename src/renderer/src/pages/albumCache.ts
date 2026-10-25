import type { AlbumDetails, ArtistDetails } from "@shared/types";

/** remembers catalog pages for the session so going back is instant */
class PageCache<T> {
  private entries = new Map<string, Promise<T>>();
  constructor(
    private readonly load: (id: string) => Promise<T>,
    private readonly limit = 50,
  ) {}

  get(id: string): Promise<T> {
    const hit = this.entries.get(id);
    if (hit) return hit;
    const promise = this.load(id);
    promise.catch(() => this.entries.delete(id));
    this.entries.set(id, promise);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return promise;
  }
}

export const albumCache = new PageCache<AlbumDetails>((id) => window.encore.catalog.album(id));
export const artistCache = new PageCache<ArtistDetails>((id) => window.encore.catalog.artist(id));
