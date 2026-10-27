import { useEffect, useState } from "react";
import type { RecentPlays, Track } from "@shared/types";
import { useLibrary } from "@/library/store";
import { finishRate, statsSince, type FinishRate } from "@/lib/listeningStats";
import { usePlayer } from "@/player/store";
import { bandMeter } from "@/visuals/gl";

export interface HomeStats extends RecentPlays {
  /** when the plays were fetched; the stats count up to here */
  now: Date;
}

/** your own plays since the first of last month, fetched again after each new play */
export function useHomeStats(): HomeStats | null {
  const loaded = useLibrary((s) => s.loaded);
  const latest = useLibrary((s) => s.snapshot.history[0]?.playedAt ?? "");
  const [stats, setStats] = useState<HomeStats | null>(null);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const now = new Date();
    window.encore.history.recent(statsSince(now).toISOString()).then(
      (recent) => alive && setStats({ ...recent, now }),
      () => alive && setStats({ plays: [], tracks: [], now }),
    );
    return () => {
      alive = false;
    };
  }, [loaded, latest]);
  return stats;
}

/** how often you've heard a song to the end: undefined while asking, null if you've never played it */
export function useFinishRate(track: Track | null): FinishRate | null | undefined {
  const latest = useLibrary((s) => s.snapshot.history[0]?.playedAt ?? "");
  const [rate, setRate] = useState<{ id: string; value: FinishRate | null } | null>(null);
  const id = track?.id ?? "";
  const durationMs = track?.durationMs ?? 0;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    window.encore.history.playsOf(id).then(
      (plays) => alive && setRate({ id, value: finishRate(plays, durationMs || usePlayer.getState().duration * 1000) }),
      () => alive && setRate({ id, value: null }),
    );
    return () => {
      alive = false;
    };
  }, [id, durationMs, latest]);
  return rate?.id === id ? rate.value : undefined;
}

export interface Levels {
  bass: number;
  vocals: number;
  /** the bass as the analyser reads it, before spreading: above 0 means sound is getting through */
  energy: number;
}

const SILENT: Levels = { bass: 0, vocals: 0, energy: 0 };
/** the meters read the spectrum in decibels; this spreads what music typically reads over the scale */
const spread = (v: number, quiet: number, loud: number) => Math.min(1, Math.max(0, (v - quiet) / (loud - quiet)));

/** how loud the bass and the vocal range are right now, read from the music as it plays */
export function useLiveLevels(fps = 20): Levels {
  const playing = usePlayer((s) => s.status === "playing");
  const [levels, setLevels] = useState(SILENT);
  useEffect(() => {
    if (!playing) return;
    const bass = bandMeter(30, 250);
    const vocals = bandMeter(300, 3400);
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < 1000 / fps) return;
      last = time;
      const low = bass();
      setLevels({ bass: spread(low, 0.45, 0.95), vocals: spread(vocals(), 0.2, 0.68), energy: low });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, fps]);
  return playing ? levels : SILENT;
}
