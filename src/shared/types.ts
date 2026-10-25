// Data shapes shared by the main process and the UI.

export type TrackSource = "youtube" | "local";

export interface ArtistRef {
  id?: string;
  name: string;
}

export interface AlbumRef {
  id?: string;
  title: string;
}

export interface Track {
  /** globally unique: `${source}:${sourceId}` */
  id: string;
  source: TrackSource;
  sourceId: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationMs: number;
  artwork?: string;
  explicit?: boolean;
  /** ReplayGain from a local file's tags, in dB */
  gainDb?: number;
}

export interface AlbumSummary {
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: string;
  kind?: string;
  artwork?: string;
}

export interface ArtistSummary {
  id: string;
  name: string;
  subtitle?: string;
  artwork?: string;
}

export interface SearchResults {
  query: string;
  top?: { kind: "track"; track: Track } | { kind: "album"; album: AlbumSummary } | { kind: "artist"; artist: ArtistSummary };
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  videos: Track[];
}

export interface AlbumDetails extends AlbumSummary {
  description?: string;
  tracks: Track[];
}

export interface ArtistDetails extends ArtistSummary {
  description?: string;
  topTracks: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  /** "Fans might also like" */
  related: ArtistSummary[];
}

export interface HomeSection {
  title: string;
  tracks: Track[];
  albums: AlbumSummary[];
}

export interface LikedTrack {
  track: Track;
  likedAt: string;
}

export interface PlaylistItem {
  itemId: string;
  track: Track;
  addedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: PlaylistItem[];
}

export interface HistoryEntry {
  track: Track;
  playedAt: string;
  playedMs: number;
}

export interface LibrarySnapshot {
  liked: LikedTrack[];
  playlists: Playlist[];
  history: HistoryEntry[];
}


// ---- importing music from other services ----

/** a song as another service describes it, before we know its YouTube Music match */
export interface SourceTrack {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  /** a YouTube video id, when the source already knows it (YouTube links, Takeout) */
  videoId?: string;
  /** the id on the original service, e.g. spotify:track:… */
  externalId?: string;
  /** set when the source already gave us a full YouTube Music track */
  track?: Track;
}

export type ImportOrigin = "spotify" | "apple" | "youtube" | "csv" | "encore";

export type ImportItemStatus = "pending" | "matched" | "review" | "missing" | "accepted" | "skipped";

export interface MatchCandidate {
  track: Track;
  /** 0..1, how sure we are this is the same song */
  score: number;
}

export interface ImportItem {
  index: number;
  source: SourceTrack;
  status: ImportItemStatus;
  candidates: MatchCandidate[];
  /** the song that will be added, when it differs from the best candidate */
  chosen?: Track;
}

export type ImportDestination = { kind: "playlist"; name: string } | { kind: "liked" };

export type ImportJobStatus = "matching" | "review" | "done" | "cancelled";

export interface ImportJob {
  id: string;
  name: string;
  origin: ImportOrigin;
  destination: ImportDestination;
  status: ImportJobStatus;
  createdAt: string;
  total: number;
  counts: Record<ImportItemStatus, number>;
  note?: string;
  resultPlaylistId?: string;
}

export interface ImportJobDetails extends ImportJob {
  items: ImportItem[];
}

/** what we found inside a data export, before anything is saved */
export interface ExportSummary {
  token: string;
  origin: ImportOrigin;
  fileName: string;
  history?: { plays: number; songs: number; firstAt: string; lastAt: string; hasListeningTime: boolean };
  collections: { key: string; name: string; count: number; destination: ImportDestination }[];
  warnings: string[];
}

export interface ExportChoices {
  history: boolean;
  collections: string[];
}

export interface ExportResult {
  historyAdded: number;
  jobs: ImportJob[];
}

export interface HistorySource {
  origin: ImportOrigin;
  plays: number;
  firstAt: string;
  lastAt: string;
}

export interface TopSong {
  key: string;
  title: string;
  artist: string;
  plays: number;
  ms: number;
  /** a playable track, when we already know the YouTube Music match */
  track?: Track;
  source: SourceTrack;
}

export interface ListeningInsights {
  totals: { plays: number; ms: number; songs: number; artists: number; firstAt?: string; lastAt?: string };
  sources: HistorySource[];
  topSongs: TopSong[];
  topArtists: { name: string; plays: number; ms: number }[];
  years: { year: number; plays: number; ms: number }[];
}

// ---- local music files ----

export interface LocalScanState {
  folders: string[];
  scanning: boolean;
  found: number;
  processed: number;
  tracks: number;
  /** files we found but Chromium can't play (e.g. ALAC, WMA) */
  unsupported: number;
}

// ---- lyrics ----

export interface LyricLine {
  /** seconds from the start of the song */
  time: number;
  text: string;
}

export interface Lyrics {
  source: "lrclib" | "youtube" | "file";
  /** time-synced lines, when we have them */
  synced: LyricLine[] | null;
  plain: string | null;
}

// ---- what's playing, shared with the mini player and Discord ----

export interface NowPlaying {
  track: Track | null;
  playing: boolean;
  /** seconds into the song when `at` was sampled */
  position: number;
  duration: number;
  liked: boolean;
  /** Date.now() when position was read */
  at: number;
}

export type PlayerCommand = { kind: "toggle" } | { kind: "next" } | { kind: "previous" } | { kind: "seek"; seconds: number } | { kind: "like" };

export interface DiscordStatus {
  state: "off" | "connecting" | "connected" | "not-running" | "error";
  message?: string;
}

/** where Encore's own updates stand; "off" in builds that don't update themselves, like development */
export interface UpdateStatus {
  state: "off" | "idle" | "checking" | "downloading" | "ready" | "latest" | "error";
  /** the version that's running */
  current: string;
  /** the version being downloaded, or ready to install */
  version?: string;
  /** download progress, 0 to 100 */
  progress?: number;
  error?: string;
}

export interface DiscordConfig {
  enabled: boolean;
  clientId: string;
  showWhenPaused: boolean;
}

// ---- the personal home feed ----

export interface DailyMix {
  id: string;
  title: string;
  /** e.g. "The Weeknd, Daft Punk and more" */
  description: string;
  artists: ArtistSummary[];
  tracks: Track[];
}

export interface ReleaseItem {
  album: AlbumSummary;
  artist: ArtistSummary;
  /** when Encore first noticed it */
  firstSeenAt: string;
  /** came out after Encore started watching this artist */
  isNew: boolean;
}

export interface HomeFeed {
  day: string;
  builtAt: string;
  hasHistory: boolean;
  mixes: DailyMix[];
  newReleases: ReleaseItem[];
  topArtists: ArtistSummary[];
  /** what you've played most in the last month */
  onRepeat: Track[];
  /** favourites you haven't played in a long while */
  rediscover: Track[];
}

export interface FeedStatus {
  building: boolean;
  step?: string;
}

// ---- scrobbling ----

export type ScrobbleService = "lastfm" | "listenbrainz";

export interface ScrobbleServiceStatus {
  connected: boolean;
  user?: string;
  /** waiting for the user to approve Encore in the browser */
  pending?: boolean;
  error?: string;
}

export interface ScrobbleStatus {
  lastfm: ScrobbleServiceStatus & { hasApiKey: boolean };
  listenbrainz: ScrobbleServiceStatus;
  queued: number;
}

export interface WindowState {
  maximized: boolean;
  focused: boolean;
}

/** everything the UI can ask the main process for, exposed as `window.encore` */
export interface EncoreApi {
  catalog: {
    search(query: string): Promise<SearchResults>;
    suggestions(query: string): Promise<string[]>;
    album(id: string): Promise<AlbumDetails>;
    artist(id: string): Promise<ArtistDetails>;
    home(): Promise<HomeSection[]>;
    radio(track: Track): Promise<Track[]>;
    /** how much louder than YouTube's target a song is, in dB; null when unknown */
    loudness(trackId: string): Promise<number | null>;
    /** resolves and caches the stream ahead of time so the next track starts instantly */
    prefetch(trackId: string): Promise<void>;
  };
  library: {
    get(): Promise<LibrarySnapshot>;
    onChange(listener: (snapshot: LibrarySnapshot) => void): () => void;
    setLiked(track: Track, liked: boolean): Promise<void>;
    createPlaylist(name: string, tracks?: Track[]): Promise<Playlist>;
    renamePlaylist(id: string, name: string): Promise<void>;
    deletePlaylist(id: string): Promise<void>;
    addToPlaylist(id: string, tracks: Track[]): Promise<number>;
    removeFromPlaylist(id: string, itemId: string): Promise<void>;
    reorderPlaylist(id: string, itemIds: string[]): Promise<void>;
    recordPlay(track: Track, playedMs: number): Promise<void>;
    clearHistory(): Promise<void>;
  };
  imports: {
    /** read a Spotify, Apple Music or YouTube link and start matching it */
    fromLink(url: string): Promise<ImportJob>;
    /** open a file picker for a data export or CSV; null when cancelled */
    pickFile(): Promise<string | null>;
    /** the file system path of a dropped file */
    pathForFile(file: File): string;
    analyzeExport(path: string): Promise<ExportSummary>;
    applyExport(token: string, choices: ExportChoices): Promise<ExportResult>;
    list(): Promise<ImportJob[]>;
    get(id: string): Promise<ImportJobDetails>;
    onChange(listener: (jobs: ImportJob[]) => void): () => void;
    /** pick a song for an item, or null to leave it out */
    choose(jobId: string, index: number, track: Track | null): Promise<void>;
    acceptSuggestions(jobId: string): Promise<number>;
    finish(jobId: string): Promise<ImportJob>;
    remove(jobId: string): Promise<void>;
    /** find the YouTube Music version of one song right away */
    matchOne(source: SourceTrack): Promise<MatchCandidate[]>;
  };
  history: {
    insights(): Promise<ListeningInsights>;
    playlistFromTopSongs(limit: number): Promise<ImportJob>;
    removeImported(origin: ImportOrigin): Promise<void>;
  };
  local: {
    state(): Promise<LocalScanState>;
    onState(listener: (state: LocalScanState) => void): () => void;
    tracks(): Promise<Track[]>;
    addFolder(): Promise<LocalScanState>;
    removeFolder(path: string): Promise<LocalScanState>;
    rescan(): Promise<void>;
    showInFolder(trackId: string): Promise<void>;
  };
  lyrics: {
    get(track: Track): Promise<Lyrics | null>;
  };
  nowPlaying: {
    /** the main window shares what's playing */
    publish(state: NowPlaying): void;
    onUpdate(listener: (state: NowPlaying) => void): () => void;
    /** the mini player asks the main window to do something */
    command(command: PlayerCommand): void;
    onCommand(listener: (command: PlayerCommand) => void): () => void;
  };
  mini: {
    open(): Promise<void>;
    close(): Promise<void>;
    /** close the mini player and bring the main window back */
    expand(): Promise<void>;
    configure(config: { showOnMinimize: boolean }): Promise<void>;
    onVisible(listener: (visible: boolean) => void): () => void;
  };
  discord: {
    configure(config: DiscordConfig): Promise<void>;
    status(): Promise<DiscordStatus>;
    onStatus(listener: (status: DiscordStatus) => void): () => void;
  };
  feed: {
    /** the latest feed, possibly from earlier today; null before the first build */
    get(): Promise<HomeFeed | null>;
    refresh(): Promise<void>;
    onChange(listener: (feed: HomeFeed) => void): () => void;
    status(): Promise<FeedStatus>;
    onStatus(listener: (status: FeedStatus) => void): () => void;
    isFollowing(artistId: string): Promise<boolean>;
    follow(artist: ArtistSummary, on: boolean): Promise<void>;
    /** a release Encore told you about was clicked in a notification */
    onOpenAlbum(listener: (albumId: string) => void): () => void;
    setNotifications(on: boolean): Promise<void>;
  };
  scrobble: {
    status(): Promise<ScrobbleStatus>;
    onStatus(listener: (status: ScrobbleStatus) => void): () => void;
    /** a song was listened to long enough to count */
    played(track: Track, startedAt: number, listenedMs: number): void;
    connectListenBrainz(token: string): Promise<ScrobbleStatus>;
    /** saves the API key, then opens Last.fm in the browser to approve Encore */
    connectLastfm(apiKey: string, secret: string): Promise<ScrobbleStatus>;
    disconnect(service: ScrobbleService): Promise<ScrobbleStatus>;
  };
  app: {
    openDataFolder(): Promise<void>;
    /** true when the window is now full screen */
    toggleFullScreen(): Promise<boolean>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
    /** look for a new version now */
    check(): Promise<UpdateStatus>;
    /** restart into the version that was downloaded */
    install(): Promise<void>;
  };
  window: {
    getState(): Promise<WindowState>;
    onState(listener: (state: WindowState) => void): () => void;
  };
}

export const MEDIA_SCHEME = "encore-media";

/** the URL the audio element plays; the main process proxies it to the real stream */
export function mediaUrl(track: Pick<Track, "source" | "sourceId">, attempt = 0): string {
  const base = `${MEDIA_SCHEME}://${track.source}/${encodeURIComponent(track.sourceId)}`;
  return attempt > 0 ? `${base}?fresh=${attempt}` : base;
}

export function trackId(source: TrackSource, sourceId: string): string {
  return `${source}:${sourceId}`;
}
