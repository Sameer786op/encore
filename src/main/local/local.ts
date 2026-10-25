import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { access, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseFile } from "music-metadata";
import type { LocalScanState, Track } from "@shared/types";
import { MEDIA_SCHEME, trackId } from "@shared/types";

// Music files on this computer. Folders are scanned for audio files, their
// tags and cover art are read once, and the folders are watched so new
// downloads show up on their own.

/** what Chromium can decode */
export const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};
/** music files we recognise but can't play */
const UNPLAYABLE = new Set([".wma", ".aiff", ".aif", ".ape", ".wv", ".dsf", ".dff", ".alac"]);
const COVER_FILES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png", "album.jpg", "albumart.jpg"];
const RESCAN_DELAY_MS = 2_500;
const EMIT_EVERY_MS = 250;
const MAX_DEPTH = 12;

interface FileRow {
  id: string;
  path: string;
  size: number;
  mtime_ms: number;
}

const sha1 = (value: string | Uint8Array) => createHash("sha1").update(value).digest("hex");

/** true when `child` is `parent` or somewhere inside it */
function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
/** Windows paths are case-insensitive, so the id is too */
export const localId = (path: string) => sha1(process.platform === "win32" ? path.toLowerCase() : path);

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export class LocalLibrary {
  private state: LocalScanState = { folders: [], scanning: false, found: 0, processed: 0, tracks: 0, unsupported: 0 };
  private listeners = new Set<(state: LocalScanState) => void>();
  private watchers = new Map<string, FSWatcher>();
  private rescanTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scanChain: Promise<void> = Promise.resolve();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly artworkDir: string,
  ) {
    this.state.folders = this.folders();
    this.state.tracks = this.count();
  }

  folders(): string[] {
    return (this.db.prepare("SELECT path FROM local_folders ORDER BY added_at").all() as unknown as { path: string }[]).map((r) => r.path);
  }

  private count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM local_files").get() as { n: number }).n;
  }

  getState(): LocalScanState {
    return { ...this.state, folders: this.folders(), tracks: this.count() };
  }

  onState(listener: (state: LocalScanState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(now = false): void {
    if (this.disposed) return;
    const send = () => {
      this.emitTimer = null;
      const state = this.getState();
      for (const l of this.listeners) l(state);
    };
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      send();
    } else if (!this.emitTimer) this.emitTimer = setTimeout(send, EMIT_EVERY_MS);
  }

  tracks(): Track[] {
    return (this.db.prepare("SELECT track FROM local_files").all() as unknown as { track: string }[]).map((r) => JSON.parse(r.track) as Track);
  }

  /** the file behind a track id, only for files we indexed */
  pathOf(id: string): string | null {
    const row = this.db.prepare("SELECT path FROM local_files WHERE id = ?").get(id) as { path: string } | undefined;
    return row?.path ?? null;
  }

  /** watch every folder and catch up on changes made while the app was closed */
  start(): void {
    for (const folder of this.folders()) this.watchFolder(folder);
    if (this.folders().length > 0) void this.rescan();
  }

  async addFolder(path: string): Promise<void> {
    if (this.folders().some((f) => isWithin(path, f))) return;
    // a parent folder replaces the folders inside it
    for (const inner of this.folders().filter((f) => isWithin(f, path))) this.removeFolder(inner);
    this.db.prepare("INSERT OR IGNORE INTO local_folders (path, added_at) VALUES (?, ?)").run(path, new Date().toISOString());
    this.watchFolder(path);
    this.emit(true);
    await this.queueScan(path);
  }

  removeFolder(path: string): void {
    this.watchers.get(path)?.close();
    this.watchers.delete(path);
    this.db.prepare("DELETE FROM local_files WHERE folder = ?").run(path);
    this.db.prepare("DELETE FROM local_folders WHERE path = ?").run(path);
    this.emit(true);
  }

  rescan(): Promise<void> {
    return Promise.all(this.folders().map((f) => this.queueScan(f))).then(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const t of this.rescanTimers.values()) clearTimeout(t);
    if (this.emitTimer) clearTimeout(this.emitTimer);
  }

  private watchFolder(folder: string): void {
    if (this.watchers.has(folder)) return;
    try {
      const watcher = watch(folder, { recursive: true }, (_event, file) => {
        if (file && !(extname(file).toLowerCase() in AUDIO_TYPES) && extname(file) !== "") return;
        clearTimeout(this.rescanTimers.get(folder));
        this.rescanTimers.set(
          folder,
          setTimeout(() => void this.queueScan(folder), RESCAN_DELAY_MS),
        );
      });
      watcher.on("error", () => this.watchers.delete(folder));
      this.watchers.set(folder, watcher);
    } catch {
      // the folder may be on a drive that isn't connected; scanning will say so
    }
  }

  /** scans run one at a time so they never fight over the same rows */
  private queueScan(folder: string): Promise<void> {
    this.scanChain = this.scanChain.then(() => this.scan(folder)).catch(() => undefined);
    return this.scanChain;
  }

  private async listAudio(folder: string): Promise<{ files: string[]; unsupported: number }> {
    const files: string[] = [];
    let unsupported = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (ext in AUDIO_TYPES) files.push(full);
          else if (UNPLAYABLE.has(ext)) unsupported++;
        }
      }
    };
    await walk(folder, 0);
    return { files, unsupported };
  }

  private async scan(folder: string): Promise<void> {
    if (this.disposed || !this.folders().includes(folder)) return;
    this.state.scanning = true;
    this.state.found = 0;
    this.state.processed = 0;
    this.emit(true);

    const { files, unsupported } = await this.listAudio(folder);
    this.state.found = files.length;
    this.state.unsupported = unsupported;
    const known = new Map(
      (this.db.prepare("SELECT id, path, size, mtime_ms FROM local_files WHERE folder = ?").all(folder) as unknown as FileRow[]).map((r) => [r.path, r]),
    );
    const seen = new Set<string>();
    const upsert = this.db.prepare(
      `INSERT INTO local_files (id, path, folder, size, mtime_ms, track, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET path = excluded.path, size = excluded.size, mtime_ms = excluded.mtime_ms, track = excluded.track`,
    );

    for (const path of files) {
      if (this.disposed) return;
      seen.add(path);
      try {
        const info = await stat(path);
        const row = known.get(path);
        if (!row || row.size !== info.size || Math.round(row.mtime_ms) !== Math.round(info.mtimeMs)) {
          const track = await this.readTrack(path);
          if (track) upsert.run(track.sourceId, path, folder, info.size, Math.round(info.mtimeMs), JSON.stringify(track), new Date().toISOString());
          else this.state.unsupported++;
        }
      } catch {
        // unreadable or vanished mid-scan; leave it out this time
      }
      this.state.processed++;
      this.emit();
    }

    // files that were deleted or moved away
    const remove = this.db.prepare("DELETE FROM local_files WHERE id = ?");
    for (const [path, row] of known) if (!seen.has(path)) remove.run(row.id);

    this.state.scanning = false;
    this.emit(true);
  }

  private async readTrack(path: string): Promise<Track | null> {
    const meta = await parseFile(path, { duration: true, skipCovers: false });
    const codec = (meta.format.codec ?? "").toUpperCase();
    // Apple Lossless in .m4a looks playable but Chromium can't decode it
    if (codec.includes("ALAC")) return null;
    const { common } = meta;
    const id = localId(path);
    const artists = (common.artists?.length ? common.artists : common.artist ? [common.artist] : common.albumartist ? [common.albumartist] : [])
      .map((name) => ({ name: name.trim() }))
      .filter((a) => a.name);
    return {
      id: trackId("local", id),
      source: "local",
      sourceId: id,
      title: common.title?.trim() || basename(path, extname(path)),
      artists: artists.length > 0 ? artists : [{ name: "Unknown artist" }],
      album: common.album ? { title: common.album } : undefined,
      durationMs: Math.round((meta.format.duration ?? 0) * 1000),
      artwork: await this.artworkFor(path, common.picture?.[0]),
      gainDb: typeof common.replaygain_track_gain?.dB === "number" ? common.replaygain_track_gain.dB : undefined,
    };
  }

  /** embedded cover first, then a cover image in the same folder; saved once by content hash */
  private async artworkFor(path: string, picture?: { data: Uint8Array; format: string }): Promise<string | undefined> {
    await mkdir(this.artworkDir, { recursive: true });
    if (picture?.data?.length) {
      const ext = /png/i.test(picture.format) ? "png" : /webp/i.test(picture.format) ? "webp" : "jpg";
      const name = `${sha1(picture.data)}.${ext}`;
      const target = join(this.artworkDir, name);
      if (!(await exists(target))) await writeFile(target, picture.data);
      return `${MEDIA_SCHEME}://art/${name}`;
    }
    for (const candidate of COVER_FILES) {
      const cover = join(dirname(path), candidate);
      if (!(await exists(cover))) continue;
      const info = await stat(cover);
      const name = `${sha1(`${cover}|${info.mtimeMs}|${info.size}`)}${extname(cover).toLowerCase() === ".png" ? ".png" : ".jpg"}`;
      const target = join(this.artworkDir, name);
      if (!(await exists(target))) await copyFile(cover, target);
      return `${MEDIA_SCHEME}://art/${name}`;
    }
    return undefined;
  }
}
