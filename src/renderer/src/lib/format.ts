import type { ArtistRef, Track } from "@shared/types";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1 hr 12 min" style total for a list of songs */
export function formatTotal(tracks: Track[]): string {
  const minutes = Math.round(tracks.reduce((sum, t) => sum + t.durationMs, 0) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function artistNames(artists: ArtistRef[] | undefined): string {
  return (artists ?? []).map((a) => a.name).join(", ");
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Late night listening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

export function relativeDate(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "just now", "5 minutes ago", "2 hours ago", then the day */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  if (minutes < 24 * 60) return `${plural(Math.floor(minutes / 60), "hour")} ago`;
  return relativeDate(iso, now).toLowerCase();
}

export function youtubeMusicLink(track: Track): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(track.sourceId)}`;
}
