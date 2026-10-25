import { Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import type { Playlist } from "@shared/types";
import { useLibrary } from "@/library/store";
import { navigate, useNav } from "@/nav/store";
import { usePlayer } from "@/player/store";
import type { MenuEntry } from "@/ui/menu";
import { openModal } from "@/ui/modal";
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
    { label: "Rename", icon: Pencil, onSelect: () => openModal({ kind: "rename-playlist", id: playlist.id, name: playlist.name }) },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => confirmDeletePlaylist(playlist) },
  ];
}
