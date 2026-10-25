import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ExportChoices, ExportResult, ExportSummary, ImportJob, ImportOrigin, SourceTrack, Track } from "@shared/types";
import type { ListeningHistory } from "../history/history";
import { songKey } from "../matching/text";
import { readExport } from "./exports/analyze";
import type { ParsedExport } from "./exports/types";
import { LinkError, parseLink, readApple, readSpotify, type LinkContents } from "./links";
import type { ImportManager } from "./manager";

export interface YouTubeReader {
  playlist(id: string): Promise<{ name: string; tracks: Track[] }>;
  album(id: string): Promise<{ title: string; tracks: Track[] }>;
  trackById(videoId: string): Promise<Track>;
}

/** an analysed export waits this long for the user to choose what to import */
const ANALYSIS_TTL_MS = 30 * 60_000;

const asSource = (track: Track): SourceTrack => ({
  title: track.title,
  artists: track.artists.map((a) => a.name),
  album: track.album?.title,
  durationMs: track.durationMs,
  videoId: track.sourceId,
  track,
});

/** turns links and export files into import jobs and saved history */
export class ImportService {
  private analyses = new Map<string, { parsed: ParsedExport; fileName: string; at: number }>();

  constructor(
    private readonly manager: ImportManager,
    private readonly history: ListeningHistory,
    private readonly youtube: YouTubeReader,
  ) {}

  async fromLink(url: string): Promise<ImportJob> {
    const link = parseLink(url);
    if (!link) throw new LinkError("Paste a link to a Spotify, Apple Music or YouTube playlist or album.");

    let contents: LinkContents;
    let origin: ImportOrigin;
    if (link.service === "spotify") {
      origin = "spotify";
      contents = await readSpotify(link);
    } else if (link.service === "apple") {
      origin = "apple";
      contents = await readApple(link);
    } else {
      origin = "youtube";
      if (link.kind === "playlist") {
        const list = await this.youtube.playlist(link.id);
        contents = { name: list.name, tracks: list.tracks.map(asSource) };
      } else if (link.kind === "album") {
        const album = await this.youtube.album(link.id);
        contents = { name: album.title, tracks: album.tracks.map(asSource) };
      } else {
        const track = await this.youtube.trackById(link.id);
        contents = { name: track.title, tracks: [asSource(track)] };
      }
    }
    if (contents.tracks.length === 0) throw new LinkError("That playlist looks empty, or it isn't public.");
    return this.manager.create({
      name: contents.name,
      origin,
      destination: { kind: "playlist", name: contents.name },
      tracks: contents.tracks,
      note: contents.note,
    });
  }

  async analyze(path: string): Promise<ExportSummary> {
    const parsed = await readExport(path);
    const token = randomUUID();
    const now = Date.now();
    for (const [key, entry] of this.analyses) if (now - entry.at > ANALYSIS_TTL_MS) this.analyses.delete(key);
    this.analyses.set(token, { parsed, fileName: basename(path), at: now });

    const plays = parsed.plays;
    let firstAt = "";
    let lastAt = "";
    for (const p of plays) {
      if (!firstAt || p.playedAt < firstAt) firstAt = p.playedAt;
      if (!lastAt || p.playedAt > lastAt) lastAt = p.playedAt;
    }
    return {
      token,
      origin: parsed.origin,
      fileName: basename(path),
      history:
        plays.length > 0
          ? {
              plays: plays.reduce((s, p) => s + p.playCount, 0),
              songs: new Set(plays.map((p) => songKey(p.artist, p.title))).size,
              firstAt,
              lastAt,
              hasListeningTime: parsed.hasListeningTime,
            }
          : undefined,
      collections: parsed.collections.map((c) => ({ key: c.key, name: c.name, count: c.tracks.length, destination: c.destination })),
      warnings: parsed.warnings,
    };
  }

  apply(token: string, choices: ExportChoices): ExportResult {
    const entry = this.analyses.get(token);
    if (!entry) throw new Error("That export was read a while ago. Choose the file again.");
    this.analyses.delete(token);
    const { parsed } = entry;
    const historyAdded = choices.history ? this.history.add(parsed.origin, parsed.plays) : 0;
    const jobs = parsed.collections
      .filter((c) => choices.collections.includes(c.key))
      .map((c) => this.manager.create({ name: c.name, origin: parsed.origin, destination: c.destination, tracks: c.tracks }));
    return { historyAdded, jobs };
  }
}
