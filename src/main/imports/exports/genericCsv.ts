import type { SourceTrack } from "@shared/types";
import { splitArtists } from "../../matching/text";
import { csvObjects, hasColumn, parseCsv, pick } from "./csv";
import { readText, type ExportFile } from "./files";
import { emptyExport, type ParsedExport } from "./types";

// Playlists saved as CSV by Exportify, TuneMyMusic, Soundiiz and similar tools.
// Any CSV with a title and an artist column works; a "playlist name" column
// splits one file into several playlists.

const TITLE = ["Track Name", "Track name", "Title", "Song", "Song Name", "Name", "Track"];
const ARTIST = ["Artist Name(s)", "Artist Name", "Artist name", "Artist", "Artists", "Artist(s)"];
const ALBUM = ["Album Name", "Album", "Album Title"];
const DURATION = ["Track Duration (ms)", "Duration (ms)", "duration_ms", "Duration"];
const PLAYLIST = ["Playlist name", "Playlist Name", "Playlist"];
const VIDEO = ["Video ID", "VideoId", "YouTube ID"];

function durationMs(value: string): number | undefined {
  if (!value) return undefined;
  if (/^\d+:\d{2}$/.test(value)) {
    const [m, s] = value.split(":").map(Number);
    return (m * 60 + s) * 1000;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // plain seconds are short numbers; milliseconds are big ones
  return n < 10_000 ? n * 1000 : n;
}

export async function parseGenericCsv(file: ExportFile): Promise<ParsedExport | null> {
  const rows = csvObjects(parseCsv(await readText(file)));
  if (!hasColumn(rows, TITLE) || !(hasColumn(rows, ARTIST) || hasColumn(rows, VIDEO))) return null;
  const spotify = hasColumn(rows, ["Track URI", "Spotify - id", "Spotify ID"]);
  const out = emptyExport(spotify ? "spotify" : "csv");
  const fileName = (file.name.split("/").pop() ?? "Imported playlist").replace(/\.csv$/i, "");

  const groups = new Map<string, SourceTrack[]>();
  for (const row of rows) {
    const title = pick(row, TITLE);
    const videoId = pick(row, VIDEO) || undefined;
    if (!title && !videoId) continue;
    const artistField = pick(row, ARTIST);
    // Exportify joins several artists with commas inside one field
    const artists = artistField.includes(",") ? artistField.split(",").map((a) => a.trim()).filter(Boolean) : splitArtists(artistField);
    const track: SourceTrack = {
      title,
      artists,
      album: pick(row, ALBUM) || undefined,
      durationMs: durationMs(pick(row, DURATION)),
      videoId: videoId && /^[\w-]{11}$/.test(videoId) ? videoId : undefined,
      externalId: pick(row, ["Track URI", "Spotify - id", "ISRC"]) || undefined,
    };
    const group = pick(row, PLAYLIST) || fileName;
    groups.set(group, [...(groups.get(group) ?? []), track]);
  }

  for (const [name, tracks] of groups) {
    const liked = /^(liked songs|liked|favorites|favourites|loved)$/i.test(name);
    out.collections.push({ key: `csv:${file.name}:${name}`, name, tracks, destination: liked ? { kind: "liked" } : { kind: "playlist", name } });
  }
  return out;
}
