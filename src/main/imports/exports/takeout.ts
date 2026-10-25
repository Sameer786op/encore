import type { SourceTrack } from "@shared/types";
import { cleanArtistName } from "../../matching/text";
import { csvObjects, parseCsv, pick } from "./csv";
import { readJson, readText, type ExportFile } from "./files";
import { emptyExport, type ImportedPlay, type ParsedExport } from "./types";

// Google Takeout, "YouTube and YouTube Music":
// - history/watch-history.json (or .html, Takeout's default format)
// - playlists/<name>-videos.csv (or <name>.csv in older exports), one video id per row
// Only entries Google files under "YouTube Music" count as listening.

interface WatchEntry {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: { name?: string; url?: string }[];
  time?: string;
}

const isWatchJson = (name: string) => /(^|\/)watch-history\.json$/i.test(name);
const isWatchHtml = (name: string) => /(^|\/)watch-history\.html?$/i.test(name);
const isPlaylistCsv = (name: string) => /(^|\/)playlists\/[^/]+\.csv$/i.test(name) && !/(^|\/)playlists\.csv$/i.test(name);
const isMusicLibraryCsv = (name: string) => /music[ -]library[ -]songs\.csv$/i.test(name);

export function looksLikeTakeout(files: ExportFile[]): boolean {
  return files.some((f) => isWatchJson(f.name) || isWatchHtml(f.name) || isPlaylistCsv(f.name) || isMusicLibraryCsv(f.name));
}

const VIDEO_ID = /[?&]v=([\w-]{11})/;

/** "Watched Song" in English; other languages put the song name in the link text only */
function stripWatched(title: string): string {
  return title.replace(/^Watched\s+/i, "").trim();
}

function decodeEntities(html: string): string {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** "Oct 1, 2025, 10:00:00 PM IST" -> a time, treating the zone as local when it's an abbreviation */
export function parseTakeoutDate(text: string): number {
  const cleaned = text
    .replace(/[  ]/g, " ")
    .replace(/\s+(?:[A-Z]{2,5}|GMT|UTC)(?:[+-]\d{1,2}(?::?\d{2})?)?$/, "")
    .trim();
  return Date.parse(cleaned);
}

function fromJson(entries: WatchEntry[]): { plays: ImportedPlay[]; skipped: number } {
  const plays: ImportedPlay[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (entry.header !== "YouTube Music") continue;
    const videoId = entry.titleUrl?.match(VIDEO_ID)?.[1];
    const time = entry.time ? Date.parse(entry.time) : NaN;
    const title = entry.title ? stripWatched(entry.title) : "";
    const artist = cleanArtistName(entry.subtitles?.[0]?.name ?? "");
    if (!videoId || !title || !Number.isFinite(time)) {
      skipped++;
      continue;
    }
    plays.push({ playedAt: new Date(time).toISOString(), playedMs: 0, playCount: 1, title, artist: artist || "Unknown artist", videoId });
  }
  return { plays, skipped };
}

function fromHtml(html: string): { plays: ImportedPlay[]; skipped: number } {
  const plays: ImportedPlay[] = [];
  let skipped = 0;
  for (const cell of html.split(/class="outer-cell/).slice(1)) {
    const header = cell.match(/mdl-typography--title">([\s\S]*?)<br/)?.[1]?.trim();
    if (header !== "YouTube Music") continue;
    const body = cell.match(/content-cell[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const links = [...body.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)];
    const videoId = links[0]?.[1].match(VIDEO_ID)?.[1];
    const title = decodeEntities(links[0]?.[2] ?? "").trim();
    const artist = cleanArtistName(decodeEntities(links[1]?.[2] ?? "").trim());
    const parts = body.split("<br>").map((p) => decodeEntities(p.replace(/<[^>]+>/g, "")).trim()).filter(Boolean);
    const time = parseTakeoutDate(parts[parts.length - 1] ?? "");
    if (!videoId || !title || !Number.isFinite(time)) {
      skipped++;
      continue;
    }
    plays.push({ playedAt: new Date(time).toISOString(), playedMs: 0, playCount: 1, title, artist: artist || "Unknown artist", videoId });
  }
  return { plays, skipped };
}

/** a playlist file lists video ids; older exports put a few lines of details above the list */
export function videoIdsFromCsv(text: string): string[] {
  const rows = parseCsv(text);
  const headerRow = rows.findIndex((r) => /^video ?id$/i.test(r[0]?.trim() ?? ""));
  if (headerRow < 0) return [];
  return rows
    .slice(headerRow + 1)
    .map((r) => r[0]?.trim())
    .filter((id): id is string => !!id && /^[\w-]{11}$/.test(id));
}

function playlistName(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/\.csv$/i, "").replace(/-videos$/i, "").trim() || "YouTube playlist";
}

export async function parseTakeout(files: ExportFile[]): Promise<ParsedExport> {
  const out = emptyExport("youtube");
  out.hasListeningTime = false;
  let skipped = 0;

  const json = files.find((f) => isWatchJson(f.name));
  const html = files.find((f) => isWatchHtml(f.name));
  if (json) {
    const entries = await readJson<WatchEntry[]>(json);
    if (Array.isArray(entries)) {
      const result = fromJson(entries);
      out.plays.push(...result.plays);
      skipped += result.skipped;
    } else out.warnings.push("Couldn't read watch-history.json");
  } else if (html) {
    const result = fromHtml(await readText(html));
    out.plays.push(...result.plays);
    skipped += result.skipped;
  }
  if (skipped > 0) out.warnings.push(`${skipped.toLocaleString()} YouTube Music history entries had no song link or date and were left out.`);

  for (const file of files.filter((f) => isPlaylistCsv(f.name))) {
    const ids = videoIdsFromCsv(await readText(file));
    if (ids.length === 0) continue;
    const name = playlistName(file.name);
    const tracks = ids.map((videoId): SourceTrack => ({ title: "", artists: [], videoId }));
    const liked = /^liked music$/i.test(name);
    out.collections.push({ key: `youtube:playlist:${file.name}`, name, tracks, destination: liked ? { kind: "liked" } : { kind: "playlist", name } });
  }

  const library = files.find((f) => isMusicLibraryCsv(f.name));
  if (library) {
    const rows = csvObjects(parseCsv(await readText(library)));
    const tracks = rows
      .map((r): SourceTrack => ({
        title: pick(r, ["Song Title", "Title"]),
        artists: [pick(r, ["Artist Name 1", "Artist Names", "Artist"])].filter(Boolean),
        album: pick(r, ["Album Title", "Album"]) || undefined,
        videoId: pick(r, ["Video ID", "Video Id"]) || undefined,
      }))
      .filter((t) => t.title || t.videoId);
    if (tracks.length > 0) out.collections.push({ key: "youtube:library", name: "YouTube Music library", tracks, destination: { kind: "liked" } });
  }
  return out;
}
