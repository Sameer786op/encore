import { artistNames } from "@/lib/format";
import { usePlayer } from "./store";
import { currentItem } from "./queue";

// Feeds the Windows media overlay (and the keyboard's media keys) through the
// browser Media Session API, which Electron forwards to the OS.

export function connectMediaSession(): () => void {
  if (!("mediaSession" in navigator)) return () => undefined;
  const session = navigator.mediaSession;
  const player = () => usePlayer.getState();

  session.setActionHandler("play", () => player().togglePlay());
  session.setActionHandler("pause", () => player().togglePlay());
  session.setActionHandler("previoustrack", () => player().previous());
  session.setActionHandler("nexttrack", () => player().next());
  session.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) player().seek(details.seekTime);
  });
  session.setActionHandler("seekbackward", (details) => player().seek(player().position - (details.seekOffset ?? 10)));
  session.setActionHandler("seekforward", (details) => player().seek(player().position + (details.seekOffset ?? 10)));

  let lastTrackId = "";
  let lastPositionUpdate = 0;

  const update = () => {
    const state = player();
    const track = currentItem(state.queue)?.track ?? null;
    if ((track?.id ?? "") !== lastTrackId) {
      lastTrackId = track?.id ?? "";
      session.metadata = track
        ? new MediaMetadata({
            title: track.title,
            artist: artistNames(track.artists),
            album: track.album?.title ?? "",
            artwork: track.artwork ? [{ src: track.artwork, sizes: "544x544" }] : [],
          })
        : null;
    }
    session.playbackState = state.status === "playing" || state.status === "loading" ? "playing" : track ? "paused" : "none";
    // the OS only needs an occasional position sync
    const now = Date.now();
    if (track && state.duration > 0 && now - lastPositionUpdate > 1000) {
      lastPositionUpdate = now;
      try {
        session.setPositionState({ duration: state.duration, position: Math.min(state.position, state.duration), playbackRate: 1 });
      } catch {
        // position briefly past duration while switching songs
      }
    }
  };

  update();
  return usePlayer.subscribe(update);
}
