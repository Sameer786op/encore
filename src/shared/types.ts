// Data shapes shared by the main process and the UI.

import type { MoodId } from "./moods";
import type { GlobalCommand, GlobalKeysConfig, GlobalKeyState } from "./shortcuts";

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
  /** what was typed */
  query: string;
  /** the spelling the results are for, when YouTube Music corrected what was typed */
  showingFor?: string;
  /** a spelling YouTube Music thinks was meant; the results are still for what was typed */
  didYouMean?: string;
  /** other searches to try, likeliest first */
  related: string[];
  /** no song or video holds the words searched, so the song may not be there */
  noExactMatch?: boolean;
  top?: { kind: "track"; track: Track } | { kind: "album"; album: AlbumSummary } | { kind: "artist"; artist: ArtistSummary };
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  videos: Track[];
  playlists: RemotePlaylist[];
  /** pass to catalog.searchMore for the next page of songs */
  moreSongs?: string;
  /** pass to catalog.searchMore for the next page of videos */
  moreVideos?: string;
}

/** the tabs over search results; the last three each ask YouTube Music for just that kind */
export type SearchTab = "all" | "songs" | "videos" | "artists" | "albums" | "playlists";
export type SearchKind = "artists" | "albums" | "playlists";

export interface SearchKindResults {
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  playlists: RemotePlaylist[];
}

/** what YouTube Music suggests while typing: searches, and things to open right away */
export interface SearchSuggestions {
  queries: string[];
  items: SuggestedItem[];
}

export type SuggestedItem =
  | { kind: "track"; track: Track; subtitle: string }
  | { kind: "artist"; artist: ArtistSummary; subtitle: string }
  | { kind: "album"; album: AlbumSummary; subtitle: string }
  | { kind: "playlist"; playlist: RemotePlaylist; subtitle: string };

/** the format a song streams in */
export interface StreamQuality {
  /** "opus" or "mp4a.40.2" */
  codec: string;
  kbps: number;
  sampleRate: number;
  /** YouTube Premium's 256 kbps audio, through the person's own account */
  premium?: boolean;
}

/** a playlist on YouTube Music, such as a chart */
export interface RemotePlaylist {
  id: string;
  title: string;
  subtitle?: string;
  artwork?: string;
}

export interface RemotePlaylistDetails extends RemotePlaylist {
  description?: string;
  tracks: Track[];
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
  playlists: RemotePlaylist[];
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
  /** set when it mirrors a playlist on a connected account; it then changes only when that one does */
  synced?: { service: AccountService; remoteId: string };
}

// ---- connected accounts: playlists brought over from Spotify, YouTube Music and Apple Music ----

export type AccountService = "spotify" | "youtube" | "apple";

export const ACCOUNT_SERVICES: AccountService[] = ["spotify", "youtube", "apple"];

export const ACCOUNT_NAMES: Record<AccountService, string> = {
  spotify: "Spotify",
  youtube: "YouTube Music",
  apple: "Apple Music",
};

export interface SyncedPlaylistInfo {
  remoteId: string;
  name: string;
  /** the service's liked songs, kept as a playlist of their own */
  liked: boolean;
  enabled: boolean;
  /** the playlist in Your Library that mirrors it, once it has synced */
  playlistId?: string;
  songs: number;
  /** songs that couldn't be found on YouTube Music */
  missing: number;
}

export interface AccountStatus {
  service: AccountService;
  connected: boolean;
  /** who is signed in, when the service says */
  name?: string;
  state: "idle" | "connecting" | "syncing" | "signed-out" | "error";
  /** while syncing: the playlist being read and how far along its songs are */
  progress?: { playlist: string; done: number; total: number; step: number; steps: number };
  /** while connecting through the browser: the code to enter there, and the page to enter it on */
  signIn?: { code: string; url: string };
  lastSync?: string;
  error?: string;
  playlists: SyncedPlaylistInfo[];
}

/** the Spotify app that Spotify sign-ins go through */
export interface SpotifyAppInfo {
  /** this copy of Vyse Music has one built in */
  builtIn: boolean;
  /** the Client ID of the person's own Spotify app, used instead of the built-in one */
  own: string | null;
  /** what to register as the redirect URI in a Spotify app */
  redirectUri: string;
}

export interface HistoryEntry {
  track: Track;
  playedAt: string;
  playedMs: number;
}

/** your own plays over a stretch of time, for the numbers on Home */
export interface RecentPlays {
  plays: { trackId: string; playedAt: string; playedMs: number }[];
  /** each song in `plays`, once */
  tracks: Track[];
}

export interface SavedAlbum {
  album: AlbumSummary;
  savedAt: string;
}

/** an artist you follow; they show in Your Library and you hear about their new releases */
export interface SavedArtist {
  artist: ArtistSummary;
  savedAt: string;
}

export interface LibrarySnapshot {
  liked: LikedTrack[];
  playlists: Playlist[];
  history: HistoryEntry[];
  albums: SavedAlbum[];
  artists: SavedArtist[];
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
  /** playback speed; 1 when missing */
  rate?: number;
  /** listening together in a Jam, hosting or as a guest */
  jam?: boolean;
}

export type PlayerCommand = { kind: "toggle" } | { kind: "next" } | { kind: "previous" } | { kind: "seek"; seconds: number } | { kind: "like" };

export interface DiscordStatus {
  state: "off" | "connecting" | "connected" | "not-running" | "error";
  message?: string;
}

/** where Vyse Music's own updates stand; "off" in builds that don't update themselves, like development */
export interface UpdateStatus {
  state: "off" | "idle" | "checking" | "downloading" | "ready" | "latest" | "error";
  /** the version that's running */
  current: string;
  /** the version being downloaded, or ready to install */
  version?: string;
  /** download progress, 0 to 100 */
  progress?: number;
  error?: string;
  /** installed from the Microsoft Store, which keeps it up to date */
  store?: boolean;
}

/** where the mini player opens: where it was last left, or a corner of the main screen */
export type MiniCorner = "remember" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const MINI_CORNERS: MiniCorner[] = ["remember", "top-left", "top-right", "bottom-left", "bottom-right"];

export interface MiniConfig {
  showOnMinimize: boolean;
  /** float above other windows */
  alwaysOnTop: boolean;
  corner: MiniCorner;
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
  /** set on a mix started from the mood picker */
  mood?: MoodId;
}

export interface ReleaseItem {
  album: AlbumSummary;
  artist: ArtistSummary;
  /** when Vyse Music first noticed it */
  firstSeenAt: string;
  /** came out after Vyse Music started watching this artist */
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
  /** mood mixes started today, newest first */
  moodMixes?: DailyMix[];
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
  /** waiting for the user to approve Vyse Music in the browser */
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
  fullScreen: boolean;
  focused: boolean;
}

/** everything the UI can ask the main process for, exposed as `window.encore` */
export interface EncoreApi {
  catalog: {
    search(query: string): Promise<SearchResults>;
    /** artists, albums or playlists only, more of them than the mixed results hold */
    searchKind(query: string, kind: SearchKind): Promise<SearchKindResults>;
    suggestions(query: string): Promise<SearchSuggestions>;
    album(id: string): Promise<AlbumDetails>;
    artist(id: string): Promise<ArtistDetails>;
    home(): Promise<HomeSection[]>;
    /** the next page of songs or videos for a search */
    searchMore(token: string): Promise<{ tracks: Track[]; more?: string }>;
    playlist(id: string): Promise<RemotePlaylistDetails>;
    radio(track: Track): Promise<Track[]>;
    /** how much louder than YouTube's target a song is, in dB; null when unknown */
    loudness(trackId: string): Promise<number | null>;
    /** the format a YouTube song streams in, or null for other songs */
    quality(trackId: string): Promise<StreamQuality | null>;
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
    setAlbumSaved(album: AlbumSummary, saved: boolean): Promise<void>;
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
    /** your own plays since `since` (an ISO time), oldest first */
    recent(since: string): Promise<RecentPlays>;
    /** how long you listened each time you played a song, in ms, newest first */
    playsOf(trackId: string): Promise<number[]>;
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
    /** what's playing right now, for a window that just opened; null before anything plays */
    get(): Promise<NowPlaying | null>;
    /** the mini player asks the main window to do something */
    command(command: PlayerCommand): void;
    onCommand(listener: (command: PlayerCommand) => void): () => void;
  };
  mini: {
    open(): Promise<void>;
    close(): Promise<void>;
    /** close the mini player and bring the main window back */
    expand(): Promise<void>;
    configure(config: MiniConfig): Promise<void>;
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
    /** look for new releases from your artists now, unless that was done in the last 10 minutes */
    checkReleases(): Promise<void>;
    onChange(listener: (feed: HomeFeed) => void): () => void;
    status(): Promise<FeedStatus>;
    onStatus(listener: (status: FeedStatus) => void): () => void;
    isFollowing(artistId: string): Promise<boolean>;
    follow(artist: ArtistSummary, on: boolean): Promise<void>;
    /** a release Vyse Music told you about was clicked in a notification */
    onOpenAlbum(listener: (albumId: string) => void): () => void;
    setNotifications(on: boolean): Promise<void>;
    /** today's mix for a mood from what you play, made now if there isn't one; `fresh` makes a different one */
    moodMix(mood: MoodId, fresh?: boolean): Promise<DailyMix>;
  };
  accounts: {
    list(): Promise<AccountStatus[]>;
    onChange(listener: (accounts: AccountStatus[]) => void): () => void;
    /** opens the service's own sign-in page (in the browser for Spotify and YouTube Music, a window for Apple Music); true once signed in */
    connect(service: AccountService): Promise<boolean>;
    /** stops waiting for a sign-in under way */
    cancelConnect(service: AccountService): Promise<void>;
    /** opens the sign-in page again */
    reopenSignIn(service: AccountService): Promise<void>;
    /** signs out; its playlists are removed, or kept as ordinary playlists */
    disconnect(service: AccountService, keepPlaylists: boolean): Promise<void>;
    sync(service: AccountService): Promise<void>;
    setPlaylistEnabled(service: AccountService, remoteId: string, enabled: boolean): Promise<void>;
    /** the Spotify app Spotify sign-ins go through */
    spotifyApp(): Promise<SpotifyAppInfo>;
    /** use your own Spotify app from the next sign-in on, or null to go back to the built-in one */
    setSpotifyApp(clientId: string | null): Promise<SpotifyAppInfo>;
  };
  scrobble: {
    status(): Promise<ScrobbleStatus>;
    onStatus(listener: (status: ScrobbleStatus) => void): () => void;
    /** a song was listened to long enough to count */
    played(track: Track, startedAt: number, listenedMs: number): void;
    connectListenBrainz(token: string): Promise<ScrobbleStatus>;
    /** saves the API key, then opens Last.fm in the browser to approve Vyse Music */
    connectLastfm(apiKey: string, secret: string): Promise<ScrobbleStatus>;
    disconnect(service: ScrobbleService): Promise<ScrobbleStatus>;
  };
  app: {
    openDataFolder(): Promise<void>;
    /** true when the window is now full screen */
    toggleFullScreen(): Promise<boolean>;
    /** backgroundPlay: closing the window while music plays keeps it going from the system tray */
    configure(config: { backgroundPlay: boolean }): Promise<void>;
    /** the window frame, title bar buttons and native dialogs follow this */
    setTheme(theme: ThemeSetting): Promise<void>;
    /** asks for a picture and keeps a copy; resolves to its address, or null if none was picked */
    pickWallpaper(): Promise<string | null>;
    clearWallpaper(): Promise<void>;
    /** register shortcuts that work while Vyse Music is in the background; says which ones Windows accepted */
    setGlobalKeys(config: GlobalKeysConfig): Promise<Partial<Record<GlobalCommand, GlobalKeyState>>>;
    /** while true, the global shortcuts let their keys through, so a new one can be recorded */
    pauseGlobalKeys(paused: boolean): Promise<Partial<Record<GlobalCommand, GlobalKeyState>>>;
    onGlobalCommand(listener: (command: GlobalCommand) => void): () => void;
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

export type ThemeSetting = "dark" | "light" | "system";

/** the URL the audio element plays; the main process proxies it to the real stream */
export function mediaUrl(track: Pick<Track, "source" | "sourceId">, attempt = 0): string {
  const base = `${MEDIA_SCHEME}://${track.source}/${encodeURIComponent(track.sourceId)}`;
  return attempt > 0 ? `${base}?fresh=${attempt}` : base;
}

export function trackId(source: TrackSource, sourceId: string): string {
  return `${source}:${sourceId}`;
}
