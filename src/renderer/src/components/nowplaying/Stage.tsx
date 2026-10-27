import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, AudioLines, LoaderCircle, RadioTower } from "lucide-react";
import type { Track } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { LikeButton } from "@/components/common";
import { useLiveLevels } from "@/components/home/hooks";
import { Callout, CALLOUT_H, EASE, FinishGauge, LeaderLines, leader, Pin, Rings, ScanLine, signed } from "@/components/Specimen";
import { navigate } from "@/nav/store";
import { codecName, useLoudness, useStreamQuality } from "@/player/quality";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { useView } from "@/ui/view";
import { artAt } from "@/lib/art";
import { cn } from "@/lib/cn";

// The middle of the full-screen player: the cover as a specimen, floating in
// its rings with a scan line passing over it while it plays, live readings
// pinned to it on leader lines, the Finish-rate gauge, and the song's name
// under it. Everything is placed from the room the stage has, so it follows
// the lyrics and the queue opening and closing beside it. The gauge and the
// readings can be turned off (the Song details pill under the lyrics), leaving
// the cover alone; they fade out together and come back one by one.

/** the room a callout needs beside the cover */
const CALLOUT_W = 172;
const GAUGE = 112;
/** the title and artist under the cover, with the gap above them */
const TITLE = 92;

/** where everything goes on a stage this big; without details there's no gauge or callouts to make room for */
export function stageLayout(width: number, height: number, details = true) {
  const roomy = details && width >= 2 * CALLOUT_W + 250;
  const size = Math.round(Math.max(150, Math.min(330, height - TITLE - 56, roomy ? width - 2 * (CALLOUT_W - 4) : width - 48)));
  const x = Math.round((width - size) / 2);
  const y = Math.round(Math.max(GAUGE * 0.32, (height - size - TITLE) / 2));
  const at = (fx: number, fy: number) => ({ x: x + size * fx, y: y + size * fy });
  // the right-hand callouts start here; the left-hand one ends here
  const right = Math.min(width - CALLOUT_W, x + size + 24);
  const left = Math.max(CALLOUT_W, x - 24);
  return {
    roomy,
    size,
    x,
    y,
    pins: { bass: at(0.76, 0.22), loudness: at(0.18, 0.64), stream: at(0.66, 0.86) },
    right,
    left,
    bassTop: y - 40,
    streamTop: y + size - 6,
    loudnessTop: Math.round(y + size * 0.64 - CALLOUT_H / 2),
    gauge: details && x >= GAUGE + 16 ? { left: Math.max(0, x - GAUGE - 26), top: Math.round(y - GAUGE * 0.32) } : null,
  };
}

export function Stage({ track }: { track: Track }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const status = usePlayer((s) => s.status);
  const pure = useSettings((s) => s.pureSound);
  const levelling = useSettings((s) => s.levelling);
  const details = useSettings((s) => s.songDetails);
  const quality = useStreamQuality(track);
  const loudness = useLoudness(track);
  const levels = useLiveLevels(8);
  const playing = status === "playing";
  // the cover leans back while paused and springs forward when the music starts, like Apple Music
  const forward = playing || status === "loading";

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom((r) => (r.width === el.clientWidth && r.height === el.clientHeight ? r : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const at = stageLayout(room.width, room.height, details);
  const kHz = quality && quality !== "local" && quality.sampleRate > 0 ? Number((quality.sampleRate / 1000).toFixed(1)) : null;
  const src = track.artwork ? artAt(track.artwork, 1000) : undefined;
  const lines = at.roomy
    ? [
        leader(at.pins.bass, { x: at.right, y: at.bassTop + CALLOUT_H / 2 }, "right"),
        leader(at.pins.stream, { x: at.right, y: at.streamTop + CALLOUT_H / 2 }, "right"),
        ...(loudness !== null ? [leader(at.pins.loudness, { x: at.left, y: at.loudnessTop + CALLOUT_H / 2 }, "left")] : []),
      ]
    : [];
  const openArtist = (id: string) => {
    useView.getState().closeFullscreen();
    navigate({ name: "artist", id });
  };

  return (
    <div ref={box} className="relative h-full min-w-0 flex-1">
      {/* for the smoke test: sound is reaching the analyser */}
      <span hidden data-energy={levels.energy.toFixed(3)} />
      {room.width > 0 && (
        <>
          <Rings x={at.x + at.size / 2} y={at.y + at.size / 2} size={at.size} playing={playing} />

          <motion.div
            className="absolute z-[1]"
            style={{ left: at.x, top: at.y, width: at.size, height: at.size }}
            animate={{ scale: forward ? 1 : 0.86 }}
            transition={{ type: "spring", stiffness: 210, damping: 22, mass: 0.9 }}
          >
            <div
              className={cn(
                "relative size-full animate-float overflow-hidden rounded-[22px] transition-shadow duration-700",
                forward
                  ? "shadow-[0_40px_90px_-20px_rgb(0_0_0/calc(0.75*var(--shadow-k))),0_0_0_1px_rgb(255_255_255/0.08)]"
                  : "shadow-[0_16px_40px_-16px_rgb(0_0_0/calc(0.6*var(--shadow-k))),0_0_0_1px_rgb(255_255_255/0.08)]",
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={src ?? track.id}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 180, damping: 24 }}
                  className="absolute inset-0"
                >
                  <Artwork src={src} alt={track.title} className="size-full" />
                </motion.div>
              </AnimatePresence>
              {playing && <ScanLine height={Math.round(at.size * 0.13)} />}
            </div>
          </motion.div>

          <AnimatePresence>
            {details && (
              <motion.div
                key="details"
                className="pointer-events-none absolute inset-0 z-[2]"
                exit={{ opacity: 0, filter: "blur(6px)" }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                {at.gauge && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.9, delay: 0.35, ease: EASE }}
                    className="pointer-events-auto absolute"
                    style={{ ...at.gauge, width: GAUGE, height: GAUGE }}
                  >
                    <FinishGauge track={track} size={GAUGE} style={{ left: 0, top: 0 }} />
                  </motion.div>
                )}
                {at.roomy && (
                  <>
                    <Pin x={at.pins.bass.x} y={at.pins.bass.y} />
                    <Pin x={at.pins.stream.x} y={at.pins.stream.y} delay={1} />
                    {loudness !== null && <Pin x={at.pins.loudness.x} y={at.pins.loudness.y} delay={0.5} />}
                    <LeaderLines paths={lines} />
                    <Callout
                      delay={0.45}
                      style={{ left: at.right, top: at.bassTop }}
                      icon={<AudioLines className="size-4" />}
                      title={`Bass ${levels.bass.toFixed(2)}`}
                      note={playing ? "live, as it plays" : "when it plays"}
                    />
                    {loudness !== null && (
                      <Callout
                        delay={0.6}
                        style={{ right: room.width - at.left, top: at.loudnessTop }}
                        icon={<Activity className="size-4" />}
                        title={`Loudness ${signed(loudness)} dB`}
                        note={!pure && levelling ? "levelled for you" : "as it was mastered"}
                      />
                    )}
                    <Callout
                      delay={0.75}
                      style={{ left: at.right, top: at.streamTop }}
                      icon={quality ? <RadioTower className="size-4" /> : <LoaderCircle className="size-4 animate-spin" />}
                      title={quality === "local" ? "Your own file" : quality ? `${codecName(quality)} ${quality.kbps} kbps` : "Stream"}
                      note={quality === "local" ? "plays as it is" : kHz ? `${kHz} kHz stream` : "checking…"}
                    />
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* the song */}
          <div className="absolute text-center" style={{ left: at.x, top: at.y + at.size + 30, width: at.size }}>
            <div className="flex items-center justify-center gap-2">
              <h2 key={track.id} title={track.title} className="min-w-0 animate-blur-in truncate font-display text-[26px] font-bold leading-tight tracking-[-0.035em]">
                {track.title}
              </h2>
              <LikeButton track={track} size="size-5" className="shrink-0 text-ink-2" />
            </div>
            <div className="mt-1 truncate text-[14.5px] font-semibold text-ink-2">
              {track.artists.map((artist, i) => (
                <Fragment key={i}>
                  {i > 0 && ", "}
                  {artist.id ? (
                    <button onClick={() => openArtist(artist.id!)} className="transition-colors hover:text-ink hover:underline hover:underline-offset-2">
                      {artist.name}
                    </button>
                  ) : (
                    artist.name
                  )}
                </Fragment>
              ))}
              {track.album?.title && track.album.title !== track.title && <span className="text-ink-3"> · {track.album.title}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
