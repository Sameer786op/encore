import { useEffect, useState } from "react";
import type { StreamQuality, Track } from "@shared/types";

// What the song that's playing streams at. YouTube Music gives everyone without
// Premium the same top format, Opus at about 130-160 kbps, and Vyse Music always
// takes the best one on offer; your own files play as they are.

const asked = new Map<string, Promise<StreamQuality | null>>();

function qualityOf(trackId: string): Promise<StreamQuality | null> {
  let pending = asked.get(trackId);
  if (!pending) {
    pending = window.encore.catalog.quality(trackId).catch(() => null);
    asked.set(trackId, pending);
    if (asked.size > 50) asked.delete(asked.keys().next().value!);
  }
  return pending;
}

const CODECS: Record<string, string> = { opus: "Opus", "mp4a.40.2": "AAC", "mp4a.40.5": "HE-AAC" };

/** "Opus · 141 kbps · 48 kHz" */
export function describeQuality(q: StreamQuality): string {
  return [CODECS[q.codec] ?? q.codec, q.kbps > 0 && `${q.kbps} kbps`, q.sampleRate > 0 && `${Number((q.sampleRate / 1000).toFixed(1))} kHz`].filter(Boolean).join(" · ");
}

/** the stream's format, "local" for your own files, or null while it's unknown */
export function useStreamQuality(track: Track | null): StreamQuality | "local" | null {
  const [quality, setQuality] = useState<StreamQuality | null>(null);
  const id = track?.source === "youtube" ? track.id : null;
  useEffect(() => {
    setQuality(null);
    if (!id) return;
    let alive = true;
    void qualityOf(id).then((q) => alive && setQuality(q));
    return () => {
      alive = false;
    };
  }, [id]);
  if (track?.source === "local") return "local";
  return quality;
}
