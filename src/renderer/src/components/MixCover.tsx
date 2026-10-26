import { useState } from "react";
import type { DailyMix } from "@shared/types";
import { moodById, type Mood } from "@shared/moods";
import { cn } from "@/lib/cn";

// Each daily mix gets its own colour: the lead artist's photo is toned into
// it, with the mix number set large over the bottom. A mood mix wears its
// mood's colours instead, with the mood's name.

const HUES = [262, 328, 18, 158, 204, 44];

export function mixHue(id: string): number {
  const n = Number(id.replace(/\D/g, "")) || 1;
  return HUES[(n - 1) % HUES.length];
}

export function MixCover({ mix, className }: { mix: DailyMix; className?: string }) {
  return mix.mood ? <MoodCover mood={moodById(mix.mood)} className={className} /> : <DailyMixCover mix={mix} className={className} />;
}

function MoodCover({ mood, className }: { mood: Mood; className?: string }) {
  const [light, mid, deep] = mood.colors;
  return (
    <div className={cn("@container relative shrink-0 overflow-hidden", className)} style={{ background: `linear-gradient(150deg, ${mid}, ${deep})` }}>
      <span className="absolute -right-[16cqw] -top-[14cqw] size-[84cqw] rounded-full" style={{ background: `radial-gradient(circle at 36% 36%, ${light}, ${mid} 52%, transparent 71%)` }} />
      <span className="absolute -bottom-[34cqw] -left-[22cqw] size-[82cqw] rounded-full" style={{ background: `radial-gradient(circle, ${light}99, transparent 64%)` }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${deep}e6, ${deep}26 55%, transparent)` }} />
      <div className="absolute left-[7cqw] top-[7cqw] text-[6.5cqw] font-bold uppercase tracking-[0.22em] text-snow/90">Mood mix</div>
      <div className="absolute inset-x-[6cqw] bottom-[6cqw] font-display text-[16cqw] font-extrabold leading-[0.92] tracking-tight text-snow drop-shadow-lg">{mood.name}</div>
    </div>
  );
}

function DailyMixCover({ mix, className }: { mix: DailyMix; className?: string }) {
  const hue = mixHue(mix.id);
  const photo = mix.artists.find((a) => a.artwork)?.artwork;
  const [shown, setShown] = useState<string>();
  const number = mix.title.match(/\d+$/)?.[0] ?? "";

  return (
    <div
      className={cn("@container relative shrink-0 overflow-hidden", className)}
      style={{ background: `linear-gradient(150deg, hsl(${hue} 75% 62%), hsl(${(hue + 36) % 360} 70% 28%))` }}
    >
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
          className={cn("absolute inset-0 size-full object-cover mix-blend-luminosity transition-opacity duration-700", shown === photo ? "opacity-75" : "opacity-0")}
        />
      )}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to top, hsl(${hue} 70% 18% / 0.92), hsl(${hue} 70% 30% / 0.15) 55%, transparent)` }} />
      <div className="absolute left-[7cqw] top-[7cqw] text-[6.5cqw] font-bold uppercase tracking-[0.22em] text-snow/90">Daily mix</div>
      <div className="absolute bottom-[4cqw] left-[6cqw] font-display text-[34cqw] font-extrabold leading-[0.85] tracking-tight text-snow drop-shadow-lg">{number}</div>
    </div>
  );
}
