import { useState } from "react";
import { motion } from "motion/react";
import { LoaderCircle, Play } from "lucide-react";
import { isMoodId, moodById, MOODS, type Mood } from "@shared/moods";
import { MoodShard, useMoodMix } from "@/components/MoodPicker";
import { cn } from "@/lib/cn";
import { Eyebrow, Glow, Tile } from "./Tile";

// "Match your mood": the shard glows in the mood's colours; the dots switch
// mood, and Start mix makes a mix of your songs that suit it.

const KEY = "home.mood";

function savedMood(): Mood {
  try {
    const id = localStorage.getItem(KEY);
    if (isMoodId(id)) return moodById(id);
  } catch {
    // no saved mood: start with the first
  }
  return MOODS[0];
}

export function MoodTile({ height, index = 0 }: { height: number; index?: number }) {
  const [mood, setMood] = useState(savedMood);
  const { start, building } = useMoodMix();
  const [light, mid, deep] = mood.colors;

  const pick = (next: Mood) => {
    setMood(next);
    try {
      localStorage.setItem(KEY, next.id);
    } catch {
      // remembered until the app restarts
    }
  };

  return (
    <Tile index={index} label="Match your mood" style={{ height }}>
      <Glow className="ember-only" style={{ background: `radial-gradient(70% 70% at 50% 62%, ${mid}f2, ${deep}8c 35%, rgb(20 10 8 / 0.4) 62%, rgb(10 10 11 / 0.55) 85%)` }} />
      <Glow className="moss-only" style={{ background: `radial-gradient(70% 70% at 50% 62%, ${light}cc, ${mid}55 40%, transparent 72%)` }} />

      <div className="absolute left-5 right-4 top-[18px] z-[1]">
        <Eyebrow className="ember:text-snow/60">Match your mood</Eyebrow>
        <div role="radiogroup" aria-label="Moods" className="-ml-[3px] mt-2 flex gap-0.5">
          {MOODS.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={m.id === mood.id}
              aria-label={m.name}
              title={m.name}
              onClick={() => pick(m)}
              className="grid size-[14px] place-items-center rounded-full"
            >
              <span
                className={cn("block size-2 rounded-full transition-transform duration-300", m.id === mood.id ? "scale-125 ring-2 ring-snow/90 ring-offset-1 ring-offset-transparent" : "hover:scale-125")}
                style={{ background: `linear-gradient(135deg, ${m.colors[0]}, ${m.colors[2]})` }}
              />
            </button>
          ))}
        </div>
      </div>

      <MoodShard mood={mood} className="pointer-events-none absolute left-1/2 top-[50%] size-[132px] -translate-x-1/2 -translate-y-1/2 animate-float" />

      <div className="absolute bottom-4 left-5 right-4 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <motion.b key={mood.id} initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.4 }} className="block font-display text-[15px] font-semibold ember:text-snow">
            {mood.name}
          </motion.b>
          <small className="block truncate text-[11px] font-semibold text-ink-3 ember:text-snow/65">From your songs, tuned by YouTube Music</small>
        </div>
        <motion.button
          whileTap={building ? undefined : { scale: 0.94 }}
          onClick={() => void start(mood)}
          disabled={!!building}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-snow px-3.5 text-[12px] font-bold text-[#0b0b0b] shadow-[0_6px_18px_rgb(0_0_0/0.25)] transition-[filter] hover:brightness-95 disabled:cursor-default"
        >
          {building ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3" fill="currentColor" strokeWidth={0} />}
          {building ? "Making…" : "Start mix"}
        </motion.button>
      </div>
    </Tile>
  );
}
