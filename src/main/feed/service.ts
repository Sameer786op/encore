import type { DatabaseSync } from "node:sqlite";
import type { AlbumSummary, ArtistDetails, ArtistSummary, DailyMix, FeedStatus, HomeFeed, ReleaseItem, Track } from "@shared/types";
import { trackId } from "@shared/types";
import type { Library } from "../library/library";
import type { Matcher } from "../matching/matcher";
import { classify } from "../matching/score";
import { fold, similarity } from "../matching/text";
import { getSetting, mapLimit, setSetting } from "../settings";
import { assembleMix, describeMix, groupArtists, type MixArtist } from "./mixes";
import { diffReleases, releasesForFeed, type SeenRelease } from "./releases";
import { buildTaste, forgottenFavourites, onRepeat, primaryArtist, seededRandom, type Play, type SongTaste, type Taste } from "./taste";

// Builds the personal home page once a day: daily mixes, new releases from
// your artists, songs on repeat and forgotten favourites. Also watches your
// artists for new releases in the background.

export interface FeedCatalog {
  searchArtists(query: string): Promise<ArtistSummary[]>;
  artist(id: string): Promise<ArtistDetails>;
  radio(seed: Track): Promise<Track[]>;
}

const ARTIST_ID_DAYS = 60;
const ARTIST_INFO_DAYS = 7;
const RELEASE_CHECK_HOURS = 1;
/** opening the app looks for new releases right away, unless that was done this recently */
const OPEN_CHECK_GAP_MS = 10 * 60_000;
const MIX_COUNT = 5;
const MIX_ARTISTS = 14;
const WATCH_ARTISTS = 30;
/** new searches allowed per build; everything found is cached for next time */
const RESOLVE_BUDGET = 60;

const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const ageDays = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;

export class FeedService {
  private building: Promise<void> | null = null;
  private rebuild: Promise<void> | null = null;
  private checking: Promise<ReleaseItem[]> | null = null;
  private status: FeedStatus = { building: false };
  private feedListeners = new Set<(feed: HomeFeed) => void>();
  private statusListeners = new Set<(status: FeedStatus) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly library: Library,
    private readonly matcher: Matcher,
    private readonly catalog: FeedCatalog,
    private readonly notify: (releases: ReleaseItem[]) => void,
  ) {}

  onChange(listener: (feed: HomeFeed) => void): () => void {
    this.feedListeners.add(listener);
    return () => this.feedListeners.delete(listener);
  }

  onStatus(listener: (status: FeedStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): FeedStatus {
    return this.status;
  }

  private setStatus(status: FeedStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  /** today's feed if built, otherwise the last one */
  get(): HomeFeed | null {
    const row = this.db.prepare("SELECT data FROM feed_cache WHERE key = 'home' ").get() as { data: string } | undefined;
    const feed = row ? (JSON.parse(row.data) as HomeFeed) : null;
    if (!feed || feed.day !== today()) void this.build();
    return feed;
  }

  private save(feed: HomeFeed): void {
    this.db
      .prepare("INSERT INTO feed_cache (key, data, built_at) VALUES ('home', ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, built_at = excluded.built_at")
      .run(JSON.stringify(feed), feed.builtAt);
    for (const l of this.feedListeners) l(feed);
  }

  start(): void {
    this.timers.push(setTimeout(() => void this.get(), 4_000));
    // every time the app opens, look for new releases straight away
    this.timers.push(setTimeout(() => this.checkReleasesOnOpen(), 6_000));
    this.timers.push(
      setInterval(() => {
        // left open past midnight: make the new day's feed
        this.get();
        void this.checkReleasesIfDue();
      }, 10 * 60_000),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach((t) => clearTimeout(t));
  }

  // ---- following ----

  isFollowing(artistId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM followed_artists WHERE artist_id = ?").get(artistId);
  }

  follow(artist: ArtistSummary, on: boolean): void {
    if (on) {
      this.db
        .prepare("INSERT OR IGNORE INTO followed_artists (artist_id, name, artwork, followed_at) VALUES (?, ?, ?, ?)")
        .run(artist.id, artist.name, artist.artwork ?? null, new Date().toISOString());
      // start watching right away; what's already out becomes the baseline
      void this.checkReleases([artist]);
    } else this.db.prepare("DELETE FROM followed_artists WHERE artist_id = ?").run(artist.id);
  }

  private followed(): ArtistSummary[] {
    return (this.db.prepare("SELECT artist_id, name, artwork FROM followed_artists").all() as unknown as { artist_id: string; name: string; artwork: string | null }[]).map(
      (r) => ({ id: r.artist_id, name: r.name, artwork: r.artwork ?? undefined }),
    );
  }

  // ---- history ----

  private plays(): Play[] {
    const imported = this.db.prepare("SELECT title, artist, played_at, play_count, video_id FROM imported_plays").all() as unknown as {
      title: string;
      artist: string;
      played_at: string;
      play_count: number;
      video_id: string | null;
    }[];
    const own = this.db.prepare("SELECT t.data AS data, p.played_at AS played_at FROM plays p JOIN tracks t ON t.id = p.track_id").all() as unknown as {
      data: string;
      played_at: string;
    }[];
    return [
      ...imported.map((r) => ({ title: r.title, artist: r.artist, playedAt: r.played_at, count: r.play_count, videoId: r.video_id ?? undefined })),
      ...own.map((r) => {
        const track = JSON.parse(r.data) as Track;
        return { title: track.title, artist: track.artists[0]?.name ?? "", artistId: track.artists[0]?.id, playedAt: r.played_at, count: 1, track };
      }),
    ];
  }

  private taste(): Taste {
    return buildTaste(
      this.plays(),
      this.library.snapshot().liked.map((l) => l.track),
    );
  }

  // ---- artists ----

  /** the YouTube Music artist for a name from your history */
  private async resolveArtist(name: string, knownId: string | undefined, budget: { left: number }): Promise<ArtistSummary | null> {
    const key = fold(name);
    const row = this.db.prepare("SELECT artist_id, name, artwork, checked_at FROM artist_ids WHERE name_key = ?").get(key) as
      | { artist_id: string | null; name: string | null; artwork: string | null; checked_at: string }
      | undefined;
    if (row && ageDays(row.checked_at) < ARTIST_ID_DAYS && (row.artist_id || !knownId)) {
      return row.artist_id ? { id: row.artist_id, name: row.name ?? name, artwork: row.artwork ?? undefined } : null;
    }
    if (budget.left <= 0) return knownId ? { id: knownId, name } : null;
    budget.left--;
    let found: ArtistSummary | null = null;
    try {
      const results = await this.catalog.searchArtists(name);
      found = (knownId ? results.find((a) => a.id === knownId) : undefined) ?? results.find((a) => similarity(fold(a.name), key) >= 0.9) ?? null;
    } catch {
      return knownId ? { id: knownId, name } : null;
    }
    if (!found && knownId) found = { id: knownId, name };
    this.db
      .prepare(
        `INSERT INTO artist_ids (name_key, artist_id, name, artwork, checked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name_key) DO UPDATE SET artist_id = excluded.artist_id, name = excluded.name, artwork = excluded.artwork, checked_at = excluded.checked_at`,
      )
      .run(key, found?.id ?? null, found?.name ?? null, found?.artwork ?? null, new Date().toISOString());
    return found;
  }

  private async artistInfo(id: string, maxAgeDays = ARTIST_INFO_DAYS): Promise<ArtistDetails | null> {
    const row = this.db.prepare("SELECT data, fetched_at FROM artist_info WHERE artist_id = ?").get(id) as { data: string; fetched_at: string } | undefined;
    if (row && ageDays(row.fetched_at) < maxAgeDays) return JSON.parse(row.data) as ArtistDetails;
    try {
      const info = await this.catalog.artist(id);
      this.db
        .prepare("INSERT INTO artist_info (artist_id, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(artist_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at")
        .run(id, JSON.stringify(info), new Date().toISOString());
      return info;
    } catch {
      return row ? (JSON.parse(row.data) as ArtistDetails) : null;
    }
  }

  private async topArtists(taste: Taste, count: number, budget: { left: number }): Promise<MixArtist[]> {
    const out: MixArtist[] = [];
    for (const a of taste.artists) {
      if (out.length >= count) break;
      const resolved = await this.resolveArtist(a.name, a.artistId, budget);
      if (resolved && !out.some((o) => o.id === resolved.id)) out.push({ ...resolved, score: a.score });
    }
    return out;
  }

  // ---- songs ----

  /** a playable track for a song from your history, searching only within the budget */
  private async playable(song: SongTaste, budget: { left: number }): Promise<Track | null> {
    if (song.track) return song.track;
    if (song.videoId) {
      return {
        id: trackId("youtube", song.videoId),
        source: "youtube",
        sourceId: song.videoId,
        title: song.title,
        artists: [{ name: song.artist }],
        durationMs: 0,
        artwork: `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
      };
    }
    const source = { title: song.title, artists: [primaryArtist(song.artist)] };
    let candidates = this.matcher.cachedCandidates(source);
    if (!candidates && budget.left > 0) {
      budget.left--;
      candidates = await this.matcher.candidates(source).catch(() => null);
    }
    const best = candidates?.[0];
    return best && classify(source, best) === "matched" ? best.track : null;
  }

  private async playableList(songs: SongTaste[], budget: { left: number }, limit: number): Promise<Track[]> {
    const tracks = await mapLimit(songs, 3, (s) => this.playable(s, budget));
    return tracks.filter((t): t is Track => !!t).slice(0, limit);
  }

  // ---- building ----

  refresh(): Promise<void> {
    return this.build(true);
  }

  private build(force = false): Promise<void> {
    if (this.building) {
      if (!force) return this.building;
      // something changed during this build (new history, say): build again right after it
      this.rebuild ??= this.building.then(() => {
        this.rebuild = null;
        return this.build(true);
      });
      return this.rebuild;
    }
    this.building = this.doBuild(force)
      .catch((error) => console.warn(`[feed] build failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.building = null;
        this.setStatus({ building: false });
      });
    return this.building;
  }

  private async doBuild(force: boolean): Promise<void> {
    const day = today();
    const cached = this.db.prepare("SELECT data FROM feed_cache WHERE key = 'home'").get() as { data: string } | undefined;
    if (!force && cached && (JSON.parse(cached.data) as HomeFeed).day === day) return;

    this.setStatus({ building: true, step: "Looking at what you've been playing" });
    const taste = this.taste();
    const budget = { left: RESOLVE_BUDGET };
    const hasHistory = taste.songs.length > 0;

    const artists = hasHistory ? await this.topArtists(taste, MIX_ARTISTS, budget) : [];
    if (this.disposed) return;

    this.setStatus({ building: true, step: "Making your daily mixes" });
    const infos = new Map<string, ArtistDetails>();
    await mapLimit(artists.slice(0, 12), 3, async (a) => {
      const info = await this.artistInfo(a.id);
      if (info) infos.set(a.id, info);
    });
    const related = new Map([...infos].map(([id, info]) => [id, new Set(info.related.map((r) => r.id))]));
    const groups = groupArtists(artists.filter((a) => infos.has(a.id)), related, MIX_COUNT);

    const mixes: DailyMix[] = [];
    for (const [index, group] of groups.entries()) {
      if (this.disposed) return;
      const keys = new Set(group.map((a) => fold(a.name)));
      const favouriteSongs = taste.songs.filter((s) => keys.has(fold(primaryArtist(s.artist)))).slice(0, 30);
      const favourites = await this.playableList(favouriteSongs, budget, 20);
      const popular = group.flatMap((a) => (infos.get(a.id)?.topTracks ?? []).slice(0, 8));
      const seed = favourites.find((t) => t.source === "youtube") ?? popular[0];
      const discoveries = seed ? (await this.catalog.radio(seed).catch(() => [] as Track[])).slice(0, 20) : [];
      const tracks = assembleMix({ favourites, popular, discoveries }, seededRandom(`${day}:${index}`), 40);
      if (tracks.length < 8) continue;
      mixes.push({
        id: `mix-${mixes.length + 1}`,
        title: `Daily Mix ${mixes.length + 1}`,
        description: describeMix(group),
        artists: group.map(({ score: _score, ...a }) => a),
        tracks,
      });
    }

    this.setStatus({ building: true, step: "Finding your favourites" });
    const repeat = await this.playableList(onRepeat(taste), budget, 12);
    const rediscover = await this.playableList(forgottenFavourites(taste), budget, 12);

    const feed: HomeFeed = {
      day,
      builtAt: new Date().toISOString(),
      hasHistory,
      mixes,
      newReleases: this.releasesForFeed(artists),
      topArtists: artists.slice(0, 12).map(({ score: _score, ...a }) => a),
      onRepeat: repeat,
      rediscover,
    };
    this.save(feed);
  }

  // ---- new releases ----

  private allSeen(): SeenRelease[] {
    return (this.db.prepare("SELECT data, first_seen_at, baseline FROM releases_seen").all() as unknown as { data: string; first_seen_at: string; baseline: number }[]).map(
      (r) => {
        const { album, artist } = JSON.parse(r.data) as { album: AlbumSummary; artist: ArtistSummary };
        return { album, artist, firstSeenAt: r.first_seen_at, baseline: r.baseline === 1 };
      },
    );
  }

  private releasesForFeed(ranked: ArtistSummary[]): ReleaseItem[] {
    const rank = new Map(ranked.map((a, i) => [a.id, i]));
    for (const f of this.followed()) if (!rank.has(f.id)) rank.set(f.id, ranked.length);
    // only artists you still care about
    const relevant = this.allSeen().filter((r) => rank.has(r.artist.id));
    return releasesForFeed(relevant, rank);
  }

  /** for opening the app or bringing it back from the tray */
  checkReleasesOnOpen(): void {
    void this.checkReleasesIfDue(OPEN_CHECK_GAP_MS);
  }

  private async checkReleasesIfDue(gapMs = RELEASE_CHECK_HOURS * 3_600_000): Promise<void> {
    const last = getSetting(this.db, "releases.lastCheck");
    if (last && Date.now() - Date.parse(last) < gapMs) return;
    setSetting(this.db, "releases.lastCheck", new Date().toISOString());
    const budget = { left: 20 };
    const artists = [...this.followed(), ...(await this.topArtists(this.taste(), WATCH_ARTISTS, budget))];
    await this.checkReleases(artists, gapMs);
  }

  /** look at each artist's releases, using what was fetched within `maxAgeMs`; returns the ones that are new since last time */
  checkReleases(artists: ArtistSummary[], maxAgeMs = RELEASE_CHECK_HOURS * 3_600_000): Promise<ReleaseItem[]> {
    // checks queue up one after another, so each one looks at its own artists
    const run = (this.checking ?? Promise.resolve([] as ReleaseItem[])).catch(() => [] as ReleaseItem[]).then(() => this.doCheck(artists, maxAgeMs));
    this.checking = run;
    void run.finally(() => {
      if (this.checking === run) this.checking = null;
    });
    return run;
  }

  private async doCheck(artists: ArtistSummary[], maxAgeMs: number): Promise<ReleaseItem[]> {
    const unique = artists.filter((a, i) => artists.findIndex((b) => b.id === a.id) === i);
    const fresh: SeenRelease[] = [];
    await mapLimit(unique, 2, async (artist) => {
      if (this.disposed) return;
      const info = await this.artistInfo(artist.id, maxAgeMs / 86_400_000);
      if (!info) return;
      const seen = new Set(
        (this.db.prepare("SELECT release_id FROM releases_seen WHERE artist_id = ?").all(artist.id) as unknown as { release_id: string }[]).map((r) => r.release_id),
      );
      const who: ArtistSummary = { id: artist.id, name: info.name || artist.name, artwork: artist.artwork };
      const added = diffReleases(who, [...info.albums, ...info.singles], seen, seen.size === 0);
      const insert = this.db.prepare("INSERT OR IGNORE INTO releases_seen (release_id, artist_id, data, first_seen_at, baseline) VALUES (?, ?, ?, ?, ?)");
      for (const r of added) {
        insert.run(r.album.id, artist.id, JSON.stringify({ album: r.album, artist: r.artist }), r.firstSeenAt, r.baseline ? 1 : 0);
        if (!r.baseline) fresh.push(r);
      }
    });

    // refresh the home page's list so new releases show up without waiting a day
    const cached = this.db.prepare("SELECT data FROM feed_cache WHERE key = 'home'").get() as { data: string } | undefined;
    if (cached) {
      const feed = JSON.parse(cached.data) as HomeFeed;
      this.save({ ...feed, newReleases: this.releasesForFeed(feed.topArtists) });
    }
    const items = fresh.map((r) => ({ album: r.album, artist: r.artist, firstSeenAt: r.firstSeenAt, isNew: true }));
    if (items.length > 0 && getSetting(this.db, "notifications.releases") !== "off") this.notify(items);
    return items;
  }

  setNotifications(on: boolean): void {
    setSetting(this.db, "notifications.releases", on ? "on" : "off");
  }
}
