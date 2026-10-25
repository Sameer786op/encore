import { create } from "zustand";
import type { AlbumSummary, ArtistSummary, LibrarySnapshot, Playlist, Track } from "@shared/types";
import { toast } from "@/ui/toast";
import { plural } from "@/lib/format";

interface LibraryStore {
  snapshot: LibrarySnapshot;
  likedIds: Set<string>;
  savedAlbumIds: Set<string>;
  followedIds: Set<string>;
  loaded: boolean;
  init(): void;
  setLiked(track: Track, liked: boolean): Promise<void>;
  toggleLiked(track: Track): Promise<void>;
  createPlaylist(name: string, tracks?: Track[]): Promise<Playlist>;
  renamePlaylist(id: string, name: string): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  addToPlaylist(playlist: Playlist, tracks: Track[]): Promise<void>;
  removeFromPlaylist(id: string, itemId: string): Promise<void>;
  reorderPlaylist(id: string, itemIds: string[]): Promise<void>;
  recordPlay(track: Track, playedMs: number): void;
  clearHistory(): Promise<void>;
  setAlbumSaved(album: AlbumSummary, saved: boolean): Promise<void>;
  /** follow an artist: they show in Your Library and you hear about their new releases */
  setFollowing(artist: ArtistSummary, on: boolean): Promise<void>;
}

const empty: LibrarySnapshot = { liked: [], playlists: [], history: [], albums: [], artists: [] };

function withSnapshot(snapshot: LibrarySnapshot) {
  return {
    snapshot,
    likedIds: new Set(snapshot.liked.map((l) => l.track.id)),
    savedAlbumIds: new Set(snapshot.albums.map((a) => a.album.id)),
    followedIds: new Set(snapshot.artists.map((a) => a.artist.id)),
    loaded: true,
  };
}

/** a copy of a set with one id added or taken out */
function toggled(ids: Set<string>, id: string, on: boolean): Set<string> {
  const next = new Set(ids);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

let initialized = false;

export const useLibrary = create<LibraryStore>((set, get) => ({
  snapshot: empty,
  likedIds: new Set(),
  savedAlbumIds: new Set(),
  followedIds: new Set(),
  loaded: false,

  init() {
    if (initialized) return;
    initialized = true;
    window.encore.library.onChange((snapshot) => set(withSnapshot(snapshot)));
    void window.encore.library.get().then((snapshot) => set(withSnapshot(snapshot)));
  },

  async setLiked(track, liked) {
    // update right away; the main process confirms with a fresh snapshot
    const likedIds = new Set(get().likedIds);
    if (liked) likedIds.add(track.id);
    else likedIds.delete(track.id);
    set({ likedIds });
    try {
      await window.encore.library.setLiked(track, liked);
    } catch {
      toast("Couldn't update your liked songs", { kind: "error" });
      void window.encore.library.get().then((s) => set(withSnapshot(s)));
    }
  },

  toggleLiked(track) {
    return get().setLiked(track, !get().likedIds.has(track.id));
  },

  async createPlaylist(name, tracks) {
    const playlist = await window.encore.library.createPlaylist(name, tracks);
    toast(tracks?.length ? `Created "${playlist.name}" with ${plural(tracks.length, "song")}` : `Created "${playlist.name}"`);
    return playlist;
  },

  renamePlaylist: (id, name) => window.encore.library.renamePlaylist(id, name),

  async deletePlaylist(id) {
    const name = get().snapshot.playlists.find((p) => p.id === id)?.name;
    await window.encore.library.deletePlaylist(id);
    if (name) toast(`Deleted "${name}"`);
  },

  async addToPlaylist(playlist, tracks) {
    const count = await window.encore.library.addToPlaylist(playlist.id, tracks);
    toast(count === 1 ? `Added to "${playlist.name}"` : `Added ${plural(count, "song")} to "${playlist.name}"`);
  },

  removeFromPlaylist: (id, itemId) => window.encore.library.removeFromPlaylist(id, itemId),
  reorderPlaylist: (id, itemIds) => window.encore.library.reorderPlaylist(id, itemIds),

  recordPlay(track, playedMs) {
    void window.encore.library.recordPlay(track, playedMs).catch(() => undefined);
  },

  clearHistory: () => window.encore.library.clearHistory(),

  async setAlbumSaved(album, saved) {
    set({ savedAlbumIds: toggled(get().savedAlbumIds, album.id, saved) });
    try {
      // just the summary: the songs are fetched again when the album is opened
      const { id, title, artists, year, kind, artwork } = album;
      await window.encore.library.setAlbumSaved({ id, title, artists, year, kind, artwork }, saved);
      toast(saved ? `Saved "${title}" to Your Library` : `Removed "${title}" from Your Library`);
    } catch {
      toast("Couldn't update Your Library", { kind: "error" });
      void window.encore.library.get().then((s) => set(withSnapshot(s)));
    }
  },

  async setFollowing(artist, on) {
    set({ followedIds: toggled(get().followedIds, artist.id, on) });
    try {
      await window.encore.feed.follow({ id: artist.id, name: artist.name, artwork: artist.artwork }, on);
      toast(on ? `Following ${artist.name}. You'll hear about their new releases.` : `Unfollowed ${artist.name}`);
    } catch {
      toast("Couldn't update who you follow", { kind: "error" });
      void window.encore.library.get().then((s) => set(withSnapshot(s)));
    }
  },
}));
