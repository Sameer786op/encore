import { useEffect, useState } from "react";
import type { Lyrics, Track } from "@shared/types";

const cache = new Map<string, Lyrics | null>();
const OFFSETS_KEY = "encore.lyricsOffsets";

export type LyricsState = { status: "loading" } | { status: "ready"; lyrics: Lyrics | null } | { status: "error" };

export function useLyrics(track: Track | null): LyricsState {
  const [state, setState] = useState<LyricsState>(() => (track && cache.has(track.id) ? { status: "ready", lyrics: cache.get(track.id)! } : { status: "loading" }));
  useEffect(() => {
    if (!track) return setState({ status: "ready", lyrics: null });
    if (cache.has(track.id)) return setState({ status: "ready", lyrics: cache.get(track.id)! });
    let alive = true;
    setState({ status: "loading" });
    window.encore.lyrics.get(track).then(
      (lyrics) => {
        cache.set(track.id, lyrics);
        if (alive) setState({ status: "ready", lyrics });
      },
      () => alive && setState({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function readOffsets(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(OFFSETS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** per-song timing nudge in seconds; positive shows lines later */
export function useLyricsOffset(trackId: string | undefined): [number, (value: number) => void] {
  const [offset, setOffset] = useState(() => (trackId ? (readOffsets()[trackId] ?? 0) : 0));
  useEffect(() => setOffset(trackId ? (readOffsets()[trackId] ?? 0) : 0), [trackId]);
  const update = (value: number) => {
    if (!trackId) return;
    const rounded = Math.round(value * 10) / 10;
    setOffset(rounded);
    const all = readOffsets();
    if (rounded === 0) delete all[trackId];
    else all[trackId] = rounded;
    try {
      localStorage.setItem(OFFSETS_KEY, JSON.stringify(all));
    } catch {
      // the nudge just won't be remembered
    }
  };
  return [offset, update];
}
