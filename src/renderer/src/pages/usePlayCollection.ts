import type { Track } from "@shared/types";
import { usePlayer } from "@/player/store";
import type { PlayContext } from "@/player/queue";

/** play / pause / shuffle for a whole album, playlist or list */
export function usePlayCollection(tracks: Track[], context: PlayContext) {
  const contextId = usePlayer((s) => s.queue.context?.id);
  const status = usePlayer((s) => s.status);
  const isThis = !!context.id && contextId === context.id;
  const playing = isThis && (status === "playing" || status === "loading");

  const play = () => {
    const player = usePlayer.getState();
    if (isThis) return player.togglePlay();
    if (player.queue.shuffle) player.toggleShuffle();
    player.playTracks(tracks, 0, context);
  };

  const shuffle = () => {
    const player = usePlayer.getState();
    if (!player.queue.shuffle) player.toggleShuffle();
    player.playTracks(tracks, Math.floor(Math.random() * tracks.length), context);
  };

  return { play, shuffle, playing, loading: isThis && status === "loading" };
}
