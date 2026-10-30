import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, session, shell, type IpcMainInvokeEvent } from "electron";
import type {
  AlbumSummary,
  ArtistSummary,
  DiscordConfig,
  ExportChoices,
  ImportOrigin,
  NowPlaying,
  PlayerCommand,
  ReleaseItem,
  ScrobbleService,
  SourceTrack,
  Track,
  WindowState,
} from "@shared/types";
import { ACCOUNT_SERVICES, MINI_CORNERS, type AccountService, type MiniConfig, type MiniCorner, type SpotifyAppInfo } from "@shared/types";
import { IPC } from "@shared/ipc";
import { isMoodId } from "@shared/moods";
import { shouldScrobble } from "@shared/scrobbleRules";
import { AppleProvider } from "./accounts/apple";
import { GoogleSignIn } from "./accounts/google";
import type { AccountAuth, AccountProvider } from "./accounts/provider";
import { SpotifyProvider } from "./accounts/spotify";
import { isClientId, SPOTIFY_REDIRECT, SpotifySignIn } from "./accounts/spotifyAuth";
import { standinAccounts } from "./accounts/standin";
import { AccountSync } from "./accounts/sync";
import { AccountWeb } from "./accounts/web";
import { YouTubeProvider } from "./accounts/youtube";
import { Appearance, WALLPAPER_TYPES } from "./appearance";
import { GlobalKeys } from "./globalKeys";
import { Thumbar } from "./thumbar";
import { openDatabase } from "./db";
import { getSetting, setSetting } from "./settings";
import { BackgroundTray } from "./tray";
import { DiscordRpc } from "./discord/rpc";
import { buildActivity, presenceKey } from "./discord/presence";
import { FeedService } from "./feed/service";
import { ListeningHistory } from "./history/history";
import { ImportManager } from "./imports/manager";
import { readSpotify } from "./imports/links";
import { ImportService } from "./imports/service";
import { Library } from "./library/library";
import { LocalLibrary } from "./local/local";
import { LyricsService } from "./lyrics/lyrics";
import { MiniPlayer } from "./mini/mini";
import { Matcher } from "./matching/matcher";
import { classify } from "./matching/score";
import { handleMediaProtocol, registerMediaScheme } from "./media-protocol";
import { Lastfm, ListenBrainz } from "./scrobble/clients";
import { Scrobbler } from "./scrobble/scrobbler";
import { Updater } from "./updates/updater";
import { electronVault } from "./scrobble/vault";
import { album, artist, home, lyricsText, moodPlaylists, moodRadio, playlist, radio, remotePlaylist, search, searchArtists, searchKind, searchMore, searchSongs, searchVideos, songMoods, suggestions, trackById } from "./youtube/catalog";
import { configureYouTube, createYouTube } from "./youtube/client";
import { usePremiumAccount } from "./youtube/premium";
import { resolveAudio } from "./youtube/streams";
import icon from "../../resources/icon.png?asset";

registerMediaScheme();

// automated tests run against a throwaway profile
if (process.env.ENCORE_USER_DATA) app.setPath("userData", process.env.ENCORE_USER_DATA);
// Vyse Music used to be called Encore: keep using the library, history and settings saved under the old name
else if (existsSync(join(app.getPath("appData"), "Encore"))) app.setPath("userData", join(app.getPath("appData"), "Encore"));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let db: DatabaseSync;
let library: Library;
let matcher: Matcher;
let imports: ImportManager;
let importService: ImportService;
let history: ListeningHistory;
let local: LocalLibrary;
let lyrics: LyricsService;
let mini: MiniPlayer;
let feed: FeedService;
let scrobbler: Scrobbler;
let updates: Updater;
let appearance: Appearance;
let accounts: AccountSync;
let accountWeb: AccountWeb | null = null;
const discord = new DiscordRpc();
let discordShowWhenPaused = false;
let nowPlaying: NowPlaying | null = null;
let thumbar: Thumbar | null = null;
// closing the window while music plays hides it to the tray instead of quitting
let backgroundPlay = true;
let quitting = false;
const tray = new BackgroundTray({
  icon,
  show: () => showMainWindow(),
  command: (command) => mainWindow?.webContents.send(IPC.playerCommandForward, command),
  quit: () => app.quit(),
});
let lastPresence = "";
let nowPlayingSentFor = "";

const ORIGINS: ImportOrigin[] = ["spotify", "apple", "youtube", "csv", "encore"];

function windowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), focused: win.isFocused() };
}

/** the renderer, at a given view ("" for the main app, "mini" for the mini player) */
function loadRenderer(win: BrowserWindow, view = ""): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(view ? `${process.env.ELECTRON_RENDERER_URL}#${view}` : process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), view ? { hash: view } : undefined);
}

function updatePresence(force = false): void {
  if (!nowPlaying) return;
  const key = `${presenceKey(nowPlaying)}|${discordShowWhenPaused}`;
  if (!force && key === lastPresence) return;
  lastPresence = key;
  discord.setActivity(buildActivity(nowPlaying, { showWhenPaused: discordShowWhenPaused }));
}

// mini and show are handled here; the rest are player actions for the main window
const globalKeys = new GlobalKeys((command) => {
  if (command === "show") return showMainWindow();
  if (command === "mini") return mini.visible ? mini.close() : mini.open();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.appGlobalCommand, command);
});

/** bring the main window to the front, for notification clicks and second launches */
function showMainWindow(): void {
  if (!mainWindow) return;
  // opening it again from the tray or the Start menu counts as opening the app
  if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
    updates?.checkIfStale();
    void feed?.checkReleasesOnOpen();
    accounts?.syncIfStale();
  }
  tray.hide();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function notifyReleases(releases: ReleaseItem[]): void {
  if (!Notification.isSupported() || releases.length === 0) return;
  const [first] = releases;
  const artists = [...new Set(releases.map((r) => r.artist.name))];
  const notification = new Notification({
    title: releases.length === 1 ? `New from ${first.artist.name}` : `${releases.length} new releases`,
    body:
      releases.length === 1
        ? `${first.album.title}${first.album.kind ? ` \u00b7 ${first.album.kind}` : ""}`
        : `From ${artists.slice(0, 3).join(", ")}${artists.length > 3 ? " and more" : ""}`,
    icon,
    silent: false,
  });
  notification.on("click", () => {
    showMainWindow();
    // one release opens its page; several open the home page where they're listed
    mainWindow?.webContents.send(IPC.feedOpenAlbum, releases.length === 1 ? first.album.id : "");
  });
  notification.show();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: "Vyse Music",
    icon,
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: appearance.backgroundColor,
    titleBarStyle: "hidden",
    // native Windows caption buttons (with snap layouts) drawn over our UI
    titleBarOverlay: appearance.titleBarOverlay,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // keep playback logic running while minimized
      backgroundThrottling: false,
      // songs resume and move on by themselves, without a click first
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.once("ready-to-show", () => win.show());

  win.on("close", (event) => {
    if (quitting || !backgroundPlay || !nowPlaying?.playing) return;
    event.preventDefault();
    win.hide();
    tray.show();
    tray.update(nowPlaying);
    // say where it went, the first time only
    if (getSetting(db, "background.explained") !== "yes" && Notification.isSupported()) {
      setSetting(db, "background.explained", "yes");
      new Notification({
        title: "Vyse Music is still playing",
        body: "It's in the system tray by the clock. Click it to come back, or right-click it to quit. You can turn this off in Settings.",
        icon,
      }).show();
    }
  });

  const sendState = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowState, windowState(win));
  };
  for (const event of ["maximize", "unmaximize", "focus", "blur", "enter-full-screen", "leave-full-screen"] as const) {
    win.on(event as "maximize", sendState);
  }

  // links open in the real browser; the app window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  loadRenderer(win);
  return win;
}

/** only our own windows may call into the main process; most calls only from the main one */
function handle<Args extends unknown[], R>(channel: string, fn: (...args: Args) => R | Promise<R>, options: { fromMini?: boolean } = {}): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const fromMain = !!mainWindow && event.sender === mainWindow.webContents;
    const fromMini = !!options.fromMini && !!mini && mini.owns(event.sender);
    if (!fromMain && !fromMini) throw new Error("Unknown sender");
    return fn(...(args as Args));
  });
}

const COMMANDS = new Set<PlayerCommand["kind"]>(["toggle", "next", "previous", "seek", "like"]);

function registerPlayerSync(): void {
  // the main window says what's playing; the mini player and Discord follow
  ipcMain.on(IPC.nowPlayingPublish, (event, state: NowPlaying) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !state || typeof state !== "object") return;
    nowPlaying = state;
    tray.update(state);
    thumbar?.update(state);
    mini.hasTrack = !!state.track;
    mini.send(IPC.nowPlayingUpdate, state);
    updatePresence();
    // tell the scrobbling services once per song, when it starts playing
    if (!state.track) nowPlayingSentFor = "";
    else if (state.playing && isTrack(state.track) && nowPlayingSentFor !== state.track.id) {
      nowPlayingSentFor = state.track.id;
      scrobbler.nowPlaying(state.track);
    }
  });
  // a song was heard long enough to count
  ipcMain.on(IPC.scrobblePlayed, (event, track: unknown, startedAt: unknown, listenedMs: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !isTrack(track)) return;
    if (typeof startedAt !== "number" || typeof listenedMs !== "number") return;
    // the services only take listens from the last two weeks, and none from the future
    if (startedAt > Date.now() + 60_000 || startedAt < Date.now() - 14 * 86_400_000) return;
    if (!shouldScrobble(track.durationMs ?? 0, listenedMs)) return;
    scrobbler.played(track, startedAt);
  });
  // the mini player's buttons go back to the main window, which owns the audio
  ipcMain.on(IPC.playerCommand, (event, command: PlayerCommand) => {
    if (!mini.owns(event.sender) || !command || !COMMANDS.has(command.kind)) return;
    if (command.kind === "seek" && typeof command.seconds !== "number") return;
    mainWindow?.webContents.send(IPC.playerCommandForward, command);
  });
}

function isTrack(value: unknown): value is Track {
  const t = value as Track;
  if (!t || typeof t.id !== "string" || typeof t.sourceId !== "string" || typeof t.title !== "string") return false;
  if (t.source === "youtube") return /^[\w-]{11}$/.test(t.sourceId);
  return t.source === "local" && /^[a-f0-9]{40}$/.test(t.sourceId);
}

function isSourceTrack(value: unknown): value is SourceTrack {
  const s = value as SourceTrack;
  return !!s && typeof s.title === "string" && Array.isArray(s.artists) && s.artists.every((a) => typeof a === "string");
}

/** radio needs a YouTube Music song; a local file is looked up first */
async function radioFor(track: Track): Promise<Track[]> {
  if (track.source === "youtube") return radio(track);
  const source: SourceTrack = { title: track.title, artists: track.artists.map((a) => a.name), durationMs: track.durationMs };
  const [best] = await matcher.candidates(source);
  if (!best || classify(source, best) === "missing") return [];
  return [best.track, ...(await radio(best.track))];
}

function tracksArg(value: unknown): Track[] {
  if (!Array.isArray(value) || !value.every(isTrack)) throw new Error("Expected a list of tracks");
  return value;
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${name} to be text`);
  return value;
}

function serviceArg(value: unknown): AccountService {
  if (!ACCOUNT_SERVICES.includes(value as AccountService)) throw new Error("Unknown service");
  return value as AccountService;
}

// Vyse Music's own Spotify app, built into releases from .env.local (never committed); someone can use their own app instead
const BUILT_IN_SPOTIFY = (import.meta.env.MAIN_VITE_SPOTIFY_CLIENT_ID ?? "").trim();
const SPOTIFY_APP_KEY = "accounts.spotify.clientId";

function spotifyApp(): SpotifyAppInfo {
  // stand-in accounts for tests sign in without one
  const builtIn = isClientId(BUILT_IN_SPOTIFY) || !!process.env.ENCORE_ACCOUNTS_STANDIN;
  return { builtIn, own: getSetting(db, SPOTIFY_APP_KEY), redirectUri: SPOTIFY_REDIRECT };
}

function setSpotifyApp(value: unknown): SpotifyAppInfo {
  const clientId = typeof value === "string" ? value.trim() : null;
  if (clientId !== null && !isClientId(clientId)) throw new Error("A Spotify Client ID is 32 letters and numbers");
  setSetting(db, SPOTIFY_APP_KEY, clientId ? clientId.toLowerCase() : null);
  return spotifyApp();
}

/** the real sign-ins and readers, or the stand-ins automated tests use */
function accountConnections(): { providers: Record<AccountService, AccountProvider>; auth: Record<AccountService, AccountAuth> } {
  if (process.env.ENCORE_ACCOUNTS_STANDIN) return standinAccounts(process.env.ENCORE_ACCOUNTS_STANDIN);
  const web = new AccountWeb({ parent: () => mainWindow, icon });
  accountWeb = web;
  // Spotify used to sign in inside a window of Vyse Music's own; nothing from that sign-in is kept
  if (!getSetting(db, "accounts.spotify.windowCleared")) {
    void session
      .fromPartition("persist:account-spotify")
      .clearStorageData()
      .then(() => setSetting(db, "accounts.spotify.windowCleared", "1"))
      .catch(() => undefined);
  }
  const spotify = new SpotifySignIn({
    store: {
      get: () => {
        const saved = getSetting(db, "accounts.spotify.signIn");
        return saved ? electronVault.decrypt(saved) : null;
      },
      set: (value) => setSetting(db, "accounts.spotify.signIn", value === null ? null : electronVault.encrypt(value)),
    },
    clientId: () => {
      const chosen = spotifyApp();
      return chosen.own ?? (chosen.builtIn ? BUILT_IN_SPOTIFY : null);
    },
    // Spotify's page opens in the person's own browser, where they may be signed in to Spotify already
    openPage: (url) => {
      if (!process.env.ENCORE_NO_BROWSER) void shell.openExternal(url);
    },
    accountsUrl: process.env.ENCORE_SPOTIFY_ACCOUNTS_URL,
  });
  const google = new GoogleSignIn({
    // kept encrypted, like the scrobbling keys
    store: {
      get: () => {
        const saved = getSetting(db, "accounts.youtube.signIn");
        return saved ? electronVault.decrypt(saved) : null;
      },
      set: (value) => setSetting(db, "accounts.youtube.signIn", value === null ? null : electronVault.encrypt(value)),
    },
    // Google's page opens in the person's own browser, where they're signed in to Google already; the code is ready to paste
    openPage: ({ code, url }) => {
      if (process.env.ENCORE_NO_BROWSER) return;
      clipboard.writeText(code);
      void shell.openExternal(url);
    },
    create: createYouTube,
  });
  // a connected YouTube Music account with Premium streams at 256 kbps
  usePremiumAccount(google.client);
  return {
    providers: {
      spotify: new SpotifyProvider(spotify.api, (id) => readSpotify({ service: "spotify", kind: "playlist", id }), fetch, process.env.ENCORE_SPOTIFY_API_URL),
      youtube: new YouTubeProvider(google.client),
      apple: new AppleProvider(web.apiAuth("apple")),
    },
    auth: { spotify, youtube: google, apple: web.auth("apple") },
  };
}

function artistArg(value: unknown): ArtistSummary {
  const a = value as ArtistSummary;
  if (!a || typeof a.id !== "string" || !/^[\w-]{1,64}$/.test(a.id) || typeof a.name !== "string") throw new Error("Expected an artist");
  return { id: a.id, name: a.name.slice(0, 200), artwork: typeof a.artwork === "string" ? a.artwork : undefined };
}

function albumArg(value: unknown): AlbumSummary {
  const a = value as AlbumSummary;
  if (!a || typeof a.id !== "string" || !/^[\w:.-]{1,128}$/.test(a.id) || typeof a.title !== "string") throw new Error("Expected an album");
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const artists = Array.isArray(a.artists)
    ? a.artists
        .filter((x) => x && typeof x.name === "string")
        .slice(0, 20)
        .map((x) => ({ name: x.name.slice(0, 200), ...(typeof x.id === "string" ? { id: x.id.slice(0, 64) } : {}) }))
    : [];
  return { id: a.id, title: a.title.slice(0, 300), artists, year: text(a.year, 10), kind: text(a.kind, 40), artwork: text(a.artwork, 2000) };
}

const SCROBBLE_SERVICES: ScrobbleService[] = ["lastfm", "listenbrainz"];

function registerIpc(): void {
  handle(IPC.search, (query: unknown) => search(stringArg(query, "query").slice(0, 200)));
  handle(IPC.searchKind, (query: unknown, kind: unknown) => {
    if (kind !== "artists" && kind !== "albums" && kind !== "playlists") throw new Error("Unknown kind of search");
    return searchKind(stringArg(query, "query").slice(0, 200), kind);
  });
  handle(IPC.suggestions, (query: unknown) => suggestions(stringArg(query, "query").slice(0, 200)));
  handle(IPC.album, (id: unknown) => album(stringArg(id, "album id")));
  handle(IPC.searchMore, (token: unknown) => searchMore(stringArg(token, "search token")));
  handle(IPC.remotePlaylist, (id: unknown) => {
    const value = stringArg(id, "playlist id");
    if (!/^[\w-]{1,128}$/.test(value)) throw new Error("Expected a playlist id");
    return remotePlaylist(value);
  });
  handle(IPC.artist, (id: unknown) => artist(stringArg(id, "artist id")));
  handle(IPC.home, () => home());
  handle(IPC.radio, (track: unknown) => {
    if (!isTrack(track)) throw new Error("Expected a track");
    return radioFor(track);
  });
  handle(IPC.loudness, async (trackId: unknown) => {
    const [source, videoId] = stringArg(trackId, "track id").split(":");
    if (source !== "youtube" || !videoId) return null;
    const stream = await resolveAudio(videoId).catch(() => null);
    return typeof stream?.loudnessDb === "number" ? stream.loudnessDb : null;
  });
  handle(IPC.quality, async (trackId: unknown) => {
    const [source, videoId] = stringArg(trackId, "track id").split(":");
    if (source !== "youtube" || !videoId) return null;
    const stream = await resolveAudio(videoId).catch(() => null);
    return stream ? { codec: stream.codec, kbps: Math.round(stream.bitrate / 1000), sampleRate: stream.sampleRate, premium: Boolean(stream.premium) } : null;
  });
  handle(IPC.prefetch, async (trackId: unknown) => {
    const [source, videoId] = stringArg(trackId, "track id").split(":");
    if (source === "youtube" && videoId) await resolveAudio(videoId).catch(() => undefined);
  });

  handle(IPC.libraryGet, () => library.snapshot());
  handle(IPC.setLiked, (track: unknown, liked: unknown) => {
    if (!isTrack(track)) throw new Error("Expected a track");
    library.setLiked(track, liked === true);
  });
  handle(IPC.createPlaylist, (name: unknown, tracks: unknown) =>
    library.createPlaylist(stringArg(name, "name").slice(0, 120), tracks === undefined ? [] : tracksArg(tracks)),
  );
  handle(IPC.renamePlaylist, (id: unknown, name: unknown) => library.renamePlaylist(stringArg(id, "playlist id"), stringArg(name, "name").slice(0, 120)));
  handle(IPC.deletePlaylist, (id: unknown) => library.deletePlaylist(stringArg(id, "playlist id")));
  handle(IPC.addToPlaylist, (id: unknown, tracks: unknown) => library.addToPlaylist(stringArg(id, "playlist id"), tracksArg(tracks)));
  handle(IPC.removeFromPlaylist, (id: unknown, itemId: unknown) =>
    library.removeFromPlaylist(stringArg(id, "playlist id"), stringArg(itemId, "item id")),
  );
  handle(IPC.reorderPlaylist, (id: unknown, itemIds: unknown) => {
    if (!Array.isArray(itemIds) || !itemIds.every((x) => typeof x === "string")) throw new Error("Expected item ids");
    library.reorderPlaylist(stringArg(id, "playlist id"), itemIds);
  });
  handle(IPC.recordPlay, (track: unknown, playedMs: unknown) => {
    if (!isTrack(track) || typeof playedMs !== "number") throw new Error("Expected a track and a duration");
    library.recordPlay(track, playedMs);
  });
  handle(IPC.clearHistory, () => library.clearHistory());
  handle(IPC.setAlbumSaved, (album: unknown, saved: unknown) => library.setAlbumSaved(albumArg(album), saved === true));

  handle(IPC.accountsList, () => accounts.list());
  handle(IPC.accountsConnect, (service: unknown) => accounts.connect(serviceArg(service)));
  handle(IPC.accountsCancelConnect, (service: unknown) => accounts.cancelConnect(serviceArg(service)));
  handle(IPC.accountsReopenSignIn, (service: unknown) => accounts.reopenSignIn(serviceArg(service)));
  handle(IPC.accountsDisconnect, (service: unknown, keep: unknown) => accounts.disconnect(serviceArg(service), keep === true));
  handle(IPC.accountsSync, (service: unknown) => accounts.sync(serviceArg(service)));
  handle(IPC.accountsSetPlaylistEnabled, (service: unknown, remoteId: unknown, enabled: unknown) =>
    accounts.setPlaylistEnabled(serviceArg(service), stringArg(remoteId, "playlist id"), enabled === true),
  );
  handle(IPC.accountsSpotifyApp, () => spotifyApp());
  handle(IPC.accountsSetSpotifyApp, (clientId: unknown) => setSpotifyApp(clientId));

  handle(IPC.importFromLink, (url: unknown) => importService.fromLink(stringArg(url, "link").slice(0, 2000)));
  handle(IPC.importPickFile, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose your data export or playlist file",
      properties: ["openFile"],
      filters: [
        { name: "Exports and playlists", extensions: ["zip", "json", "csv", "html"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(IPC.importAnalyze, (path: unknown) => importService.analyze(stringArg(path, "file")));
  handle(IPC.importApply, (token: unknown, choices: unknown) => {
    const c = choices as ExportChoices;
    if (!c || typeof c.history !== "boolean" || !Array.isArray(c.collections) || !c.collections.every((k) => typeof k === "string")) {
      throw new Error("Expected import choices");
    }
    const applied = importService.apply(stringArg(token, "token"), c);
    // new history changes what the home page should show
    if (c.history) void Promise.resolve(applied).then(() => feed.refresh());
    return applied;
  });
  handle(IPC.importList, () => imports.list());
  handle(IPC.importGet, (id: unknown) => imports.get(stringArg(id, "import id")));
  handle(IPC.importChoose, (id: unknown, index: unknown, track: unknown) => {
    if (typeof index !== "number" || (track !== null && !isTrack(track))) throw new Error("Expected a song or nothing");
    imports.choose(stringArg(id, "import id"), index, track);
  });
  handle(IPC.importAcceptSuggestions, (id: unknown) => imports.acceptSuggestions(stringArg(id, "import id")));
  handle(IPC.importFinish, (id: unknown) => imports.finish(stringArg(id, "import id")));
  handle(IPC.importRemove, (id: unknown) => imports.remove(stringArg(id, "import id")));
  handle(IPC.importMatchOne, (source: unknown) => {
    if (!isSourceTrack(source)) throw new Error("Expected a song");
    return matcher.candidates(source);
  });

  handle(IPC.historyInsights, () => history.insights());
  handle(IPC.historyRecent, (since: unknown) => {
    const at = new Date(stringArg(since, "time"));
    if (Number.isNaN(at.getTime())) throw new Error("Expected a time");
    return library.recentPlays(at.toISOString());
  });
  handle(IPC.historyPlaysOf, (trackId: unknown) => library.playsOf(stringArg(trackId, "track id")));
  handle(IPC.historyTopPlaylist, (limit: unknown) => {
    const count = Math.min(200, Math.max(5, Number(limit) || 50));
    const top = history.insights().topSongs.slice(0, count);
    if (top.length === 0) throw new Error("There is no listening history yet");
    const name = `Your top ${top.length}`;
    return imports.create({ name, origin: "encore", destination: { kind: "playlist", name }, tracks: top.map((s) => (s.track ? { ...s.source, track: s.track } : s.source)) });
  });
  handle(IPC.historyRemoveImported, (origin: unknown) => {
    if (!ORIGINS.includes(origin as ImportOrigin)) throw new Error("Unknown service");
    history.removeOrigin(origin as ImportOrigin);
    void feed.refresh();
  });

  handle(IPC.localState, () => local.getState());
  handle(IPC.localTracks, () => local.tracks());
  handle(IPC.localAddFolder, async () => {
    if (!mainWindow) return local.getState();
    const result = await dialog.showOpenDialog(mainWindow, { title: "Add a music folder", properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths[0]) void local.addFolder(result.filePaths[0]);
    return local.getState();
  });
  handle(IPC.localRemoveFolder, (path: unknown) => {
    const folder = stringArg(path, "folder");
    if (local.folders().includes(folder)) local.removeFolder(folder);
    return local.getState();
  });
  handle(IPC.localRescan, () => void local.rescan());
  handle(IPC.localShowInFolder, (trackId: unknown) => {
    const path = local.pathOf(stringArg(trackId, "track id").replace(/^local:/, ""));
    if (path) shell.showItemInFolder(path);
  });

  handle(IPC.lyricsGet, (track: unknown) => {
    if (!isTrack(track)) throw new Error("Expected a track");
    return lyrics.get(track);
  });

  handle(IPC.nowPlayingGet, () => nowPlaying, { fromMini: true });
  handle(IPC.miniOpen, () => mini.open());
  handle(IPC.miniClose, () => mini.close(), { fromMini: true });
  handle(
    IPC.miniExpand,
    () => {
      mini.close();
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    { fromMini: true },
  );
  handle(IPC.miniConfigure, (config: unknown) => {
    const c = config as Partial<MiniConfig> | null;
    mini.configure({
      showOnMinimize: c?.showOnMinimize === true,
      alwaysOnTop: c?.alwaysOnTop !== false,
      corner: MINI_CORNERS.includes(c?.corner as MiniCorner) ? (c!.corner as MiniCorner) : "remember",
    });
  });

  handle(IPC.discordConfigure, (config: unknown) => {
    const c = config as DiscordConfig;
    if (!c || typeof c.enabled !== "boolean" || typeof c.clientId !== "string") throw new Error("Expected Discord settings");
    discordShowWhenPaused = c.showWhenPaused === true;
    discord.configure(c.enabled, /^\d{15,22}$/.test(c.clientId) ? c.clientId : "");
    updatePresence(true);
  });
  handle(IPC.discordStatus, () => discord.getStatus());

  handle(IPC.feedGet, () => feed.get());
  handle(IPC.feedRefresh, () => feed.refresh());
  handle(IPC.feedCheckReleases, () => feed.checkReleasesOnOpen());
  handle(IPC.feedStatus, () => feed.getStatus());
  handle(IPC.feedIsFollowing, (artistId: unknown) => feed.isFollowing(stringArg(artistId, "artist id")));
  handle(IPC.feedFollow, (value: unknown, on: unknown) => {
    feed.follow(artistArg(value), on === true);
    // followed artists are listed in Your Library
    library.refresh();
  });
  handle(IPC.feedSetNotifications, (on: unknown) => feed.setNotifications(on === true));
  handle(IPC.feedMoodMix, (mood: unknown, fresh: unknown) => {
    if (!isMoodId(mood)) throw new Error("Unknown mood");
    return feed.moodMix(mood, fresh === true);
  });

  handle(IPC.scrobbleStatus, () => scrobbler.status());
  handle(IPC.scrobbleConnectListenBrainz, (token: unknown) => scrobbler.connectListenBrainz(stringArg(token, "token").slice(0, 200)));
  handle(IPC.scrobbleConnectLastfm, (apiKey: unknown, secret: unknown) =>
    scrobbler.connectLastfm(stringArg(apiKey, "API key").slice(0, 200), stringArg(secret, "shared secret").slice(0, 200)),
  );
  handle(IPC.scrobbleDisconnect, (service: unknown) => {
    if (!SCROBBLE_SERVICES.includes(service as ScrobbleService)) throw new Error("Unknown service");
    return scrobbler.disconnect(service as ScrobbleService);
  });

  handle(IPC.appOpenDataFolder, () => void shell.openPath(app.getPath("userData")));
  handle(IPC.appConfigure, (config: unknown) => {
    backgroundPlay = (config as { backgroundPlay?: unknown })?.backgroundPlay !== false;
  });
  handle(IPC.appSetTheme, (theme: unknown) => appearance.setTheme(theme));
  handle(IPC.appPickWallpaper, () => (mainWindow ? appearance.pickWallpaper(mainWindow) : null));
  handle(IPC.appClearWallpaper, () => appearance.clearWallpaper());
  handle(IPC.appSetGlobalKeys, (config: unknown) => globalKeys.configure(config));
  handle(IPC.appPauseGlobalKeys, (paused: unknown) => globalKeys.pause(paused === true));
  handle(IPC.appToggleFullScreen, () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });

  handle(IPC.updateStatus, () => updates.get());
  handle(IPC.updateCheck, () => updates.check());
  handle(IPC.updateInstall, () => updates.install());

  handle(IPC.windowGetState, () => (mainWindow ? windowState(mainWindow) : { maximized: false, fullScreen: false, focused: true }));
}

app.on("second-instance", () => showMainWindow());
app.on("before-quit", () => {
  quitting = true;
  tray.hide();
});
app.on("will-quit", () => globalKeys.dispose());

app.whenReady().then(() => {
  // a Store copy already has its package's ID, which its taskbar pin and notifications use
  if (!process.windowsStore) app.setAppUserModelId("app.encore.player");
  const userData = app.getPath("userData");
  configureYouTube({ cacheDir: join(userData, "youtube-cache") });
  db = openDatabase(join(userData, "library.db"));
  appearance = new Appearance({
    db,
    userData,
    onTheme: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setTitleBarOverlay(appearance.titleBarOverlay);
      mainWindow.setBackgroundColor(appearance.backgroundColor);
    },
  });
  library = new Library(db);
  matcher = new Matcher(db, { searchSongs, searchVideos, trackById });
  imports = new ImportManager(db, library, matcher);
  history = new ListeningHistory(db, matcher);
  importService = new ImportService(imports, history, { playlist, album, trackById });
  local = new LocalLibrary(db, join(userData, "artwork"));
  lyrics = new LyricsService(db, { youtubeLyrics: lyricsText, localPath: (id) => local.pathOf(id) });
  feed = new FeedService(db, library, matcher, { searchArtists, artist, radio, songMoods, moodRadio, moodPlaylists, playlist }, notifyReleases);
  accounts = new AccountSync({ db, library, matcher, ...accountConnections(), follow: (artists, lookups) => feed.followFromAccount(artists, lookups) });
  scrobbler = new Scrobbler(db, { lastfm: new Lastfm(), listenbrainz: new ListenBrainz() }, electronVault, (url) => void shell.openExternal(url));
  // only installed copies update themselves, and not ones from the Microsoft Store, which does it;
  // test runs can opt in with ENCORE_UPDATES=1
  const fromStore = process.windowsStore === true;
  updates = new Updater(app.isPackaged && !fromStore && (!process.env.ENCORE_USER_DATA || process.env.ENCORE_UPDATES === "1"), fromStore);
  mini = new MiniPlayer({
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    icon,
    stateFile: join(userData, "mini-player.json"),
    load: (win) => loadRenderer(win, "mini"),
    onVisible: (visible) => send(IPC.miniVisible, visible),
    onReady: (win) => nowPlaying && win.webContents.send(IPC.nowPlayingUpdate, nowPlaying),
  });

  const send = (channel: string, value: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
  };
  library.onChange((snapshot) => send(IPC.libraryChanged, snapshot));
  imports.onChange((jobs) => send(IPC.importsChanged, jobs));
  local.onState((state) => send(IPC.localStateChanged, state));
  discord.onStatus((status) => send(IPC.discordStatusChanged, status));
  feed.onChange((value) => send(IPC.feedChanged, value));
  feed.onStatus((status) => send(IPC.feedStatusChanged, status));
  scrobbler.onStatus((status) => send(IPC.scrobbleStatusChanged, status));
  updates.onStatus((status) => send(IPC.updateStatusChanged, status));
  accounts.onChange((list) => send(IPC.accountsChanged, list));

  handleMediaProtocol({
    localPath: (id) => local.pathOf(id),
    artworkDir: join(userData, "artwork"),
    wallpaperDir: appearance.wallpaperDir,
    wallpaperTypes: WALLPAPER_TYPES,
  });
  registerIpc();
  registerPlayerSync();
  mainWindow = createWindow();
  thumbar = new Thumbar(mainWindow, (command) => mainWindow?.webContents.send(IPC.playerCommandForward, command));
  mini.follow(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
    thumbar = null;
    // the mini player can't play anything on its own
    mini.destroy();
    // nor can the hidden windows accounts use; they'd keep the app from quitting
    accounts.dispose();
    accountWeb?.dispose();
  });
  imports.resume();
  local.start();
  feed.start();
  scrobbler.start();
  updates.start();
  accounts.start();
});

app.on("window-all-closed", () => {
  discord.disconnect();
  feed?.dispose();
  accounts?.dispose();
  scrobbler?.dispose();
  updates?.dispose();
  imports?.dispose();
  local?.dispose();
  db?.close();
  app.quit();
});
