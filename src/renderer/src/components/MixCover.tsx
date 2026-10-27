import { useState } from "react";
import type { DailyMix } from "@shared/types";
import { moodById, type Mood } from "@shared/moods";
import { cn } from "@/lib/cn";
import { MoodShard } from "./MoodPicker";

// A mood mix is the glossy shard in its mood's colours over a dark plate lit
// by them. A daily mix is its lead artist in black and white, lit from behind
// in the mix's own colour, with the mix number set large. Both have grain, like
// the rest of Ember & Moss, and stay dark in both modes: they're pictures.

/** each daily mix's light, starting from the signature ember */
const HUES = [18, 42, 84, 330, 262, 190];

export function mixHue(id: string): number {
  const n = Number(id.replace(/\D/g, "")) || 1;
  return HUES[(n - 1) % HUES.length];
}

/** `live` floats the shard, for the one big cover on the mix's own page */
export function MixCover({ mix, className, live }: { mix: DailyMix; className?: string; live?: boolean }) {
  return mix.mood ? <MoodCover mood={moodById(mix.mood)} className={className} live={live} /> : <DailyMixCover mix={mix} className={className} />;
}

/** the small label in a cover's top corner, after a dot of its colour */
function CoverLabel({ children, color }: { children: string; color: string }) {
  return (
    <div className="absolute left-[7cqw] top-[7cqw] flex items-center gap-[2.6cqw] text-[5.6cqw] font-semibold uppercase tracking-[0.2em] text-snow/80">
      <span className="size-[3.4cqw] rounded-full" style={{ background: color, boxShadow: `0 0 4cqw ${color}` }} />
      {children}
    </div>
  );
}

function MoodCover({ mood, className, live }: { mood: Mood; className?: string; live?: boolean }) {
  const [light, mid, deep] = mood.colors;
  return (
    <div
      className={cn("@container relative isolate shrink-0 overflow-hidden bg-[#0b0a0c]", className)}
      style={{ backgroundImage: `radial-gradient(80% 70% at 82% 22%, ${mid}b3, transparent 70%), radial-gradient(70% 60% at 0% 100%, ${deep}cc, transparent 72%), radial-gradient(50% 40% at 100% 100%, ${light}40, transparent 70%)` }}
    >
      <MoodShard mood={mood} className={cn("absolute right-[2cqw] top-[10cqw] size-[60cqw]", live && "animate-float")} />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.62),transparent_52%)]" />
      <span aria-hidden className="grain absolute inset-0" style={{ opacity: 0.35 }} />
      <CoverLabel color={light}>Mood mix</CoverLabel>
      <div className="absolute inset-x-[7cqw] bottom-[6cqw] font-display text-[15cqw] font-bold leading-[0.92] tracking-[-0.045em] text-snow">{mood.name}</div>
    </div>
  );
}

function DailyMixCover({ mix, className }: { mix: DailyMix; className?: string }) {
  const hue = mixHue(mix.id);
  const photo = mix.artists.find((a) => a.artwork)?.artwork;
  const [shown, setShown] = useState<string>();
  const number = mix.title.match(/\d+$/)?.[0] ?? "";
  const glow = `hsl(${hue} 95% 56%)`;

  return (
    <div className={cn("@container relative isolate shrink-0 overflow-hidden bg-[#101010]", className)}>
      {photo && (
        <img
          src={photo}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && shown !== photo) setShown(photo);
          }}
          onLoad={() => setShown(photo)}
          className={cn("absolute inset-0 size-full object-cover object-[50%_25%] brightness-[0.82] contrast-125 grayscale transition-opacity duration-700", shown === photo ? "opacity-100" : "opacity-0")}
        />
      )}
      {/* the rim light, and a dark floor for the number */}
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(75% 62% at 100% 100%, hsl(${hue} 95% 56% / 0.85), transparent 70%), radial-gradient(52% 42% at 0% 0%, hsl(${(hue + 28) % 360} 90% 62% / 0.22), transparent 70%), linear-gradient(to top, rgb(0 0 0 / 0.66), transparent 55%)` }}
      />
      <span aria-hidden className="grain absolute inset-0" style={{ opacity: 0.35 }} />
      <CoverLabel color={glow}>Daily mix</CoverLabel>
      <div className="absolute bottom-[3cqw] left-[6cqw] font-display text-[36cqw] font-bold leading-[0.85] tracking-[-0.06em] text-snow">{number}</div>
    </div>
  );
}
