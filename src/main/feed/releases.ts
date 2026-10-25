import type { AlbumSummary, ArtistSummary, ReleaseItem } from "@shared/types";

// Spotting new releases: we remember every release we've seen per artist.
// The first time we look at an artist, everything already out is "baseline";
// anything that appears after that is new.

export interface SeenRelease {
  album: AlbumSummary;
  artist: ArtistSummary;
  firstSeenAt: string;
  baseline: boolean;
}

export function diffReleases(
  artist: ArtistSummary,
  releases: AlbumSummary[],
  seenIds: Set<string>,
  firstLook: boolean,
  now = new Date(),
): SeenRelease[] {
  return releases
    .filter((album) => !seenIds.has(album.id))
    .map((album) => ({ album, artist, firstSeenAt: now.toISOString(), baseline: firstLook }));
}

const NEW_FOR_DAYS = 45;

/** what the home page shows: genuinely new releases first, then this year's from your artists */
export function releasesForFeed(all: SeenRelease[], artistRank: Map<string, number>, now = new Date(), limit = 20): ReleaseItem[] {
  const year = now.getFullYear();
  const cutoff = now.getTime() - NEW_FOR_DAYS * 86_400_000;
  const rank = (r: SeenRelease) => artistRank.get(r.artist.id) ?? 999;
  const fresh = all.filter((r) => !r.baseline && Date.parse(r.firstSeenAt) >= cutoff).sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || rank(a) - rank(b));
  const thisYear = all
    .filter((r) => r.baseline && Number(r.album.year) >= year - (now.getMonth() < 2 ? 1 : 0))
    .sort((a, b) => Number(b.album.year) - Number(a.album.year) || rank(a) - rank(b));
  const seen = new Set<string>();
  return [...fresh, ...thisYear]
    .filter((r) => (seen.has(r.album.id) ? false : (seen.add(r.album.id), true)))
    .slice(0, limit)
    .map((r) => ({ album: r.album, artist: r.artist, firstSeenAt: r.firstSeenAt, isNew: !r.baseline }));
}
