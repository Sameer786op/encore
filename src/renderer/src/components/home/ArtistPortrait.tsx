import { useState } from "react";
import type { ArtistSummary } from "@shared/types";
import { navigate } from "@/nav/store";
import { artAt } from "@/lib/art";
import { plural } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Eyebrow, Tile } from "./Tile";

// An artist in black and white, lit from behind: an ember rim in Ember, a
// moss-green one in Moss. Home shows your top artist; the full-screen player
// shows whoever you're listening to.

export function Portrait({
  name,
  artwork,
  eyebrow,
  line,
  badge,
  label,
  onOpen,
  className,
  style,
  index = 0,
}: {
  name: string;
  artwork?: string;
  eyebrow: string;
  line?: string;
  badge?: string | null;
  label: string;
  onOpen?: () => void;
  className?: string;
  style?: React.CSSProperties;
  index?: number;
}) {
  const [loaded, setLoaded] = useState<string>();
  const src = artwork ? artAt(artwork, 900) : undefined;

  return (
    <Tile index={index} label={label} className={className} style={style}>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(src)}
          ref={(img) => void (img?.complete && img.naturalWidth > 0 && loaded !== src && setLoaded(src))}
          className={cn(
            "absolute inset-0 -z-[2] size-full object-cover object-[50%_22%] brightness-90 contrast-125 grayscale transition-[opacity,scale] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/tile:scale-[1.04]",
            loaded === src ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <span aria-hidden className="absolute inset-0 -z-[2] grid place-items-center bg-[#151515] font-display text-[120px] font-bold text-snow/10">
          {name.slice(0, 1)}
        </span>
      )}
      {/* the rim light and a dark floor for the words */}
      <span aria-hidden className="ember-only absolute inset-0 -z-[1] bg-[radial-gradient(80%_60%_at_100%_100%,rgb(var(--accent-rgb)/0.85),transparent_70%),linear-gradient(180deg,rgb(0_0_0/0.05)_40%,rgb(0_0_0/0.85))]" />
      <span aria-hidden className="moss-only absolute inset-0 -z-[1] bg-[radial-gradient(80%_60%_at_100%_100%,rgb(150_210_40/0.75),transparent_70%),linear-gradient(180deg,transparent_45%,rgb(20_24_12/0.75))]" />

      {onOpen && <button onClick={onOpen} aria-label={`Open ${name}`} className="absolute inset-0 z-[1] cursor-pointer" />}
      {badge && (
        <span className="absolute right-[18px] top-[18px] rounded-full bg-black/35 px-3 py-1.5 text-[11.5px] font-semibold text-snow shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] backdrop-blur-[10px]">{badge}</span>
      )}
      <div className="pointer-events-none absolute bottom-5 left-[22px] right-[22px] text-snow">
        <Eyebrow className="text-snow/60">{eyebrow}</Eyebrow>
        <h2 className="mb-0.5 mt-1.5 truncate font-display text-[34px] font-bold leading-none tracking-[-0.04em]">{name}</h2>
        {line && <span className="block truncate text-[12.5px] font-semibold text-snow/70">{line}</span>}
      </div>
    </Tile>
  );
}

export function ArtistPortrait({ artist, playsThisWeek, songs, height, index = 0 }: { artist: ArtistSummary; playsThisWeek: number; songs: string[]; height: number; index?: number }) {
  const line = songs.length === 0 ? (artist.subtitle ?? "Your most played artist") : songs.length <= 2 ? songs.join(" and ") : `${songs.slice(0, 2).join(", ")} and ${songs.length - 2} more`;
  return (
    <Portrait
      name={artist.name}
      artwork={artist.artwork}
      eyebrow="Top artist"
      line={line}
      badge={playsThisWeek > 0 ? `${plural(playsThisWeek, "play")} this week` : null}
      label={`Top artist: ${artist.name}`}
      onOpen={() => navigate({ name: "artist", id: artist.id })}
      className="h-full"
      style={{ height }}
      index={index}
    />
  );
}
