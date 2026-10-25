import { create } from "zustand";
import type { LibrarySnapshot, Playlist, Track } from "@shared/types";
import { toast } from "@/ui/toast";
import { plural } from "@/lib/format";

interface LibraryStore {
  snapshot: LibrarySnapshot;
  likedIds: Set<string>;
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
}

const empty: LibrarySnapshot = { liked: [], playlists: [], history: [] };

function withSnapshot(snapshot: LibrarySnapshot) {
  return { snapshot, likedIds: new Set(snapshot.liked.map((l) => l.track.id)), loaded: true };
}

let initialized = false;

export const useLibrary = create<LibraryStore>((set, get) => ({
  snapshot: empty,
  likedIds: new Set(),
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
}));
