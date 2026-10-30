import type { NowPlaying } from "@shared/types";

const LISTENING = 2;
/** show the song title (details) as the headline in Discord's member list */
const SHOW_DETAILS = 2;
const JAM_NOTE = " · in a Jam";

/** Discord wants 2-128 characters in text fields */
function field(text: string | undefined, fallback: string): string {
  const value = (text ?? "").trim() || fallback;
  return (value.length < 2 ? `${value} ` : value).slice(0, 128);
}

/** the "Listening to" activity for the song that's playing, or null to clear it */
export function buildActivity(state: NowPlaying, options: { showWhenPaused: boolean }, now = Date.now()): Record<string, unknown> | null {
  const track = state.track;
  if (!track) return null;
  if (!state.playing && !options.showWhenPaused) return null;

  const artwork = track.artwork?.startsWith("https://") && track.artwork.length <= 256 ? track.artwork : undefined;
  const artists = field(track.artists.map((a) => a.name).join(", "), "Unknown artist");
  const activity: Record<string, unknown> = {
    type: LISTENING,
    status_display_type: SHOW_DETAILS,
    details: field(track.title, "Unknown song"),
    // no names or codes from the Jam, just that there is one
    state: state.jam === true ? `${artists.slice(0, 128 - JAM_NOTE.length)}${JAM_NOTE}` : artists,
    assets: {
      ...(artwork ? { large_image: artwork, large_text: field(track.album?.title ?? track.title, "Vyse Music") } : {}),
      ...(state.playing ? {} : { small_text: "Paused" }),
    },
    instance: false,
  };

  if (state.playing && state.duration > 0) {
    // Discord counts in real time, so a sped-up or slowed song is stretched to match
    const rate = state.rate || 1;
    const position = state.position + Math.max(0, (now - state.at) / 1000) * rate;
    const start = Math.round(now - (position / rate) * 1000);
    activity.timestamps = { start, end: Math.round(start + (state.duration / rate) * 1000) };
  }
  if (track.source === "youtube") {
    activity.buttons = [{ label: "Listen on YouTube Music", url: `https://music.youtube.com/watch?v=${encodeURIComponent(track.sourceId)}` }];
  }
  return activity;
}

/** only talk to Discord when something a person would notice changed */
export function presenceKey(state: NowPlaying, now = Date.now()): string {
  if (!state.track) return "none";
  const rate = state.rate || 1;
  const position = state.playing ? state.position + ((now - state.at) / 1000) * rate : state.position;
  // the start time, to the nearest few seconds, catches seeks without reacting to drift
  const start = state.playing ? Math.round((now / 1000 - position / rate) / 3) : "paused";
  return `${state.track.id}|${state.playing}|${start}|${state.jam === true}`;
}
