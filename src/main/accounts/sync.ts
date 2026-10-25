import type { DatabaseSync } from "node:sqlite";
import type { AccountService, AccountStatus, MatchCandidate, SourceTrack, SyncedPlaylistInfo, Track } from "@shared/types";
import { ACCOUNT_NAMES, ACCOUNT_SERVICES } from "@shared/types";
import { transaction } from "../db";
import type { Library, MirroredSong } from "../library/library";
import { classify } from "../matching/score";
import { fold } from "../matching/text";
import { getSetting, mapLimit, setSetting } from "../settings";
import { SignedOutError, sleep, type AccountAuth, type AccountProvider, type RemoteArtist, type RemotePlaylist, type RemoteSong } from "./provider";

// Keeps playlists from connected accounts in Your Library. Every playlist is
// mirrored unless switched off, including ones made later; songs are matched to
// YouTube Music once (the matcher remembers), so later syncs only look up new ones.

export const SYNC_EVERY_MS = 15 * 60_000;
const FIRST_SYNC_AFTER_MS = 8_000;
const MATCH_AT_ONCE = 3;
// a short breath between YouTube Music searches, like imports take
const PAUSE_AFTER_SEARCH_MS = 120;
// a playlist seen for the first time shows up in pieces while its songs are found
const SHOW_EVERY = 100;
// following artists looks each name up on YouTube Music; a few per sync, the rest next time
const ARTIST_LOOKUPS_PER_SYNC = 30;

export interface AccountSyncDeps {
  db: DatabaseSync;
  library: Library;
  matcher: {
    candidates(source: SourceTrack): Promise<MatchCandidate[]>;
    cachedCandidates(source: SourceTrack): MatchCandidate[] | null;
  };
  providers: Record<AccountService, AccountProvider>;
  auth: Record<AccountService, AccountAuth>;
  /** follow artists in Vyse Music so their new releases show up; returns the names it dealt with */
  follow?(artists: RemoteArtist[], lookups: number): Promise<string[]>;
}

interface AccountRow {
  service: AccountService;
  name: string | null;
  last_sync: string | null;
  last_error: string | null;
  signed_out: number;
}

interface PlaylistRow {
  remote_id: string;
  name: string;
  liked: number;
  enabled: number;
  playlist_id: string | null;
  version: string | null;
  songs: number;
  missing: number;
}

type Live = Pick<AccountStatus, "state" | "progress" | "error" | "signIn">;

/** songs couldn't be looked up on YouTube Music, so nothing was changed */
class MatchError extends Error {}

export class AccountSync {
  private live = new Map<AccountService, Live>();
  private running = new Map<AccountService, Promise<void>>();
  // bumped to stop a sync that's under way, e.g. on disconnecting
  private generation = new Map<AccountService, number>();
  private listeners = new Set<(accounts: AccountStatus[]) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;

  constructor(private readonly deps: AccountSyncDeps) {}

  private get db(): DatabaseSync {
    return this.deps.db;
  }

  onChange(listener: (accounts: AccountStatus[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const accounts = this.list();
    for (const listener of this.listeners) listener(accounts);
  }

  private setLive(service: AccountService, live: Live | undefined): void {
    if (live) this.live.set(service, live);
    else this.live.delete(service);
    this.emit();
  }

  private account(service: AccountService): AccountRow | undefined {
    return this.db.prepare("SELECT service, name, last_sync, last_error, signed_out FROM accounts WHERE service = ?").get(service) as AccountRow | undefined;
  }

  private rows(service: AccountService): PlaylistRow[] {
    return this.db
      .prepare("SELECT remote_id, name, liked, enabled, playlist_id, version, songs, missing FROM synced_playlists WHERE service = ? ORDER BY position")
      .all(service) as unknown as PlaylistRow[];
  }

  list(): AccountStatus[] {
    return ACCOUNT_SERVICES.map((service): AccountStatus => {
      const row = this.account(service);
      const live = this.live.get(service);
      const playlists = row
        ? this.rows(service).map(
            (r): SyncedPlaylistInfo => ({
              remoteId: r.remote_id,
              name: mirrorName(service, r),
              liked: r.liked === 1,
              enabled: r.enabled === 1,
              ...(r.playlist_id ? { playlistId: r.playlist_id } : {}),
              songs: r.songs,
              missing: r.missing,
            }),
          )
        : [];
      const saved: AccountStatus["state"] = row?.signed_out ? "signed-out" : row?.last_error ? "error" : "idle";
      return {
        service,
        connected: !!row,
        ...(row?.name ? { name: row.name } : {}),
        state: live?.state ?? saved,
        ...(live?.progress ? { progress: live.progress } : {}),
        ...(live?.signIn ? { signIn: live.signIn } : {}),
        ...(row?.last_sync ? { lastSync: row.last_sync } : {}),
        ...((live ? live.error : row?.last_error) ? { error: live ? live.error : row!.last_error! } : {}),
        playlists,
      };
    });
  }

  // ---- connecting ----

  /** the person signs in on the service's own page; then the first sync starts */
  async connect(service: AccountService): Promise<boolean> {
    if (this.live.get(service)?.state === "connecting") return false;
    this.cancel(service);
    this.setLive(service, { state: "connecting" });
    const name = ACCOUNT_NAMES[service];
    try {
      // always start from a clean sign-in, so an old one that stopped working doesn't get in the way
      await this.deps.auth[service].signOut();
      // a sign-in finished in the browser has a code to enter there; Settings shows it meanwhile
      const signedIn = await this.deps.auth[service].signIn((code) => {
        if (this.live.get(service)?.state === "connecting") this.setLive(service, { state: "connecting", signIn: code });
      });
      if (!signedIn) {
        this.setLive(service, undefined);
        return false;
      }
      const who = await this.deps.providers[service].whoAmI();
      this.db
        .prepare(
          `INSERT INTO accounts (service, name, connected_at) VALUES (?, ?, ?)
           ON CONFLICT(service) DO UPDATE SET name = COALESCE(excluded.name, accounts.name), last_error = NULL, signed_out = 0`,
        )
        .run(service, who.name ?? null, new Date().toISOString());
      this.setLive(service, undefined);
      void this.sync(service);
      return true;
    } catch (error) {
      this.setLive(service, {
        state: "error",
        error: error instanceof SignedOutError ? `Vyse Music couldn't read your ${name} account. Try connecting again.` : `Couldn't reach ${name}. Check your connection and try again.`,
      });
      return false;
    }
  }

  /** stop waiting for a sign-in that's under way */
  cancelConnect(service: AccountService): void {
    if (this.live.get(service)?.state === "connecting") this.deps.auth[service].cancel?.();
  }

  /** show the sign-in page again, for when it was closed or got lost behind other windows */
  reopenSignIn(service: AccountService): void {
    if (this.live.get(service)?.state === "connecting") this.deps.auth[service].reopen?.();
  }

  /** sign out; the mirrored playlists go too, unless kept as ordinary playlists */
  async disconnect(service: AccountService, keepPlaylists: boolean): Promise<void> {
    this.cancel(service);
    await this.deps.auth[service].signOut().catch(() => undefined);
    const mirrors = this.rows(service)
      .map((r) => r.playlist_id)
      .filter((id): id is string => !!id);
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM synced_playlists WHERE service = ?").run(service);
      this.db.prepare("DELETE FROM accounts WHERE service = ?").run(service);
    });
    setSetting(this.db, artistsKey(service), null);
    if (keepPlaylists) this.deps.library.refresh();
    else this.deps.library.deletePlaylists(mirrors);
    this.setLive(service, undefined);
  }

  /** switch one playlist's sync on or off; off removes its copy from Your Library */
  setPlaylistEnabled(service: AccountService, remoteId: string, enabled: boolean): void {
    const row = this.db.prepare("SELECT playlist_id FROM synced_playlists WHERE service = ? AND remote_id = ?").get(service, remoteId) as
      | { playlist_id: string | null }
      | undefined;
    if (!row) return;
    this.db.prepare("UPDATE synced_playlists SET enabled = ? WHERE service = ? AND remote_id = ?").run(enabled ? 1 : 0, service, remoteId);
    if (!enabled && row.playlist_id) this.deps.library.deletePlaylists([row.playlist_id]);
    this.emit();
    if (enabled) void this.sync(service);
  }

  private cancel(service: AccountService): void {
    this.generation.set(service, (this.generation.get(service) ?? 0) + 1);
    this.running.delete(service);
  }

  // ---- syncing ----

  start(): void {
    this.timers.push(setTimeout(() => this.syncAll(), FIRST_SYNC_AFTER_MS));
    this.timers.push(setInterval(() => this.syncAll(), SYNC_EVERY_MS));
  }

  dispose(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** every connected account that still has a working sign-in */
  syncAll(): void {
    for (const service of ACCOUNT_SERVICES) {
      const row = this.account(service);
      if (row && !row.signed_out) void this.sync(service);
    }
  }

  /** after the window comes back: sync accounts that haven't for a while */
  syncIfStale(): void {
    for (const service of ACCOUNT_SERVICES) {
      const row = this.account(service);
      if (row && !row.signed_out && (!row.last_sync || Date.now() - Date.parse(row.last_sync) >= SYNC_EVERY_MS)) void this.sync(service);
    }
  }

  sync(service: AccountService): Promise<void> {
    const running = this.running.get(service);
    if (running) return running;
    if (!this.account(service) || this.stopped) return Promise.resolve();
    const generation = this.generation.get(service) ?? 0;
    const run = this.doSync(service, () => !this.stopped && (this.generation.get(service) ?? 0) === generation).finally(() => {
      if (this.running.get(service) === run) this.running.delete(service);
    });
    this.running.set(service, run);
    return run;
  }

  private async doSync(service: AccountService, alive: () => boolean): Promise<void> {
    const provider = this.deps.providers[service];
    const name = ACCOUNT_NAMES[service];
    this.setLive(service, { state: "syncing" });
    try {
      const who = await provider.whoAmI();
      const remote = await provider.playlists();
      if (!alive()) return;
      this.remember(service, remote);

      const byId = new Map(remote.map((r) => [r.remoteId, r]));
      const exists = this.db.prepare("SELECT 1 FROM playlists WHERE id = ?");
      const todo = this.rows(service).filter((row) => {
        if (!row.enabled || !byId.has(row.remote_id)) return false;
        const mirrored = !!row.playlist_id && !!exists.get(row.playlist_id);
        // unchanged since the last sync, by the service's own word
        return !(mirrored && row.version && row.version === byId.get(row.remote_id)!.version);
      });

      for (const [step, row] of todo.entries()) {
        const playlist = byId.get(row.remote_id)!;
        const title = mirrorName(service, row);
        this.setLive(service, { state: "syncing", progress: { playlist: title, done: 0, total: 0, step: step + 1, steps: todo.length } });
        const songs = await provider.songs(playlist);
        if (!alive()) return;

        let playlistId = row.playlist_id && exists.get(row.playlist_id) ? row.playlist_id : undefined;
        const firstTime = !playlistId;
        const found = await this.matchAll(songs, alive, (done, partial) => {
          if (!alive()) return;
          if (partial && firstTime) playlistId = this.deps.library.mirrorPlaylist(playlistId, title, partial, { service, remoteId: row.remote_id });
          this.setLive(service, { state: "syncing", progress: { playlist: title, done, total: songs.length, step: step + 1, steps: todo.length } });
        });
        if (!alive()) return;
        this.deps.library.mirrorPlaylist(playlistId, title, found.songs, { service, remoteId: row.remote_id });
        this.db
          .prepare("UPDATE synced_playlists SET version = ?, songs = ?, missing = ?, synced_at = ? WHERE service = ? AND remote_id = ?")
          .run(playlist.version ?? null, found.songs.length, found.missing, new Date().toISOString(), service, row.remote_id);
      }

      // switched off: no copy in Your Library
      const off = this.rows(service)
        .filter((r) => !r.enabled && r.playlist_id)
        .map((r) => r.playlist_id!);
      if (off.length > 0) this.deps.library.deletePlaylists(off);

      await this.followArtists(service, provider, alive);
      if (!alive()) return;
      this.db
        .prepare("UPDATE accounts SET last_sync = ?, last_error = NULL, signed_out = 0, name = COALESCE(?, name) WHERE service = ?")
        .run(new Date().toISOString(), who.name ?? null, service);
      this.setLive(service, undefined);
    } catch (error) {
      if (!alive()) return;
      const signedOut = error instanceof SignedOutError;
      const message = signedOut
        ? `Your ${name} sign-in has ended. Connect again to keep your playlists up to date.`
        : error instanceof MatchError
          ? "Couldn't reach YouTube Music to find the songs. Vyse Music tries again in a few minutes."
          : `Couldn't reach ${name}. Vyse Music tries again in a few minutes.`;
      this.db.prepare("UPDATE accounts SET last_error = ?, signed_out = ? WHERE service = ?").run(message, signedOut ? 1 : 0, service);
      this.setLive(service, undefined);
    }
  }

  /** note every playlist the account has; ones that are gone there go here too */
  private remember(service: AccountService, remote: RemotePlaylist[]): void {
    const known = this.rows(service);
    const gone = known.filter((r) => !remote.some((p) => p.remoteId === r.remote_id));
    // an account always has its liked songs at least, so an empty answer is a hiccup, not a cleared account
    const removing = remote.length > 0 ? gone : [];
    transaction(this.db, () => {
      const upsert = this.db.prepare(
        `INSERT INTO synced_playlists (service, remote_id, name, liked, position) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(service, remote_id) DO UPDATE SET name = excluded.name, liked = excluded.liked, position = excluded.position`,
      );
      remote.forEach((p, i) => upsert.run(service, p.remoteId, p.name, p.liked ? 1 : 0, i));
      const remove = this.db.prepare("DELETE FROM synced_playlists WHERE service = ? AND remote_id = ?");
      for (const r of removing) remove.run(service, r.remote_id);
    });
    const mirrors = removing.map((r) => r.playlist_id).filter((id): id is string => !!id);
    if (mirrors.length > 0) this.deps.library.deletePlaylists(mirrors);
    this.emit();
  }

  /** each song as a YouTube Music song; ones that can't be found are left out and counted */
  private async matchAll(
    songs: RemoteSong[],
    alive: () => boolean,
    report: (done: number, partial?: MirroredSong[]) => void,
  ): Promise<{ songs: MirroredSong[]; missing: number }> {
    const results: (MirroredSong | null | undefined)[] = new Array(songs.length);
    const inOrder = () => results.filter((r): r is MirroredSong => !!r);
    let done = 0;
    let failed = false;
    await mapLimit(songs, MATCH_AT_ONCE, async (song, i) => {
      if (failed || !alive()) return;
      let found: { track: Track; searched: boolean } | null;
      try {
        found = await this.matchOne(song);
      } catch {
        // YouTube Music can't be reached: stop rather than sync a playlist with songs missing
        failed = true;
        return;
      }
      results[i] = found ? { track: found.track, addedAt: song.addedAt } : null;
      done++;
      if (done % SHOW_EVERY === 0) report(done, inOrder());
      else if (done % 10 === 0 || done === songs.length) report(done);
      if (found?.searched) await sleep(PAUSE_AFTER_SEARCH_MS);
    });
    if (failed) throw new MatchError("Matching failed");
    const matched = inOrder();
    return { songs: matched, missing: songs.length - matched.length };
  }

  private async matchOne(song: RemoteSong): Promise<{ track: Track; searched: boolean } | null> {
    if (song.track) return { track: song.track, searched: false };
    const cached = this.deps.matcher.cachedCandidates(song);
    const candidates = cached ?? (await this.deps.matcher.candidates(song));
    const best = candidates[0];
    if (!best) return null;
    // a close guess is taken too: the whole point is not having to go through every song by hand
    const status = song.videoId ? "matched" : classify(song, best);
    return status === "missing" ? null : { track: best.track, searched: !cached };
  }

  /** follow the account's artists here too, once each: unfollowing one in Vyse Music sticks */
  private async followArtists(service: AccountService, provider: AccountProvider, alive: () => boolean): Promise<void> {
    if (!provider.artists || !this.deps.follow) return;
    try {
      const artists = await provider.artists();
      if (!alive()) return;
      const seen = new Set<string>(JSON.parse(getSetting(this.db, artistsKey(service)) ?? "[]"));
      const fresh = artists.filter((a) => !seen.has(fold(a.name)));
      if (fresh.length === 0) return;
      const handled = await this.deps.follow(fresh, ARTIST_LOOKUPS_PER_SYNC);
      if (!alive()) return;
      for (const name of handled) seen.add(fold(name));
      setSetting(this.db, artistsKey(service), JSON.stringify([...seen]));
      this.deps.library.refresh();
    } catch {
      // artists are a bonus; the playlists already synced
    }
  }
}

function artistsKey(service: AccountService): string {
  return `accounts.${service}.artists`;
}

/** what the mirrored playlist is called: liked songs say where they're from */
function mirrorName(service: AccountService, row: { name: string; liked: number }): string {
  return row.liked ? `Liked on ${ACCOUNT_NAMES[service]}` : row.name;
}
