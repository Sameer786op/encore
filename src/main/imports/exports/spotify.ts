import type { SourceTrack } from "@shared/types";
import { readJson, type ExportFile } from "./files";
import { emptyExport, MIN_PLAY_MS, type ImportedPlay, type ParsedExport } from "./types";

// Spotify "Download your data" (privacy settings). Two flavours:
// - Account data: StreamingHistory_music_N.json (last year), YourLibrary.json, PlaylistN.json
// - Extended streaming history: Streaming_History_Audio_YYYY-YYYY_N.json (all time)

interface BasicPlay {
  endTime?: string;
  artistName?: string;
  trackName?: string;
  msPlayed?: number;
}

interface ExtendedPlay {
  ts?: string;
  ms_played?: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
}

interface LibraryFile {
  tracks?: { artist?: string; album?: string; track?: string; uri?: string }[];
}

interface PlaylistFile {
  playlists?: {
    name?: string;
    items?: { track?: { trackName?: string; artistName?: string; albumName?: string; trackUri?: string } | null }[];
  }[];
}

const isBasicHistory = (name: string) => /(^|\/)StreamingHistory(_music)?_?\d*\.json$/i.test(name);
const isExtendedHistory = (name: string) => /(^|\/)Streaming_History_Audio_[^/]*\.json$/i.test(name);
const isLibrary = (name: string) => /(^|\/)YourLibrary\.json$/i.test(name);
const isPlaylists = (name: string) => /(^|\/)Playlist\d*\.json$/i.test(name);

export function looksLikeSpotify(files: ExportFile[]): boolean {
  return files.some((f) => isBasicHistory(f.name) || isExtendedHistory(f.name) || isLibrary(f.name) || isPlaylists(f.name));
}

/** "2024-01-03 18:22" is UTC in Spotify's files */
function basicTime(endTime: string): number {
  return Date.parse(`${endTime.replace(" ", "T")}:00Z`);
}

export async function parseSpotify(files: ExportFile[]): Promise<ParsedExport> {
  const out = emptyExport("spotify");
  const extended = files.filter((f) => isExtendedHistory(f.name));
  // the extended history covers everything the basic one does; never count twice
  const historyFiles = extended.length > 0 ? extended : files.filter((f) => isBasicHistory(f.name));

  for (const file of historyFiles) {
    const rows = await readJson<(BasicPlay & ExtendedPlay)[]>(file);
    if (!Array.isArray(rows)) {
      out.warnings.push(`Couldn't read ${file.name}`);
      continue;
    }
    for (const row of rows) {
      const play = extended.length > 0 ? fromExtended(row) : fromBasic(row);
      if (play) out.plays.push(play);
    }
  }

  const library = files.find((f) => isLibrary(f.name));
  if (library) {
    const data = await readJson<LibraryFile>(library);
    const tracks = (data?.tracks ?? [])
      .filter((t) => t.track && t.artist)
      .map((t): SourceTrack => ({ title: t.track!, artists: [t.artist!], album: t.album || undefined, externalId: t.uri }));
    if (tracks.length > 0) out.collections.push({ key: "spotify:liked", name: "Liked Songs", tracks, destination: { kind: "liked" } });
  }

  for (const file of files.filter((f) => isPlaylists(f.name))) {
    const data = await readJson<PlaylistFile>(file);
    for (const [i, playlist] of (data?.playlists ?? []).entries()) {
      const tracks = (playlist.items ?? [])
        .map((item) => item.track)
        .filter((t): t is NonNullable<typeof t> => !!t?.trackName && !!t.artistName)
        .map((t): SourceTrack => ({ title: t.trackName!, artists: [t.artistName!], album: t.albumName || undefined, externalId: t.trackUri }));
      if (tracks.length === 0) continue;
      const name = playlist.name?.trim() || `Spotify playlist ${i + 1}`;
      out.collections.push({ key: `spotify:playlist:${file.name}:${i}`, name, tracks, destination: { kind: "playlist", name } });
    }
  }
  return out;
}

function fromBasic(row: BasicPlay): ImportedPlay | null {
  if (!row.trackName || !row.artistName || !row.endTime || (row.msPlayed ?? 0) < MIN_PLAY_MS) return null;
  const end = basicTime(row.endTime);
  if (!Number.isFinite(end)) return null;
  return { playedAt: new Date(end - row.msPlayed!).toISOString(), playedMs: row.msPlayed!, playCount: 1, title: row.trackName, artist: row.artistName };
}

function fromExtended(row: ExtendedPlay): ImportedPlay | null {
  const title = row.master_metadata_track_name;
  const artist = row.master_metadata_album_artist_name;
  // podcast episodes and audiobooks have no track name
  if (!title || !artist || !row.ts || (row.ms_played ?? 0) < MIN_PLAY_MS) return null;
  const end = Date.parse(row.ts);
  if (!Number.isFinite(end)) return null;
  return {
    playedAt: new Date(end - row.ms_played!).toISOString(),
    playedMs: row.ms_played!,
    playCount: 1,
    title,
    artist,
    album: row.master_metadata_album_album_name || undefined,
    externalId: row.spotify_track_uri || undefined,
  };
}
