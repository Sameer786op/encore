import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ImportDestination,
  ImportItem,
  ImportItemStatus,
  ImportJob,
  ImportJobDetails,
  ImportJobStatus,
  ImportOrigin,
  MatchCandidate,
  SourceTrack,
  Track,
} from "@shared/types";
import { transaction } from "../db";
import type { Library } from "../library/library";
import { Matcher } from "../matching/matcher";
import { classify } from "../matching/score";

// Import jobs live in the database so a half-matched import survives a
// restart. A few workers match songs in the background; the user reviews
// the result and then it becomes a playlist or goes into Liked Songs.

const STATUSES: ImportItemStatus[] = ["pending", "matched", "review", "missing", "accepted", "skipped"];
const CONCURRENCY = 3;
const PAUSE_BETWEEN_MS = 120;
const EMIT_EVERY_MS = 300;

interface JobRow {
  id: string;
  name: string;
  origin: ImportOrigin;
  destination: string;
  status: ImportJobStatus;
  note: string | null;
  result_playlist_id: string | null;
  created_at: string;
}

interface ItemRow {
  idx: number;
  source: string;
  status: ImportItemStatus;
  candidates: string;
  chosen: string | null;
}

export interface NewJob {
  name: string;
  origin: ImportOrigin;
  destination: ImportDestination;
  tracks: SourceTrack[];
  note?: string;
}

export class ImportManager {
  private queue: { jobId: string; index: number }[] = [];
  private workers = 0;
  private listeners = new Set<(jobs: ImportJob[]) => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly library: Library,
    readonly matcher: Matcher,
    private readonly concurrency = CONCURRENCY,
  ) {}

  onChange(listener: (jobs: ImportJob[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** stop matching before the database closes */
  dispose(): void {
    this.stopped = true;
    this.queue = [];
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.listeners.clear();
  }

  private emitSoon(): void {
    if (this.emitTimer || this.stopped) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      const jobs = this.list();
      for (const listener of this.listeners) listener(jobs);
    }, EMIT_EVERY_MS);
  }

  /** pick up imports that were still matching when the app closed */
  resume(): void {
    const pending = this.db
      .prepare(
        `SELECT i.job_id, i.idx FROM import_items i JOIN import_jobs j ON j.id = i.job_id
         WHERE j.status = 'matching' AND i.status = 'pending' ORDER BY j.created_at, i.idx`,
      )
      .all() as unknown as { job_id: string; idx: number }[];
    this.queue.push(...pending.map((r) => ({ jobId: r.job_id, index: r.idx })));
    for (const job of this.list().filter((j) => j.status === "matching")) this.finishMatchingIfDone(job.id);
    this.pump();
  }

  create(job: NewJob): ImportJob {
    const id = randomUUID();
    transaction(this.db, () => {
      this.db
        .prepare("INSERT INTO import_jobs (id, name, origin, destination, status, note, created_at) VALUES (?, ?, ?, ?, 'matching', ?, ?)")
        .run(id, job.name, job.origin, JSON.stringify(job.destination), job.note ?? null, new Date().toISOString());
      const insert = this.db.prepare("INSERT INTO import_items (job_id, idx, source, status, candidates) VALUES (?, ?, ?, ?, ?)");
      job.tracks.forEach((source, index) => {
        // songs that come with their YouTube Music track need no matching
        const ready = source.track ? ([{ track: source.track, score: 1 }] satisfies MatchCandidate[]) : null;
        insert.run(id, index, JSON.stringify(source), ready ? "matched" : "pending", JSON.stringify(ready ?? []));
        if (!ready) this.queue.push({ jobId: id, index });
      });
    });
    this.finishMatchingIfDone(id);
    this.pump();
    this.emitSoon();
    return this.job(id)!;
  }

  private pump(): void {
    while (this.workers < this.concurrency && this.queue.length > 0) {
      this.workers++;
      void this.work().finally(() => {
        this.workers--;
        this.pump();
      });
    }
  }

  private async work(): Promise<void> {
    while (this.queue.length > 0 && !this.stopped) {
      const next = this.queue.shift()!;
      await this.matchItem(next.jobId, next.index);
      await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
    }
  }

  private async matchItem(jobId: string, index: number): Promise<void> {
    if (this.stopped) return;
    const row = this.db.prepare("SELECT source, status FROM import_items WHERE job_id = ? AND idx = ?").get(jobId, index) as
      | { source: string; status: ImportItemStatus }
      | undefined;
    if (!row || row.status !== "pending") return;
    const source = JSON.parse(row.source) as SourceTrack;

    let candidates: MatchCandidate[] = [];
    let status: ImportItemStatus;
    try {
      candidates = await this.matcher.candidates(source);
      status = source.videoId && candidates.length > 0 ? "matched" : classify(source, candidates[0]);
    } catch {
      status = "missing";
    }

    // the app is closing, or the job was deleted while we were searching
    if (this.stopped || !this.db.prepare("SELECT 1 FROM import_jobs WHERE id = ?").get(jobId)) return;

    // Takeout playlists only know the video id; show the real name once we have it
    const shown: SourceTrack =
      source.videoId && !source.title && candidates[0]
        ? { ...source, title: candidates[0].track.title, artists: candidates[0].track.artists.map((a) => a.name), durationMs: candidates[0].track.durationMs }
        : source;
    this.db
      .prepare("UPDATE import_items SET status = ?, candidates = ?, source = ? WHERE job_id = ? AND idx = ? AND status = 'pending'")
      .run(status, JSON.stringify(candidates), JSON.stringify(shown), jobId, index);
    this.finishMatchingIfDone(jobId);
    this.emitSoon();
  }

  private finishMatchingIfDone(jobId: string): void {
    const pending = this.db.prepare("SELECT COUNT(*) AS n FROM import_items WHERE job_id = ? AND status = 'pending'").get(jobId) as { n: number };
    if (pending.n === 0) this.db.prepare("UPDATE import_jobs SET status = 'review' WHERE id = ? AND status = 'matching'").run(jobId);
  }

  private toJob(row: JobRow): ImportJob {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ImportItemStatus, number>;
    const rows = this.db.prepare("SELECT status, COUNT(*) AS n FROM import_items WHERE job_id = ? GROUP BY status").all(row.id) as unknown as {
      status: ImportItemStatus;
      n: number;
    }[];
    for (const r of rows) counts[r.status] = r.n;
    return {
      id: row.id,
      name: row.name,
      origin: row.origin,
      destination: JSON.parse(row.destination) as ImportDestination,
      status: row.status,
      createdAt: row.created_at,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      counts,
      note: row.note ?? undefined,
      resultPlaylistId: row.result_playlist_id ?? undefined,
    };
  }

  private job(id: string): ImportJob | null {
    const row = this.db.prepare("SELECT * FROM import_jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? this.toJob(row) : null;
  }

  list(): ImportJob[] {
    return (this.db.prepare("SELECT * FROM import_jobs ORDER BY created_at DESC").all() as unknown as JobRow[]).map((r) => this.toJob(r));
  }

  get(id: string): ImportJobDetails {
    const job = this.job(id);
    if (!job) throw new Error("This import no longer exists");
    const items = (this.db.prepare("SELECT idx, source, status, candidates, chosen FROM import_items WHERE job_id = ? ORDER BY idx").all(id) as unknown as ItemRow[]).map(
      (r): ImportItem => ({
        index: r.idx,
        source: JSON.parse(r.source),
        status: r.status,
        candidates: JSON.parse(r.candidates),
        chosen: r.chosen ? JSON.parse(r.chosen) : undefined,
      }),
    );
    return { ...job, items };
  }

  choose(jobId: string, index: number, track: Track | null): void {
    this.db
      .prepare("UPDATE import_items SET status = ?, chosen = ? WHERE job_id = ? AND idx = ? AND status != 'pending'")
      .run(track ? "accepted" : "skipped", track ? JSON.stringify(track) : null, jobId, index);
    this.emitSoon();
  }

  /** take the best guess for everything waiting for a look */
  acceptSuggestions(jobId: string): number {
    const result = this.db
      .prepare("UPDATE import_items SET status = 'accepted' WHERE job_id = ? AND status = 'review' AND candidates != '[]'")
      .run(jobId);
    this.emitSoon();
    return Number(result.changes);
  }

  finish(jobId: string): ImportJob {
    const details = this.get(jobId);
    if (details.status === "done") return details;
    const tracks = details.items
      .filter((i) => i.status === "matched" || i.status === "accepted")
      .map((i) => i.chosen ?? i.candidates[0]?.track)
      .filter((t): t is Track => !!t);

    let resultPlaylistId: string | null = null;
    if (details.destination.kind === "liked") this.library.likeMany(tracks);
    else resultPlaylistId = this.library.createPlaylist(details.destination.name, tracks).id;

    this.db.prepare("UPDATE import_jobs SET status = 'done', result_playlist_id = ? WHERE id = ?").run(resultPlaylistId, jobId);
    this.emitSoon();
    return this.job(jobId)!;
  }

  remove(jobId: string): void {
    this.queue = this.queue.filter((q) => q.jobId !== jobId);
    this.db.prepare("DELETE FROM import_jobs WHERE id = ?").run(jobId);
    this.emitSoon();
  }
}
