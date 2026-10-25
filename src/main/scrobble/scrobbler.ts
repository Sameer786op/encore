import type { DatabaseSync } from "node:sqlite";
import type { ScrobbleService, ScrobbleStatus, Track } from "@shared/types";
import { cleanArtistName, splitArtists } from "../matching/text";
import { getSetting, setSetting } from "../settings";
import { AuthError, TemporaryError, type Lastfm, type LastfmKeys, type ListenBrainz, type Scrobble } from "./clients";

// Sends what you listen to to Last.fm and ListenBrainz. Listens wait in a
// queue in the database, so nothing is lost while offline; failed sends are
// retried later. Keys and tokens are stored encrypted.

export interface Vault {
  encrypt(text: string): string;
  decrypt(text: string): string;
}

const BATCH = 50;
const RETRY_MINUTES = [1, 5, 30, 120, 360];
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
/** Last.fm: "this token has not been authorised" (yet) */
const NOT_APPROVED_YET = 14;

interface Stored {
  listenbrainz?: { token: string; user: string };
  lastfm?: { apiKey: string; secret: string; session?: { name: string; key: string } };
}

export function toScrobble(track: Track, startedAt: number): Scrobble {
  const artists = track.artists.map((a) => cleanArtistName(a.name)).filter(Boolean);
  return {
    artist: splitArtists(artists[0] ?? "Unknown artist")[0] ?? "Unknown artist",
    artists: artists.join(", ") || "Unknown artist",
    track: track.title,
    album: track.album?.title,
    durationMs: track.durationMs || undefined,
    timestamp: Math.floor(startedAt / 1000),
    url: track.source === "youtube" ? `https://music.youtube.com/watch?v=${track.sourceId}` : undefined,
  };
}

export class Scrobbler {
  private listeners = new Set<(status: ScrobbleStatus) => void>();
  private errors: Partial<Record<ScrobbleService, string>> = {};
  private pending = false;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private approval: { cancelled: boolean } | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly services: { lastfm: Lastfm; listenbrainz: ListenBrainz },
    private readonly vault: Vault,
    private readonly openExternal: (url: string) => void,
    private readonly approvalPollMs = 3_000,
  ) {}

  // ---- stored credentials ----

  private stored(): Stored {
    const raw = getSetting(this.db, "scrobble.credentials");
    if (!raw) return {};
    try {
      return JSON.parse(this.vault.decrypt(raw)) as Stored;
    } catch {
      return {};
    }
  }

  private store(value: Stored): void {
    setSetting(this.db, "scrobble.credentials", this.vault.encrypt(JSON.stringify(value)));
  }

  // ---- status ----

  status(): ScrobbleStatus {
    const s = this.stored();
    const queued = (this.db.prepare("SELECT COUNT(*) AS n FROM scrobble_queue").get() as { n: number }).n;
    return {
      lastfm: {
        connected: !!s.lastfm?.session,
        user: s.lastfm?.session?.name,
        hasApiKey: !!s.lastfm?.apiKey,
        pending: this.pending,
        error: this.errors.lastfm,
      },
      listenbrainz: { connected: !!s.listenbrainz, user: s.listenbrainz?.user, error: this.errors.listenbrainz },
      queued,
    };
  }

  onStatus(listener: (status: ScrobbleStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const status = this.status();
    for (const l of this.listeners) l(status);
  }

  // ---- connecting ----

  async connectListenBrainz(token: string): Promise<ScrobbleStatus> {
    const user = await this.services.listenbrainz.validate(token.trim());
    this.store({ ...this.stored(), listenbrainz: { token: token.trim(), user } });
    delete this.errors.listenbrainz;
    this.changed();
    return this.status();
  }

  /** opens Last.fm in the browser; the status turns connected once you approve */
  async connectLastfm(apiKey: string, secret: string): Promise<ScrobbleStatus> {
    const keys: LastfmKeys = { apiKey: apiKey.trim(), secret: secret.trim() };
    const token = await this.services.lastfm.getToken(keys);
    this.store({ ...this.stored(), lastfm: { ...keys } });
    delete this.errors.lastfm;
    this.openExternal(this.services.lastfm.authUrl(keys, token));
    this.pending = true;
    this.changed();
    void this.waitForApproval(keys, token);
    return this.status();
  }

  private async waitForApproval(keys: LastfmKeys, token: string): Promise<void> {
    if (this.approval) this.approval.cancelled = true;
    const attempt = { cancelled: false };
    this.approval = attempt;
    const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
    while (!attempt.cancelled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.approvalPollMs));
      if (attempt.cancelled) return;
      try {
        const session = await this.services.lastfm.getSession(keys, token);
        const stored = this.stored();
        this.store({ ...stored, lastfm: { ...keys, session } });
        this.pending = false;
        this.changed();
        void this.flush();
        return;
      } catch (error) {
        // "not approved yet" keeps us waiting; anything else from Last.fm ends it
        if (error instanceof AuthError && error.code !== NOT_APPROVED_YET) {
          this.errors.lastfm = error.message;
          break;
        }
      }
    }
    if (!attempt.cancelled) {
      this.pending = false;
      this.errors.lastfm ??= "Encore wasn't approved on Last.fm in time. Try connecting again.";
      this.changed();
    }
  }

  disconnect(service: ScrobbleService): ScrobbleStatus {
    const stored = this.stored();
    if (service === "lastfm") {
      if (this.approval) this.approval.cancelled = true;
      this.pending = false;
      delete stored.lastfm;
    } else delete stored.listenbrainz;
    this.store(stored);
    delete this.errors[service];
    this.db.prepare("DELETE FROM scrobble_queue WHERE service = ?").run(service);
    this.changed();
    return this.status();
  }

  // ---- listening ----

  private connected(): ScrobbleService[] {
    const s = this.stored();
    return [...(s.lastfm?.session ? (["lastfm"] as const) : []), ...(s.listenbrainz ? (["listenbrainz"] as const) : [])];
  }

  /** "now playing" is best effort: never queued, never retried */
  nowPlaying(track: Track): void {
    const s = this.stored();
    const scrobble = toScrobble(track, Date.now());
    if (s.lastfm?.session) void this.services.lastfm.nowPlaying(s.lastfm, s.lastfm.session.key, scrobble).catch((e) => this.noteError("lastfm", e));
    if (s.listenbrainz) void this.services.listenbrainz.submit(s.listenbrainz.token, "playing_now", [scrobble]).catch((e) => this.noteError("listenbrainz", e));
  }

  played(track: Track, startedAt: number): void {
    const services = this.connected();
    if (services.length === 0) return;
    const data = JSON.stringify(toScrobble(track, startedAt));
    const now = new Date().toISOString();
    const insert = this.db.prepare("INSERT INTO scrobble_queue (service, data, created_at, next_try_at) VALUES (?, ?, ?, ?)");
    for (const service of services) insert.run(service, data, now, now);
    this.changed();
    void this.flush();
  }

  private noteError(service: ScrobbleService, error: unknown): void {
    if (error instanceof AuthError) {
      this.errors[service] = error.message;
      this.changed();
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), 2 * 60_000);
    void this.flush();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.approval) this.approval.cancelled = true;
  }

  /** send whatever is due, a batch per service */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const stored = this.stored();
    for (const service of this.connected()) {
      if (this.errors[service]) continue;
      const rows = this.db
        .prepare("SELECT id, data, attempts FROM scrobble_queue WHERE service = ? AND next_try_at <= ? ORDER BY id LIMIT ?")
        .all(service, new Date().toISOString(), BATCH) as unknown as { id: number; data: string; attempts: number }[];
      if (rows.length === 0) continue;
      const scrobbles = rows.map((r) => JSON.parse(r.data) as Scrobble);
      try {
        if (service === "lastfm") await this.services.lastfm.scrobble(stored.lastfm!, stored.lastfm!.session!.key, scrobbles);
        else await this.services.listenbrainz.submit(stored.listenbrainz!.token, rows.length > 1 ? "import" : "single", scrobbles);
        const remove = this.db.prepare("DELETE FROM scrobble_queue WHERE id = ?");
        for (const r of rows) remove.run(r.id);
      } catch (error) {
        if (error instanceof AuthError) {
          this.noteError(service, error);
        } else if (error instanceof TemporaryError || error instanceof TypeError || (error as Error)?.name === "TimeoutError") {
          // offline or the service is busy: try again later
          const update = this.db.prepare("UPDATE scrobble_queue SET attempts = attempts + 1, next_try_at = ? WHERE id = ?");
          for (const r of rows) {
            const minutes = RETRY_MINUTES[Math.min(r.attempts, RETRY_MINUTES.length - 1)];
            update.run(new Date(Date.now() + minutes * 60_000).toISOString(), r.id);
          }
        } else {
          // the service rejected these listens outright; drop them rather than retrying forever
          const remove = this.db.prepare("DELETE FROM scrobble_queue WHERE id = ?");
          for (const r of rows) remove.run(r.id);
        }
      }
    }
    this.changed();
  }
}
