import { Disc3, FolderOpen, Heart, HeartOff, Link, ListEnd, ListPlus, ListStart, MicVocal, Plus, Radio } from "lucide-react";
import type { Track } from "@shared/types";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { youtubeMusicLink } from "@/lib/format";
import type { MenuEntry } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { toast } from "@/ui/toast";

export function addToPlaylistEntries(tracks: Track[]): MenuEntry[] {
  const { snapshot, addToPlaylist } = useLibrary.getState();
  return [
    { label: "New playlist…", icon: Plus, onSelect: () => openModal({ kind: "create-playlist", tracks }) },
    "divider",
    ...snapshot.playlists.map((p) => ({ label: p.name, onSelect: () => void addToPlaylist(p, tracks) })),
  ];
}

export function queueEntries(tracks: Track[], label: string): MenuEntry[] {
  const player = usePlayer.getState();
  return [
    {
      label: "Play next",
      icon: ListStart,
      onSelect: () => {
        player.playNext(tracks);
        toast(tracks.length === 1 ? `"${label}" will play next` : `${label} will play next`);
      },
    },
    {
      label: "Add to queue",
      icon: ListEnd,
      onSelect: () => {
        player.addToQueue(tracks);
        toast(tracks.length === 1 ? `Added "${label}" to the queue` : `Added ${label} to the queue`);
      },
    },
  ];
}

/** the menu for a single song, wherever it appears */
export function trackMenu(track: Track, extras: MenuEntry[] = []): MenuEntry[] {
  const library = useLibrary.getState();
  const liked = library.likedIds.has(track.id);
  const artist = track.artists.find((a) => a.id);
  return [
    ...queueEntries([track], track.title),
    { label: "Start radio", icon: Radio, onSelect: () => void usePlayer.getState().startRadio(track) },
    "divider",
    {
      label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
      icon: liked ? HeartOff : Heart,
      onSelect: () => void library.setLiked(track, !liked),
    },
    { label: "Add to playlist", icon: ListPlus, submenu: addToPlaylistEntries([track]) },
    ...extras,
    "divider",
    ...(track.album?.id ? [{ label: "Go to album", icon: Disc3, onSelect: () => navigate({ name: "album", id: track.album!.id! }) }] : []),
    ...(artist?.id ? [{ label: "Go to artist", icon: MicVocal, onSelect: () => navigate({ name: "artist", id: artist.id! }) }] : []),
    track.source === "local"
      ? { label: "Show in folder", icon: FolderOpen, onSelect: () => void window.encore.local.showInFolder(track.id) }
      : {
          label: "Copy link",
          icon: Link,
          onSelect: () =>
            void navigator.clipboard.writeText(youtubeMusicLink(track)).then(
              () => toast("Link copied"),
              () => toast("Couldn't copy the link", { kind: "error" }),
            ),
        },
  ];
}
