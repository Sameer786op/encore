import { motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import type { DailyMix } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { navigate } from "@/nav/store";
import { usePlayCollection } from "@/pages/usePlayCollection";
import { formatTotal } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Eyebrow, Glow, Texture, Tile } from "./Tile";

// Daily Mix 1 as a headline: who's in it, over a faint texture of its song titles.

/** "The Weeknd, Dua Lipa and 23 more." from the artists the mix plays most */
export function mixHeadline(mix: DailyMix): string {
  const counts = new Map<string, number>();
  for (const t of mix.tracks) {
    const name = t.artists[0]?.name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (names.length === 0) return mix.description;
  if (names.length === 1) return `${names[0]}.`;
  if (names.length === 2) return `${names[0]} and ${names[1]}.`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more.`;
}

export function MixHeadline({ mix, height, index = 0 }: { mix: DailyMix; height: number; index?: number }) {
  const { play, playing } = usePlayCollection(mix.tracks, { kind: "mix", label: mix.title, id: mix.id });
  const covers = [...new Set(mix.tracks.map((t) => t.artwork).filter((a): a is string => !!a))].slice(0, 4);
  return (
    <Tile index={index} label={mix.title} className="px-6 py-[22px]" style={{ height }}>
      <Glow
        className="ember-only"
        style={{
          background:
            "radial-gradient(90% 120% at 0% 0%, rgb(var(--accent-rgb) / 0.85), rgb(var(--accent-rgb) / 0.45) 25%, rgb(30 10 4 / 0.4) 55%, transparent 75%), linear-gradient(200deg, rgb(109 109 109 / 0.5) -10%, rgb(26 26 26 / 0.5) 30%, rgb(5 5 5 / 0.55) 60%)",
        }}
      />
      <Glow className="moss-only" style={{ background: "radial-gradient(80% 120% at 0% 0%, rgb(255 255 255 / 0.6), transparent 60%), radial-gradient(60% 90% at 100% 100%, rgb(var(--accent-rgb) / 0.12), transparent 70%)" }} />
      <Texture words={mix.tracks.slice(0, 24).map((t) => t.title)} corner="right" />
      <button onClick={() => navigate({ name: "mix", id: mix.id })} aria-label={`Open ${mix.title}`} className="absolute inset-0 cursor-pointer" />

      <div className="pointer-events-none relative">
        <Eyebrow>Made for you · {mix.title}</Eyebrow>
        <h3 className="mt-2 line-clamp-2 max-w-[420px] font-display text-[30px] font-bold leading-[1.04] tracking-[-0.035em]">{mixHeadline(mix)}</h3>
      </div>

      <div className="absolute bottom-[22px] left-6 flex items-center gap-3 text-[12px] font-semibold text-ink-2">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={play}
          aria-label={playing ? `Pause ${mix.title}` : `Play ${mix.title}`}
          className="grid size-[46px] place-items-center rounded-full bg-ink text-bg shadow-[0_10px_26px_rgb(var(--accent-rgb)/0.35)] transition-[filter] hover:brightness-110"
        >
          {playing ? <Pause className="size-[18px]" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 size-[18px]" fill="currentColor" strokeWidth={0} />}
        </motion.button>
        <span>{formatTotal(mix.tracks)} · new every morning</span>
      </div>
      {covers.length > 0 && (
        <div className="pointer-events-none absolute bottom-[22px] right-6 flex">
          {covers.map((src, i) => (
            <Artwork key={src} src={src} className={cn("size-[54px] rounded-[12px] border-2 border-white/[0.12] shadow-[0_8px_20px_rgb(0_0_0/calc(0.4*var(--shadow-k)))] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]", i > 0 && "-ml-[14px]", "group-hover/tile:-translate-y-1")} />
          ))}
        </div>
      )}
    </Tile>
  );
}
