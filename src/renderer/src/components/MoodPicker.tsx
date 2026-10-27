import { useCallback, useId } from "react";
import type { DailyMix } from "@shared/types";
import { moodById, type Mood } from "@shared/moods";
import { useFeed } from "@/feed/store";
import { navigate, useNav } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { toast } from "@/ui/toast";

// Mood mixes: pick a mood and a mix is made of your own songs that suit it,
// with YouTube Music's radio tuned to that mood. A mood is drawn as the
// Vyse shard in its colours.

function play(mix: DailyMix): void {
  usePlayer.getState().playTracks(mix.tracks, 0, { kind: "mix", label: mix.title, id: mix.id });
  navigate({ name: "mix", id: mix.id });
}

/** makes a mood mix; plays it if you're still on Home when it's ready, otherwise offers it */
export function useMoodMix() {
  const building = useFeed((s) => s.moodBuilding);
  const start = useCallback(async (mood: Mood) => {
    if (useFeed.getState().moodBuilding) return;
    try {
      const mix = await useFeed.getState().moodMix(mood.id);
      // moved on while it was being made: offer it rather than taking over
      if (useNav.getState().route.name === "home") play(mix);
      else toast(`Your ${mix.title} is ready`, { action: { label: "Play", run: () => play(mix) } });
    } catch (error) {
      toast(friendlyError(error, `Couldn't make a ${mood.name} mix right now.`), { kind: "error" });
    }
  }, []);
  return { start, building: building ? moodById(building) : null };
}

/** the shard in a mood's colours; they glide over when the mood changes */
export function MoodShard({ mood, className }: { mood: Mood; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [light, mid, deep] = mood.colors;
  const stop = (color: string) => ({ stopColor: color, transition: "stop-color 0.7s cubic-bezier(0.32, 0.72, 0, 1)" });
  return (
    <svg viewBox="0 0 200 200" aria-hidden className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={stop(light)} />
          <stop offset="0.45" style={stop(mid)} />
          <stop offset="1" style={stop(deep)} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.2" style={stop(light)} />
          <stop offset="1" style={stop(mid)} />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="0.3" cy="0.25" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}s`}>
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <ellipse cx="100" cy="160" rx="70" ry="14" fill="rgb(0 0 0 / 0.35)" filter={`url(#${id}s)`} />
      <path d="M44 52 L92 52 L104 112 L86 150 Z" fill={`url(#${id}a)`} stroke={`url(#${id}a)`} strokeWidth="22" strokeLinejoin="round" />
      <path d="M120 52 L160 52 L122 128 Z" fill={`url(#${id}b)`} stroke={`url(#${id}b)`} strokeWidth="22" strokeLinejoin="round" />
      <circle cx="140" cy="140" r="18" fill={`url(#${id}b)`} />
      <path d="M44 52 L92 52 L104 112 L86 150 Z" fill={`url(#${id}h)`} />
      <circle cx="136" cy="134" r="7" fill="#fff" opacity="0.55" />
    </svg>
  );
}
