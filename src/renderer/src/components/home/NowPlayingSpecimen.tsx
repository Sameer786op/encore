import { useLayoutEffect, useRef, useState } from "react";
import { AudioLines, LoaderCircle, Play, RadioTower } from "lucide-react";
import type { Track } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { ArtistLinks } from "@/components/common";
import { codecName, useLoudness, useStreamQuality } from "@/player/quality";
import { usePlayer } from "@/player/store";
import { useView } from "@/ui/view";
import { Callout, CALLOUT_H, FinishGauge, LeaderLines, leader, Pin, Rings, ScanLine, signed } from "@/components/Specimen";
import { Chip, Glow, Tile } from "./Tile";
import { useLiveLevels } from "./hooks";

// The song that's playing, shown like a specimen under a scanner: the cover
// floats in its rings while a scan line passes over it, with live readings
// pinned to it on leader lines, and how often you hear it to the end.
// With nothing in the queue it shows the song you played last.

const PAD = 30;
/** the room kept on the right for a callout */
const CALLOUT_W = 150;
const GAUGE = 92;

/** the biggest size up to 62px at which the title's longest word, and the whole title in two lines, fit */
function titleSize(title: string, width: number): number {
  const longest = Math.max(1, ...title.split(/\s+/).map((w) => w.length));
  // Sora bold runs at about 0.6em a letter
  return Math.round(Math.max(28, Math.min(62, width / (longest * 0.6), (width * 2) / (title.length * 0.58))));
}

export function NowPlayingSpecimen({ track, live, onResume, height, index = 0 }: { track: Track; live: boolean; onResume: () => void; height: number; index?: number }) {
  const tile = useRef<HTMLElement>(null);
  const bassRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const status = usePlayer((s) => s.status);
  const quality = useStreamQuality(track);
  const loudness = useLoudness(track);
  const levels = useLiveLevels(8);
  const playing = live && status === "playing";

  useLayoutEffect(() => {
    const el = tile.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const size = height >= 300 ? 150 : 132;
  const coverX = Math.round(Math.min(width - 22 - CALLOUT_W - 14 - size, width * 0.58));
  const coverY = Math.round((height - size) / 2);
  const gaugeX = coverX - GAUGE - 22;
  const textWidth = Math.max(150, gaugeX - PAD - 14);
  const dots = [
    { x: coverX + size * 0.8, y: coverY + size * 0.2 },
    { x: coverX + size * 0.72, y: coverY + size * 0.82 },
  ];

  // leader lines from the pins on the cover to the callouts
  const qualityKey = quality === "local" ? "local" : quality ? `${quality.codec}${quality.kbps}` : "";
  useLayoutEffect(() => {
    const paths: string[] = [];
    [live ? bassRef.current : null, streamRef.current].forEach((bubble, i) => {
      if (!bubble || width === 0) return;
      paths.push(leader(dots[i], { x: bubble.offsetLeft, y: bubble.offsetTop + CALLOUT_H / 2 }, "right"));
    });
    setLines(paths);
  }, [width, height, live, qualityKey, coverX, coverY]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = track.title.split(/\s+/);
  const fontSize = titleSize(track.title, textWidth);
  const kHz = quality && quality !== "local" && quality.sampleRate > 0 ? Number((quality.sampleRate / 1000).toFixed(1)) : null;
  const openCover = () => (live ? useView.getState().openFullscreen() : onResume());

  return (
    <Tile ref={tile} index={index} label={live ? "Now playing" : "Last played"} className="h-full" style={{ height }}>
      <Glow
        className="ember-only"
        style={{
          background:
            "radial-gradient(70% 120% at 100% 100%, rgb(255 226 212 / 0.85) 0%, rgb(var(--accent-rgb) / 0.72) 16%, rgb(var(--accent-rgb) / 0.3) 38%, transparent 66%), linear-gradient(155deg, rgb(3 3 3 / 0.55) 35%, rgb(22 22 22 / 0.45) 68%, rgb(94 94 94 / 0.5) 100%)",
        }}
      />
      <Glow className="moss-only" style={{ background: "radial-gradient(60% 90% at 78% 55%, rgb(255 255 255 / 0.8), transparent 70%), radial-gradient(50% 70% at 100% 100%, rgb(160 210 60 / 0.3), transparent 70%)" }} />

      {width > 0 && (
        <>
          {/* the words */}
          <div className="absolute flex flex-col" style={{ left: PAD, top: 26, bottom: 26, width: textWidth }}>
            <span className="glass-control inline-flex max-w-full items-center gap-2.5 self-start whitespace-nowrap rounded-full py-1 pl-1 pr-3.5 text-[12px] font-semibold text-ink-2">
              <b className="shrink-0 rounded-full bg-ink px-2.5 py-1 font-bold text-bg">{live ? "Now playing" : "Last played"}</b>
              <span className="truncate">{!live ? "Pick it back up" : status === "loading" ? "Loading…" : playing ? "Listening live" : "Paused"}</span>
              {live && (status === "loading" || playing) && <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-[var(--ramp-3)]" />}
            </span>
            <h2 key={track.id} className="mt-auto line-clamp-3 font-display font-bold leading-[0.95] tracking-[-0.045em] [overflow-wrap:anywhere]" style={{ fontSize }}>
              {words.map((word, i) => (
                <span key={i} className="inline-block animate-blur-in" style={{ animationDelay: `${0.08 + i * 0.12}s` }}>
                  {word}
                  {i < words.length - 1 && " "}
                </span>
              ))}
            </h2>
            <div className="mt-3 truncate text-[14.5px] font-semibold text-ink-2">
              <ArtistLinks artists={track.artists} />
              {track.album?.title && track.album.title !== track.title && ` · ${track.album.title}`}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {!live && (
                <button onClick={onResume} className="pressable inline-flex h-[28px] items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-bold text-bg hover:brightness-110">
                  <Play className="size-3" fill="currentColor" strokeWidth={0} /> Play
                </button>
              )}
              {quality && quality !== "local" && (
                <Chip>
                  <i className="not-italic text-ink">{codecName(quality)}</i> {quality.kbps} kbps
                </Chip>
              )}
              {kHz && (
                <Chip>
                  <i className="not-italic text-ink">{kHz}</i> kHz
                </Chip>
              )}
              {quality === "local" && <Chip>Your own file</Chip>}
              {track.source === "local" && typeof track.gainDb === "number" ? (
                <Chip title="ReplayGain, from the file's tags">
                  ReplayGain <i className="not-italic text-ink">{signed(track.gainDb)}</i> dB
                </Chip>
              ) : (
                loudness !== null && (
                  <Chip title="How loud the song is mastered, against YouTube's reference level">
                    Loudness <i className="not-italic text-ink">{signed(loudness)}</i> dB
                  </Chip>
                )
              )}
            </div>
          </div>

          <FinishGauge track={track} style={{ left: gaugeX, top: (height - GAUGE) / 2 }} />

          {/* the specimen: rings, the floating cover, the scan line */}
          <Rings x={coverX + size / 2} y={coverY + size / 2} size={size} playing={playing} />
          <button
            onClick={openCover}
            aria-label={live ? "Open the full-screen player" : `Play ${track.title}`}
            className="group/cover absolute z-[1] animate-float overflow-hidden rounded-[20px] shadow-[0_30px_70px_rgb(0_0_0/calc(0.55*var(--shadow-k))),0_0_0_1px_rgb(255_255_255/0.08)]"
            style={{ left: coverX, top: coverY, width: size, height: size }}
          >
            <Artwork src={track.artwork} className="size-full transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/cover:scale-[1.05]" />
            {playing && <ScanLine />}
          </button>
          {dots.map((d, i) => (i === 0 && !live ? null : <Pin key={i} x={d.x} y={d.y} delay={i * 0.6} />))}
          <LeaderLines paths={lines} />

          {live && (
            <Callout
              ref={bassRef}
              delay={0.5}
              style={{ right: 22, top: 28 }}
              icon={<AudioLines className="size-4" />}
              title={`Bass ${levels.bass.toFixed(2)}`}
              note={playing ? "live" : "when it plays"}
            />
          )}
          <Callout
            ref={streamRef}
            delay={0.7}
            style={{ right: 22, bottom: 28 }}
            icon={quality || !live ? <RadioTower className="size-4" /> : <LoaderCircle className="size-4 animate-spin" />}
            title={quality === "local" ? "Your own file" : quality ? `${codecName(quality)} ${quality.kbps} kbps` : "Stream"}
            note={quality === "local" ? "plays as it is" : kHz ? `${kHz} kHz, the best on offer` : "checking…"}
          />
        </>
      )}
    </Tile>
  );
}
