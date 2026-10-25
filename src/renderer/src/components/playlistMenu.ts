import { Copy, Pencil, Play, RefreshCw, Shuffle, Trash2, Unlink } from "lucide-react";
import type { Playlist } from "@shared/types";
import { ACCOUNT_NAMES } from "@shared/types";
import { useLibrary } from "@/library/store";
import { navigate, useNav } from "@/nav/store";
import { usePlayer } from "@/player/store";
import type { MenuEntry } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { queueEntries } from "./trackMenu";

export function confirmDeletePlaylist(playlist: Playlist): void {
  openModal({
    kind: "confirm",
    title: "Delete playlist?",
    message: `"${playlist.name}" will be removed from your library. This can't be undone.`,
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => {
      const route = useNav.getState().route;
      if (route.name === "playlist" && route.id === playlist.id) navigate({ name: "library" });
      void useLibrary.getState().deletePlaylist(playlist.id);
    },
  });
}

/** switch a synced playlist's sync off, which takes it out of Your Library */
export function confirmStopSyncing(playlist: Playlist): void {
  const synced = playlist.synced;
  if (!synced) return;
  const service = ACCOUNT_NAMES[synced.service];
  openModal({
    kind: "confirm",
    title: "Stop syncing this playlist?",
    message: `"${playlist.name}" will be removed from Your Library. It stays on ${service}, and you can switch it back on in Settings under Connected accounts.`,
    confirmLabel: "Stop syncing",
    onConfirm: () => {
      const route = useNav.getState().route;
      if (route.name === "playlist" && route.id === playlist.id) navigate({ name: "library" });
      void window.encore.accounts.setPlaylistEnabled(synced.service, synced.remoteId, false);
    },
  });
}

/** a copy of your own, which you can change */
async function copyPlaylist(playlist: Playlist): Promise<void> {
  const copy = await useLibrary.getState().createPlaylist(`${playlist.name} (copy)`, playlist.items.map((i) => i.track));
  toast(`Made "${copy.name}". It's yours to change.`);
  navigate({ name: "playlist", id: copy.id });
}

export function playlistMenu(playlist: Playlist): MenuEntry[] {
  const tracks = playlist.items.map((i) => i.track);
  const context = { kind: "playlist" as const, label: playlist.name, id: playlist.id };
  return [
    ...(tracks.length
      ? [
          { label: "Play", icon: Play, onSelect: () => usePlayer.getState().playTracks(tracks, 0, context) },
          {
            label: "Shuffle play",
            icon: Shuffle,
            onSelect: () => {
              const player = usePlayer.getState();
              if (!player.queue.shuffle) player.toggleShuffle();
              player.playTracks(tracks, Math.floor(Math.random() * tracks.length), context);
            },
          },
          ...queueEntries(tracks, playlist.name),
          "divider" as const,
        ]
      : []),
    ...(playlist.synced
      ? [
          { label: "Sync now", icon: RefreshCw, onSelect: () => void window.encore.accounts.sync(playlist.synced!.service) },
          { label: "Make a copy", icon: Copy, onSelect: () => void copyPlaylist(playlist) },
          { label: "Stop syncing", icon: Unlink, onSelect: () => confirmStopSyncing(playlist) },
        ]
      : [
          { label: "Rename", icon: Pencil, onSelect: () => openModal({ kind: "rename-playlist", id: playlist.id, name: playlist.name }) },
          { label: "Delete", icon: Trash2, danger: true, onSelect: () => confirmDeletePlaylist(playlist) },
        ]),
  ];
}
