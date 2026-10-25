import type { NowPlaying, PlayerCommand } from "@shared/types";
import { useLibrary } from "@/library/store";
import { useSettings } from "@/settings/store";
import { currentItem } from "./queue";
import { usePlayer } from "./store";

// Shares what's playing with the main process (for the mini player and
// Discord) and carries out the mini player's button presses.

const HEARTBEAT_MS = 5000;

function snapshot(): NowPlaying {
  const s = usePlayer.getState();
  const track = currentItem(s.queue)?.track ?? null;
  return {
    track,
    playing: s.status === "playing" || s.status === "loading",
    position: s.position,
    duration: s.duration,
    liked: track ? useLibrary.getState().likedIds.has(track.id) : false,
    at: Date.now(),
  };
}

function run(command: PlayerCommand): void {
  const player = usePlayer.getState();
  if (command.kind === "toggle") player.togglePlay();
  else if (command.kind === "next") player.next();
  else if (command.kind === "previous") player.previous();
  else if (command.kind === "seek") player.seek(command.seconds);
  else if (command.kind === "like") {
    const track = currentItem(player.queue)?.track;
    if (track) void useLibrary.getState().toggleLiked(track);
  }
}

export function connectPlayerSync(): () => void {
  let last: NowPlaying | null = null;
  const publish = () => {
    last = snapshot();
    window.encore.nowPlaying.publish(last);
  };

  // send on anything a person would notice: a new song, play/pause, a seek, a like
  const changed = () => {
    const next = snapshot();
    if (!last) return publish();
    const expected = last.playing ? last.position + (next.at - last.at) / 1000 : last.position;
    if (
      next.track?.id !== last.track?.id ||
      next.playing !== last.playing ||
      next.liked !== last.liked ||
      Math.abs(next.duration - last.duration) > 1 ||
      Math.abs(next.position - expected) > 2
    ) {
      publish();
    }
  };

  const stopPlayer = usePlayer.subscribe(changed);
  const stopLibrary = useLibrary.subscribe(changed);
  const heartbeat = setInterval(() => usePlayer.getState().status === "playing" && publish(), HEARTBEAT_MS);
  const stopCommands = window.encore.nowPlaying.onCommand(run);

  // the main process needs these settings even before the Settings page is opened
  const pushSettings = () => {
    const { discord, miniPlayer, releaseAlerts } = useSettings.getState();
    void window.encore.discord.configure(discord);
    void window.encore.mini.configure(miniPlayer);
    void window.encore.feed.setNotifications(releaseAlerts);
  };
  pushSettings();
  const stopSettings = useSettings.subscribe((s, before) => {
    if (s.discord !== before.discord || s.miniPlayer !== before.miniPlayer || s.releaseAlerts !== before.releaseAlerts) pushSettings();
  });

  publish();
  return () => {
    stopPlayer();
    stopLibrary();
    stopCommands();
    stopSettings();
    clearInterval(heartbeat);
  };
}
