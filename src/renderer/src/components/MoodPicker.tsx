import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LoaderCircle, Play, X } from "lucide-react";
import type { DailyMix } from "@shared/types";
import { MOODS, moodById, type Mood } from "@shared/moods";
import { useFeed } from "@/feed/store";
import { navigate, useNav } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { toast } from "@/ui/toast";

// "Start playing music to match your mood": pick a mood and a mix is made of
// your own songs that suit it, with YouTube Music's radio tuned to that mood.

const HIDDEN_KEY = "moodPicker.hiddenOn";
const SPRING = { type: "spring", stiffness: 420, damping: 32 } as const;

function hiddenToday(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === new Date().toDateString();
  } catch {
    return false;
  }
}

/** a soft sphere in the mood's colours, its light slowly drifting */
export function MoodOrb({ mood, index = 0, className }: { mood: Mood; index?: number; className?: string }) {
  const still = useReducedMotion();
  const [light, mid, deep] = mood.colors;
  const drift = (seconds: number, x: string[], y: string[]) => (still ? {} : { animate: { x, y }, transition: { duration: seconds, repeat: Infinity, ease: "easeInOut" as const } });
  return (
    <span
      className={cn("relative block overflow-hidden rounded-full", className)}
      style={{ background: `radial-gradient(circle at 34% 30%, ${light} 0%, ${mid} 50%, ${deep} 100%)` }}
    >
      <motion.span
        className="absolute -left-[20%] -top-[20%] size-[90%] rounded-full"
        style={{ background: `radial-gradient(circle, ${light} 0%, transparent 62%)` }}
        {...drift(9 + (index % 4) * 1.6, ["0%", "34%", "12%", "0%"], ["0%", "22%", "40%", "0%"])}
      />
      <motion.span
        className="absolute -bottom-[25%] -right-[25%] size-[95%] rounded-full opacity-90"
        style={{ background: `radial-gradient(circle, ${deep} 0%, transparent 64%)` }}
        {...drift(11 + (index % 3) * 1.9, ["0%", "-30%", "-8%", "0%"], ["0%", "-18%", "-36%", "0%"])}
      />
      {/* a glassy highlight and a little depth */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle at 30% 22%, rgb(255 255 255 / 0.55), transparent 30%)",
          boxShadow: "inset 0 -10px 18px rgb(0 0 0 / 0.25), inset 0 2px 3px rgb(255 255 255 / 0.4)",
        }}
      />
    </span>
  );
}

function MoodChoice({ mood, index, picked, dimmed, onPick }: { mood: Mood; index: number; picked: boolean; dimmed: boolean; onPick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={picked}
      onClick={onPick}
      className="group flex min-w-[86px] flex-1 cursor-pointer flex-col items-center gap-2.5 rounded-[18px] px-1 pb-1.5 pt-2 outline-none focus-visible:bg-white/[0.07]"
    >
      <span className="relative grid size-[70px] place-items-center">
        {picked && <motion.span layoutId="mood-ring" transition={SPRING} className="absolute -inset-[6px] rounded-full border-2 border-white/90" />}
        <motion.span
          className="size-full rounded-full"
          animate={{ scale: picked ? 1.06 : 1, opacity: dimmed ? 0.55 : 1 }}
          whileHover={{ scale: picked ? 1.08 : 1.05 }}
          whileTap={{ scale: 0.93 }}
          transition={SPRING}
          style={{ boxShadow: picked ? `0 12px 30px -10px ${mood.colors[1]}` : "0 8px 20px -12px rgb(0 0 0 / 0.6)" }}
        >
          <MoodOrb mood={mood} index={index} className="size-full" />
        </motion.span>
      </span>
      <span className={cn("whitespace-nowrap text-[13px] font-semibold transition-colors duration-300", picked ? "text-ink" : "text-ink-2 group-hover:text-ink")}>{mood.name}</span>
    </button>
  );
}

export function MoodPicker() {
  const [hidden, setHidden] = useState(hiddenToday);
  const [picked, setPicked] = useState<Mood | null>(null);
  const building = useFeed((s) => s.moodBuilding);
  const moodMix = useFeed((s) => s.moodMix);

  const play = (mix: DailyMix) => {
    usePlayer.getState().playTracks(mix.tracks, 0, { kind: "mix", label: mix.title, id: mix.id });
    navigate({ name: "mix", id: mix.id });
  };

  const start = async () => {
    if (!picked || building) return;
    try {
      const mix = await moodMix(picked.id);
      // moved on while it was being made: offer it rather than taking over
      if (useNav.getState().route.name === "home") play(mix);
      else toast(`Your ${mix.title} is ready`, { action: { label: "Play", run: () => play(mix) } });
    } catch (error) {
      toast(friendlyError(error, `Couldn't make a ${picked.name} mix right now.`), { kind: "error" });
    }
  };

  const hide = () => {
    try {
      localStorage.setItem(HIDDEN_KEY, new Date().toDateString());
    } catch {
      // still hidden until the app is restarted
    }
    setHidden(true);
  };

  return (
    <AnimatePresence initial={false}>
      {!hidden && (
        <motion.section
          key="moods"
          aria-label="Mood mixes"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.35, ease: [0.32, 0.72, 0, 1] } }}
          transition={{ duration: 0.6, delay: 0.05, ease: [0.32, 0.72, 0, 1] }}
          className="glass relative mt-7 overflow-hidden rounded-[28px]"
        >
          {/* the card takes on the picked mood's colours */}
          <AnimatePresence>
            {picked && (
              <motion.div
                key={picked.id}
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(90% 120% at 12% 0%, ${picked.colors[0]}38, transparent 62%), radial-gradient(80% 120% at 100% 100%, ${picked.colors[2]}55, transparent 60%)`,
                }}
              />
            )}
          </AnimatePresence>

          <div className="relative px-7 pb-6 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-[21px] font-bold tracking-[-0.02em]">Start playing music to match your mood</h2>
                <p className="mt-1 text-[13px] text-ink-2">Made from the songs you play, tuned by YouTube Music.</p>
              </div>
              <button onClick={hide} aria-label="Hide for today" title="Hide for today" className="pressable -mr-2 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-white/[0.08] hover:text-ink">
                <X className="size-[18px]" />
              </button>
            </div>

            <div role="radiogroup" aria-label="Moods" className="-mx-3 mt-4 flex gap-1 overflow-x-auto px-3 py-1.5 scrollbar-none">
              {MOODS.map((mood, i) => (
                <MoodChoice key={mood.id} mood={mood} index={i} picked={picked?.id === mood.id} dimmed={!!picked && picked.id !== mood.id} onPick={() => setPicked(mood)} />
              ))}
            </div>

            <div className="mt-4 flex justify-center">
              <motion.button
                onClick={() => void start()}
                disabled={!picked || !!building}
                whileTap={picked && !building ? { scale: 0.95 } : undefined}
                transition={SPRING}
                className={cn(
                  "inline-flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-full px-7 text-[14.5px] font-semibold transition-[background-color,color,box-shadow,filter] duration-300",
                  picked ? "cursor-pointer bg-white text-bg shadow-[0_10px_26px_-10px_rgb(0_0_0/0.6)] hover:brightness-95" : "bg-white/[0.1] text-ink-3",
                  building && "cursor-default",
                )}
              >
                {building ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" /> Making your {moodById(building).name} mix…
                  </>
                ) : (
                  <>
                    <Play className="size-4" fill="currentColor" strokeWidth={0} /> Start mix
                  </>
                )}
              </motion.button>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
