import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type {
  AccountStatus,
  DiscordStatus,
  EncoreApi,
  FeedStatus,
  HomeFeed,
  ImportJob,
  LibrarySnapshot,
  LocalScanState,
  NowPlaying,
  PlayerCommand,
  ScrobbleStatus,
  UpdateStatus,
  WindowState,
} from "@shared/types";
import { IPC } from "@shared/ipc";
import type { GlobalCommand } from "@shared/shortcuts";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: EncoreApi = {
  catalog: {
    search: (query) => ipcRenderer.invoke(IPC.search, query),
    searchKind: (query, kind) => ipcRenderer.invoke(IPC.searchKind, query, kind),
    suggestions: (query) => ipcRenderer.invoke(IPC.suggestions, query),
    album: (id) => ipcRenderer.invoke(IPC.album, id),
    artist: (id) => ipcRenderer.invoke(IPC.artist, id),
    home: () => ipcRenderer.invoke(IPC.home),
    searchMore: (token) => ipcRenderer.invoke(IPC.searchMore, token),
    playlist: (id) => ipcRenderer.invoke(IPC.remotePlaylist, id),
    radio: (track) => ipcRenderer.invoke(IPC.radio, track),
    prefetch: (trackId) => ipcRenderer.invoke(IPC.prefetch, trackId),
    loudness: (trackId) => ipcRenderer.invoke(IPC.loudness, trackId),
    quality: (trackId) => ipcRenderer.invoke(IPC.quality, trackId),
  },
  library: {
    get: () => ipcRenderer.invoke(IPC.libraryGet),
    onChange: (listener) => subscribe<LibrarySnapshot>(IPC.libraryChanged, listener),
    setLiked: (track, liked) => ipcRenderer.invoke(IPC.setLiked, track, liked),
    createPlaylist: (name, tracks) => ipcRenderer.invoke(IPC.createPlaylist, name, tracks),
    renamePlaylist: (id, name) => ipcRenderer.invoke(IPC.renamePlaylist, id, name),
    deletePlaylist: (id) => ipcRenderer.invoke(IPC.deletePlaylist, id),
    addToPlaylist: (id, tracks) => ipcRenderer.invoke(IPC.addToPlaylist, id, tracks),
    removeFromPlaylist: (id, itemId) => ipcRenderer.invoke(IPC.removeFromPlaylist, id, itemId),
    reorderPlaylist: (id, itemIds) => ipcRenderer.invoke(IPC.reorderPlaylist, id, itemIds),
    recordPlay: (track, playedMs) => ipcRenderer.invoke(IPC.recordPlay, track, playedMs),
    clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
    setAlbumSaved: (album, saved) => ipcRenderer.invoke(IPC.setAlbumSaved, album, saved),
  },
  imports: {
    fromLink: (url) => ipcRenderer.invoke(IPC.importFromLink, url),
    pickFile: () => ipcRenderer.invoke(IPC.importPickFile),
    // dropped files only reveal their path through this helper
    pathForFile: (file) => webUtils.getPathForFile(file),
    analyzeExport: (path) => ipcRenderer.invoke(IPC.importAnalyze, path),
    applyExport: (token, choices) => ipcRenderer.invoke(IPC.importApply, token, choices),
    list: () => ipcRenderer.invoke(IPC.importList),
    get: (id) => ipcRenderer.invoke(IPC.importGet, id),
    onChange: (listener) => subscribe<ImportJob[]>(IPC.importsChanged, listener),
    choose: (jobId, index, track) => ipcRenderer.invoke(IPC.importChoose, jobId, index, track),
    acceptSuggestions: (jobId) => ipcRenderer.invoke(IPC.importAcceptSuggestions, jobId),
    finish: (jobId) => ipcRenderer.invoke(IPC.importFinish, jobId),
    remove: (jobId) => ipcRenderer.invoke(IPC.importRemove, jobId),
    matchOne: (source) => ipcRenderer.invoke(IPC.importMatchOne, source),
  },
  history: {
    insights: () => ipcRenderer.invoke(IPC.historyInsights),
    recent: (since) => ipcRenderer.invoke(IPC.historyRecent, since),
    playsOf: (trackId) => ipcRenderer.invoke(IPC.historyPlaysOf, trackId),
    playlistFromTopSongs: (limit) => ipcRenderer.invoke(IPC.historyTopPlaylist, limit),
    removeImported: (origin) => ipcRenderer.invoke(IPC.historyRemoveImported, origin),
  },
  local: {
    state: () => ipcRenderer.invoke(IPC.localState),
    onState: (listener) => subscribe<LocalScanState>(IPC.localStateChanged, listener),
    tracks: () => ipcRenderer.invoke(IPC.localTracks),
    addFolder: () => ipcRenderer.invoke(IPC.localAddFolder),
    removeFolder: (path) => ipcRenderer.invoke(IPC.localRemoveFolder, path),
    rescan: () => ipcRenderer.invoke(IPC.localRescan),
    showInFolder: (trackId) => ipcRenderer.invoke(IPC.localShowInFolder, trackId),
  },
  lyrics: {
    get: (track) => ipcRenderer.invoke(IPC.lyricsGet, track),
  },
  nowPlaying: {
    publish: (state) => ipcRenderer.send(IPC.nowPlayingPublish, state),
    onUpdate: (listener) => subscribe<NowPlaying>(IPC.nowPlayingUpdate, listener),
    get: () => ipcRenderer.invoke(IPC.nowPlayingGet),
    command: (command) => ipcRenderer.send(IPC.playerCommand, command),
    onCommand: (listener) => subscribe<PlayerCommand>(IPC.playerCommandForward, listener),
  },
  mini: {
    open: () => ipcRenderer.invoke(IPC.miniOpen),
    close: () => ipcRenderer.invoke(IPC.miniClose),
    expand: () => ipcRenderer.invoke(IPC.miniExpand),
    configure: (config) => ipcRenderer.invoke(IPC.miniConfigure, config),
    onVisible: (listener) => subscribe<boolean>(IPC.miniVisible, listener),
  },
  discord: {
    configure: (config) => ipcRenderer.invoke(IPC.discordConfigure, config),
    status: () => ipcRenderer.invoke(IPC.discordStatus),
    onStatus: (listener) => subscribe<DiscordStatus>(IPC.discordStatusChanged, listener),
  },
  feed: {
    get: () => ipcRenderer.invoke(IPC.feedGet),
    refresh: () => ipcRenderer.invoke(IPC.feedRefresh),
    checkReleases: () => ipcRenderer.invoke(IPC.feedCheckReleases),
    onChange: (listener) => subscribe<HomeFeed>(IPC.feedChanged, listener),
    status: () => ipcRenderer.invoke(IPC.feedStatus),
    onStatus: (listener) => subscribe<FeedStatus>(IPC.feedStatusChanged, listener),
    isFollowing: (artistId) => ipcRenderer.invoke(IPC.feedIsFollowing, artistId),
    follow: (artist, on) => ipcRenderer.invoke(IPC.feedFollow, artist, on),
    onOpenAlbum: (listener) => subscribe<string>(IPC.feedOpenAlbum, listener),
    setNotifications: (on) => ipcRenderer.invoke(IPC.feedSetNotifications, on),
    moodMix: (mood, fresh) => ipcRenderer.invoke(IPC.feedMoodMix, mood, fresh),
  },
  accounts: {
    list: () => ipcRenderer.invoke(IPC.accountsList),
    onChange: (listener) => subscribe<AccountStatus[]>(IPC.accountsChanged, listener),
    connect: (service) => ipcRenderer.invoke(IPC.accountsConnect, service),
    cancelConnect: (service) => ipcRenderer.invoke(IPC.accountsCancelConnect, service),
    reopenSignIn: (service) => ipcRenderer.invoke(IPC.accountsReopenSignIn, service),
    disconnect: (service, keepPlaylists) => ipcRenderer.invoke(IPC.accountsDisconnect, service, keepPlaylists),
    sync: (service) => ipcRenderer.invoke(IPC.accountsSync, service),
    setPlaylistEnabled: (service, remoteId, enabled) => ipcRenderer.invoke(IPC.accountsSetPlaylistEnabled, service, remoteId, enabled),
  },
  scrobble: {
    status: () => ipcRenderer.invoke(IPC.scrobbleStatus),
    onStatus: (listener) => subscribe<ScrobbleStatus>(IPC.scrobbleStatusChanged, listener),
    played: (track, startedAt, listenedMs) => ipcRenderer.send(IPC.scrobblePlayed, track, startedAt, listenedMs),
    connectListenBrainz: (token) => ipcRenderer.invoke(IPC.scrobbleConnectListenBrainz, token),
    connectLastfm: (apiKey, secret) => ipcRenderer.invoke(IPC.scrobbleConnectLastfm, apiKey, secret),
    disconnect: (service) => ipcRenderer.invoke(IPC.scrobbleDisconnect, service),
  },
  app: {
    openDataFolder: () => ipcRenderer.invoke(IPC.appOpenDataFolder),
    toggleFullScreen: () => ipcRenderer.invoke(IPC.appToggleFullScreen),
    configure: (config) => ipcRenderer.invoke(IPC.appConfigure, config),
    setTheme: (theme) => ipcRenderer.invoke(IPC.appSetTheme, theme),
    pickWallpaper: () => ipcRenderer.invoke(IPC.appPickWallpaper),
    clearWallpaper: () => ipcRenderer.invoke(IPC.appClearWallpaper),
    setGlobalKeys: (config) => ipcRenderer.invoke(IPC.appSetGlobalKeys, config),
    pauseGlobalKeys: (paused) => ipcRenderer.invoke(IPC.appPauseGlobalKeys, paused),
    onGlobalCommand: (listener) => subscribe<GlobalCommand>(IPC.appGlobalCommand, listener),
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updateStatus),
    onStatus: (listener) => subscribe<UpdateStatus>(IPC.updateStatusChanged, listener),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
  },
  window: {
    getState: () => ipcRenderer.invoke(IPC.windowGetState),
    onState: (listener) => subscribe<WindowState>(IPC.windowState, listener),
  },
};

contextBridge.exposeInMainWorld("encore", api);
