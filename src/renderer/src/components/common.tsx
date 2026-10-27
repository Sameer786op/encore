import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { Heart, LoaderCircle, Pause, Play, Shuffle } from "lucide-react";
import type { ArtistRef, Track } from "@shared/types";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { cn } from "@/lib/cn";
import { Eyebrow } from "./home/Tile";

/** a soft spring for small things that pop: hearts, knobs, badges */
export const SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;

/** a number that counts up from zero once it comes into view */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    const controls = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (el.textContent = format(v)) });
    return () => controls.stop();
  }, [inView, value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref}>{format(0)}</span>;
}

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
      className={cn("grid place-items-center rounded-full p-1.5 transition-colors duration-200", liked ? "text-accent-ink" : "text-ink-3 hover:text-ink", className)}
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
      className={cn("glass-control inline-flex h-10 min-w-[118px] items-center justify-center gap-2 rounded-full px-6 text-[14.5px] font-semibold text-accent-ink transition-[filter] hover:brightness-125", className)}
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
      className={cn("glass-control grid size-10 place-items-center rounded-full transition-[filter,color] hover:brightness-125 [&_svg]:size-[18px]", active ? "text-accent-ink" : "text-ink", className)}
    >
      {children}
    </motion.button>
  );
}

/** a switch: lit in the accent when on, the knob stretches while pressed */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const [pressed, setPressed] = useState(false);
  // the track is 48 wide with 2px of padding, so the knob travels within 44
  const width = pressed ? 31 : 24;
  return (
    <button
      // inside a form (the Disconnect dialog) a plain button would submit it
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={cn(
        "relative h-[28px] w-[48px] shrink-0 rounded-full p-[2px] transition-[background-color,opacity] duration-300 disabled:opacity-40",
        checked ? "bg-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.35),0_0_16px_-3px_rgb(var(--accent-rgb)/0.75)]" : "bg-[rgb(120_120_128/0.36)]",
      )}
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
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-full bg-[var(--well)] p-[3px] shadow-[inset_0_0_0_1px_var(--ring)]">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("relative min-w-[84px] rounded-full px-3.5 py-1 text-[13px] font-semibold transition-colors", value === o.value ? "text-ink" : "text-ink-2 hover:text-ink")}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${label}`}
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
              className="absolute inset-0 rounded-full bg-[var(--segment-on)] shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04),inset_0_0.5px_0_rgb(255_255_255/0.12)]"
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
      {/* the icon in a tile, inside a thin ring, lit from behind like the specimen */}
      <div className="relative isolate mb-6">
        <span aria-hidden className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent-rgb)/0.22),transparent)] blur-xl" />
        <span aria-hidden className="pointer-events-none absolute -inset-[9px] rounded-[30px] border border-[var(--ring)]" />
        <div className="tile grid size-16 place-items-center text-ink-2">{icon}</div>
      </div>
      <h3 className="font-display text-[22px] font-bold tracking-[-0.03em]">{title}</h3>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-2">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

/** the dot before a page's kind: a small ember, glowing */
export function KindDot() {
  return <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-[linear-gradient(135deg,var(--ramp-1),var(--ramp-2))] shadow-[0_0_10px_rgb(var(--accent-rgb)/0.7)]" />;
}

/** a big title whose words settle in out of a blur, one after another */
export function BlurTitle({ text, className, onClick, delay = 0.08 }: { text: string; className?: string; onClick?: () => void; delay?: number }) {
  const still = useReducedMotion();
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <h1 onClick={onClick} title={onClick ? "Rename" : undefined} aria-label={text} className={className}>
      {words.map((word, i) => (
        <span key={`${text}-${i}`}>
          {i > 0 && " "}
          <motion.span
            aria-hidden
            className="inline-block"
            initial={still ? false : { opacity: 0, y: "0.22em", filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            transition={{ duration: 0.75, delay: delay + Math.min(i, 8) * 0.055, ease: [0.32, 0.72, 0, 1] }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

/** the title at the top of a page: a small label over big Sora words that settle in */
export function PageTitle({ title, eyebrow, className }: { title: string; eyebrow: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}>
        <Eyebrow className="flex items-center gap-2">
          <KindDot />
          {eyebrow}
        </Eyebrow>
      </motion.div>
      <BlurTitle text={title} className="mt-2 truncate pb-[0.06em] font-display text-[40px] font-bold leading-[1.02] tracking-[-0.045em] min-[1180px]:text-[48px]" />
    </div>
  );
}
