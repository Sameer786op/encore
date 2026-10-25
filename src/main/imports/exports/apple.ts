import type { SourceTrack } from "@shared/types";
import { csvObjects, hasColumn, parseCsv, pick } from "./csv";
import { readJson, readText, type ExportFile } from "./files";
import { emptyExport, MIN_PLAY_MS, type ParsedExport } from "./types";

// Apple's privacy export (privacy.apple.com -> "Apple Media Services information").
// It arrives as zips inside a zip. Column names have changed between years, so
// every field is looked up under several names.
// - "Apple Music - Play History Daily Tracks.csv": one row per song per day, with "Artist - Title"
// - "Apple Music Play Activity.csv": one row per play event (older exports may lack the artist)
// - "Apple Music Library Tracks.json": the library, with titles, artists, albums and ids
// - "Apple Music Library Playlists.json": playlists, as lists of library track ids

const isDailyTracks = (name: string) => /Play History Daily Tracks\.csv$/i.test(name);
const isPlayActivity = (name: string) => /Apple Music Play Activity\.csv$/i.test(name);
const isLibraryTracks = (name: string) => /Apple Music Library Tracks\.json$/i.test(name);
const isLibraryPlaylists = (name: string) => /Apple Music Library Playlists\.json$/i.test(name);

export function looksLikeApple(files: ExportFile[]): boolean {
  return files.some((f) => isDailyTracks(f.name) || isPlayActivity(f.name) || isLibraryTracks(f.name) || isLibraryPlaylists(f.name));
}

type Json = Record<string, unknown>;

/** case-insensitive lookup across a few possible key names */
function field(obj: Json, names: string[]): unknown {
  const keys = Object.keys(obj);
  for (const name of names) {
    const key = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (key !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

interface LibraryTrack {
  id: string;
  source: SourceTrack;
  loved: boolean;
}

function libraryTrack(row: Json): LibraryTrack | null {
  const title = str(field(row, ["Title", "Name", "Song Name"]));
  const artist = str(field(row, ["Artist", "Artist Name", "Album Artist"]));
  if (!title) return null;
  const duration = Number(field(row, ["Track Duration", "Duration", "Track Duration In Milliseconds"]));
  const rating = str(field(row, ["Track Like Rating", "Like Rating", "Rating"])).toLowerCase();
  const loved = field(row, ["Loved", "Is Loved", "Favorite", "Favourite", "Is Favorite"]) === true || rating === "love" || rating === "liked";
  return {
    id: str(field(row, ["Track Identifier", "Track ID", "Catalog Identifier", "Identifier"])),
    source: { title, artists: artist ? [artist] : [], album: str(field(row, ["Album", "Album Name"])) || undefined, durationMs: duration > 0 ? duration : undefined },
    loved,
  };
}

/** "Artist - Title" as Apple writes it; titles may contain " - " too, artists rarely do */
function splitDescription(text: string): { artist: string; title: string } | null {
  const at = text.indexOf(" - ");
  if (at <= 0) return null;
  return { artist: text.slice(0, at).trim(), title: text.slice(at + 3).trim() };
}

/** "20240131" -> noon that day */
function dayToIso(day: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(day.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z` : null;
}

export async function parseApple(files: ExportFile[]): Promise<ParsedExport> {
  const out = emptyExport("apple");

  // library first: the play activity file may need it to fill in artists
  const libraryFile = files.find((f) => isLibraryTracks(f.name));
  const libraryRows = libraryFile ? await readJson<Json[]>(libraryFile) : null;
  const library = (Array.isArray(libraryRows) ? libraryRows : []).map(libraryTrack).filter((t): t is LibraryTrack => !!t);
  const artistByTitle = new Map(library.map((t) => [`${t.source.title.toLowerCase()}|${(t.source.album ?? "").toLowerCase()}`, t.source.artists[0] ?? ""]));

  const daily = files.find((f) => isDailyTracks(f.name));
  const activity = files.find((f) => isPlayActivity(f.name));
  if (daily) {
    for (const row of csvObjects(parseCsv(await readText(daily)))) {
      const described = splitDescription(pick(row, ["Track Description", "Track Name"]));
      const playedAt = dayToIso(pick(row, ["Date Played", "Date"]));
      const ms = Number(pick(row, ["Play Duration Milliseconds", "Play Duration"])) || 0;
      const count = Math.max(1, Number(pick(row, ["Play Count"])) || 1);
      if (!described || !playedAt || ms < MIN_PLAY_MS) continue;
      out.plays.push({ playedAt, playedMs: ms, playCount: count, title: described.title, artist: described.artist, externalId: pick(row, ["Track Identifier"]) || undefined });
    }
  } else if (activity) {
    const rows = csvObjects(parseCsv(await readText(activity)));
    const hasArtist = hasColumn(rows, ["Artist Name", "Container Artist Name", "Artist"]);
    let unknownArtist = 0;
    for (const row of rows) {
      const title = pick(row, ["Song Name", "Content Name", "Track Name", "Title"]);
      const ms = Number(pick(row, ["Play Duration Milliseconds", "Play Duration"])) || 0;
      const event = pick(row, ["Event Type"]);
      const time = Date.parse(pick(row, ["Event Start Timestamp", "Event Received Timestamp", "Event End Timestamp", "Play Date Time"]));
      if (!title || ms < MIN_PLAY_MS || !Number.isFinite(time) || (event && !/PLAY_END/i.test(event))) continue;
      const album = pick(row, ["Album Name", "Container Album Name"]);
      let artist = hasArtist ? pick(row, ["Artist Name", "Container Artist Name", "Artist"]) : "";
      if (!artist) artist = artistByTitle.get(`${title.toLowerCase()}|${album.toLowerCase()}`) ?? "";
      if (!artist) {
        unknownArtist++;
        artist = "Unknown artist";
      }
      out.plays.push({ playedAt: new Date(time).toISOString(), playedMs: ms, playCount: 1, title, artist, album: album || undefined });
    }
    if (unknownArtist > 0) out.warnings.push(`${unknownArtist.toLocaleString()} plays had no artist in Apple's file, so they're listed as "Unknown artist".`);
  }

  const loved = library.filter((t) => t.loved);
  if (loved.length > 0) {
    out.collections.push({ key: "apple:loved", name: "Loved songs", tracks: loved.map((t) => t.source), destination: { kind: "liked" } });
  }
  if (library.length > 0) {
    out.collections.push({
      key: "apple:library",
      name: "Apple Music library",
      tracks: library.map((t) => t.source),
      destination: loved.length > 0 ? { kind: "playlist", name: "Apple Music library" } : { kind: "liked" },
    });
  }

  const playlistsFile = files.find((f) => isLibraryPlaylists(f.name));
  const playlists = playlistsFile ? await readJson<Json[]>(playlistsFile) : null;
  const byId = new Map(library.filter((t) => t.id).map((t) => [t.id, t.source]));
  for (const [i, playlist] of (Array.isArray(playlists) ? playlists : []).entries()) {
    const name = str(field(playlist, ["Title", "Name", "Playlist Name"])) || `Apple Music playlist ${i + 1}`;
    const ids = field(playlist, ["Playlist Item Identifiers", "Item Identifiers", "Track Identifiers"]);
    const tracks = (Array.isArray(ids) ? ids : []).map((id) => byId.get(String(id))).filter((t): t is SourceTrack => !!t);
    if (tracks.length === 0) continue;
    out.collections.push({ key: `apple:playlist:${i}`, name, tracks, destination: { kind: "playlist", name } });
  }
  if (playlistsFile && library.length === 0) out.warnings.push("Apple's playlist file needs the library file next to it to know which songs are in each playlist.");
  return out;
}
