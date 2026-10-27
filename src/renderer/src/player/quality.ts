import { useEffect, useState } from "react";
import type { StreamQuality, Track } from "@shared/types";

// What the song that's playing streams at. YouTube Music gives everyone without
// Premium the same top format, Opus at about 130-160 kbps, and Vyse Music always
// takes the best one on offer. With a connected account that has Premium, it's
// Opus or AAC at about 256 kbps. Your own files play as they are.

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

/** "Opus", "AAC" */
export const codecName = (q: StreamQuality): string => CODECS[q.codec] ?? q.codec;

/** "Opus · 141 kbps · 48 kHz", with "· Premium" for YouTube Premium audio */
export function describeQuality(q: StreamQuality): string {
  return [codecName(q), q.kbps > 0 && `${q.kbps} kbps`, q.sampleRate > 0 && `${Number((q.sampleRate / 1000).toFixed(1))} kHz`, q.premium && "Premium"]
    .filter(Boolean)
    .join(" · ");
}

/** what's happening to the sound right now, in a word or two */
export function soundLabel(loading: boolean, pure: boolean, levelling: boolean): string {
  return loading ? "Loading…" : pure ? "Pure sound" : levelling ? "Levelled" : "Original loudness";
}

const loudnessAsked = new Map<string, Promise<number | null>>();

/**
 * how loud the song is mastered, in dB against YouTube's reference level
 * (ReplayGain's opposite for your own files), or null when it isn't known
 */
export function useLoudness(track: Track | null): number | null {
  const [db, setDb] = useState<number | null>(null);
  const id = track?.source === "youtube" ? track.id : null;
  useEffect(() => {
    setDb(null);
    if (!id) return;
    let pending = loudnessAsked.get(id);
    if (!pending) {
      pending = window.encore.catalog.loudness(id).catch(() => null);
      loudnessAsked.set(id, pending);
      if (loudnessAsked.size > 50) loudnessAsked.delete(loudnessAsked.keys().next().value!);
    }
    let alive = true;
    void pending.then((v) => alive && setDb(v));
    return () => {
      alive = false;
    };
  }, [id]);
  if (track?.source === "local") return typeof track.gainDb === "number" ? -track.gainDb : null;
  return db;
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
