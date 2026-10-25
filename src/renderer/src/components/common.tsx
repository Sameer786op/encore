import { Fragment, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Heart, LoaderCircle, Pause, Play, Shuffle } from "lucide-react";
import type { ArtistRef, Track } from "@shared/types";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { cn } from "@/lib/cn";

/** a soft spring for small things that pop: hearts, knobs, badges */
export const SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;

export function ArtistLinks({ artists, className }: { artists: ArtistRef[]; className?: string }) {
  if (artists.length === 0) return <span className={className}>Unknown artist</span>;
  return (
    <span className={cn("truncate", className)}>
      {artists.map((a, i) => (
        <Fragment key={`${a.id ?? a.name}-${i}`}>
          {i > 0 && ", "}
          {a.id ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: "artist", id: a.id! });
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="transition-colors hover:text-ink hover:underline hover:decoration-white/40 hover:underline-offset-2"
            >
              {a.name}
            </button>
          ) : (
            a.name
          )}
        </Fragment>
      ))}
    </span>
  );
}

export function LikeButton({ track, className, size = "size-4" }: { track: Track; className?: string; size?: string }) {
  const liked = useLibrary((s) => s.likedIds.has(track.id));
  const toggle = useLibrary((s) => s.toggleLiked);
  return (
    <motion.button
      whileTap={{ scale: 0.78 }}
      transition={SPRING}
      onClick={(e) => {
        e.stopPropagation();
        void toggle(track);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
      aria-pressed={liked}
      className={cn("grid place-items-center rounded-full p-1.5 transition-colors duration-200", liked ? "text-accent" : "text-ink-3 hover:text-ink", className)}
    >
      <motion.span key={String(liked)} initial={{ scale: liked ? 0.3 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 700, damping: 14 }}>
        <Heart className={size} fill={liked ? "currentColor" : "none"} strokeWidth={liked ? 0 : 2} />
      </motion.span>
    </motion.button>
  );
}

/** the Play capsule on album, playlist and artist headers, filled with the accent like Apple Music's */
export function BigPlayButton({ playing, loading, onClick, label = "Play", className }: { playing?: boolean; loading?: boolean; onClick: () => void; label?: string; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      transition={SPRING}
      onClick={onClick}
      aria-label={playing ? "Pause" : label}
      className={cn(
        "relative inline-flex h-10 min-w-[118px] items-center justify-center gap-2 rounded-full bg-accent px-6 text-[14.5px] font-semibold text-on-accent",
        // tinted glass: a bright lip on top, a darker one below, a soft red glow
        "shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.45),inset_0_-1px_1px_rgb(0_0_0/0.18),0_8px_22px_-8px_rgb(var(--accent-rgb)/0.7)] transition-[filter] duration-200 hover:brightness-110",
        className,
      )}
    >
      {loading ? (
        <LoaderCircle className="size-[18px] animate-spin" />
      ) : playing ? (
        <Pause className="size-[18px]" fill="currentColor" strokeWidth={0} />
      ) : (
        <Play className="size-[18px]" fill="currentColor" strokeWidth={0} />
      )}
      <span>{playing ? "Pause" : "Play"}</span>
    </motion.button>
  );
}

/** the Shuffle capsule that sits next to Play */
export function ShuffleButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      transition={SPRING}
      onClick={onClick}
      aria-label="Shuffle play"
      className={cn("glass-control inline-flex h-10 min-w-[118px] items-center justify-center gap-2 rounded-full px-6 text-[14.5px] font-semibold text-accent transition-[filter] hover:brightness-125", className)}
    >
      <Shuffle className="size-[17px]" strokeWidth={2.4} />
      <span>Shuffle</span>
    </motion.button>
  );
}

export function PillButton({ children, onClick, icon, className }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; icon?: ReactNode; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      transition={SPRING}
      onClick={onClick}
      className={cn("glass-control inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium text-ink transition-[filter] hover:brightness-125", className)}
    >
      {icon}
      {children}
    </motion.button>
  );
}

/** a round glass button holding one icon */
export function IconButton({ label, onClick, children, active, className }: { label: string; onClick: (e: React.MouseEvent) => void; children: ReactNode; active?: boolean; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("glass-control grid size-10 place-items-center rounded-full transition-[filter,color] hover:brightness-125 [&_svg]:size-[18px]", active ? "text-accent" : "text-ink", className)}
    >
      {children}
    </motion.button>
  );
}

/** an iOS switch: green when on, the knob stretches while pressed */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const [pressed, setPressed] = useState(false);
  // the track is 48 wide with 2px of padding, so the knob travels within 44
  const width = pressed ? 31 : 24;
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={cn("relative h-[28px] w-[48px] shrink-0 rounded-full p-[2px] transition-colors duration-300", checked ? "bg-switch" : "bg-[rgb(120_120_128/0.36)]")}
    >
      <motion.span
        initial={false}
        animate={{ width, x: checked ? 44 - width : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 40 }}
        className="block h-6 rounded-full bg-snow shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)]"
      />
    </button>
  );
}

/** a row of choices, one picked: iOS segmented control */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-[10px] bg-[rgb(118_118_128/0.24)] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("relative min-w-[84px] rounded-[8px] px-3 py-1 text-[13px] font-medium transition-colors", value === o.value ? "text-ink" : "text-ink-2 hover:text-ink")}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${label}`}
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
              className="absolute inset-0 rounded-[8px] bg-[var(--segment-on)] shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04),inset_0_0.5px_0_rgb(255_255_255/0.12)]"
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-end justify-between gap-4">
      <h2 className="font-display text-[21px] font-bold tracking-[-0.022em]">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      className="flex flex-col items-center px-6 py-20 text-center"
    >
      <div className="glass-control mb-5 grid size-16 place-items-center rounded-[20px] text-ink-2">{icon}</div>
      <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-2">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}
