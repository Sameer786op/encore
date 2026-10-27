import type { CSSProperties, ReactNode, Ref } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

// The pieces the Home bento is made of: a glass tile that settles in out of a
// blur, the glow behind it, its small labels and chips.

const EASE = [0.32, 0.72, 0, 1] as const;

export function Tile({ children, className, index = 0, label, style, ref }: { children: ReactNode; className?: string; index?: number; label?: string; style?: CSSProperties; ref?: Ref<HTMLElement> }) {
  const still = useReducedMotion();
  return (
    <motion.section
      ref={ref}
      aria-label={label}
      initial={still ? false : { opacity: 0, y: 18, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: 0.8, delay: 0.04 + index * 0.06, ease: EASE }}
      className={cn("tile group/tile relative isolate min-w-0 overflow-hidden", className)}
      style={style}
    >
      {children}
    </motion.section>
  );
}

/** a colour wash behind a tile's content; pair with ember-only or moss-only */
export function Glow({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn("pointer-events-none absolute inset-0 -z-[1] transition-[background] duration-700", className)} style={style} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3", className)}>{children}</div>;
}

export function TileHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-display text-[14.5px] font-semibold tracking-[-0.01em]">{title}</h3>
      {children}
    </div>
  );
}

/** a small rounded fact: "Opus 133 kbps" */
export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--row-on)] px-[11px] py-[5px] text-[11.5px] font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--ring)]", className)}>
      {children}
    </span>
  );
}

/** faint lines of text behind a tile, fading out from one corner */
export function Texture({ words, corner }: { words: string[]; corner: "left" | "right" }) {
  if (words.length === 0) return null;
  const line = words.map((w) => w.toUpperCase()).join("  ·  ");
  const mask = corner === "left" ? "radial-gradient(120% 100% at 0 0, #000, transparent 62%)" : "radial-gradient(90% 110% at 100% 0, #000, transparent 66%)";
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute -top-1 -z-[1] w-[150%] select-none font-mono text-[9px] leading-[11px] tracking-[1px] text-ink opacity-[0.14]", corner === "left" ? "-left-2" : "-right-2 text-right")}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} className="whitespace-nowrap" style={{ transform: `translateX(${corner === "left" ? -((i * 37) % 90) : (i * 37) % 90}px)` }}>
          {line} · {line}
        </div>
      ))}
    </div>
  );
}
