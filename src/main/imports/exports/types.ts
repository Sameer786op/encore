import type { ImportDestination, ImportOrigin, SourceTrack } from "@shared/types";

export interface ImportedPlay {
  /** when the song started, ISO 8601 */
  playedAt: string;
  playedMs: number;
  /** some exports give one row per day with a count */
  playCount: number;
  title: string;
  artist: string;
  album?: string;
  externalId?: string;
  videoId?: string;
  /** set when one export mixes services; otherwise the export's origin applies */
  origin?: ImportOrigin;
}

export interface ParsedCollection {
  key: string;
  name: string;
  tracks: SourceTrack[];
  destination: ImportDestination;
}

export interface ParsedExport {
  origin: ImportOrigin;
  plays: ImportedPlay[];
  collections: ParsedCollection[];
  warnings: string[];
  /** false when the history has no listening time (YouTube) */
  hasListeningTime: boolean;
}

/** plays shorter than this are skips, not listens */
export const MIN_PLAY_MS = 30_000;

export function emptyExport(origin: ImportOrigin): ParsedExport {
  return { origin, plays: [], collections: [], warnings: [], hasListeningTime: true };
}
