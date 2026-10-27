import type { ReactNode } from "react";
import { motion } from "motion/react";
import { BlurTitle, KindDot } from "./common";
import { Eyebrow } from "./home/Tile";

interface CollectionHeaderProps {
  art: ReactNode;
  kind: string;
  title: string;
  meta: ReactNode;
  actions?: ReactNode;
  onTitleClick?: () => void;
}

const EASE = [0.32, 0.72, 0, 1] as const;

/** how big a page title can be and still fit in two lines */
export function titleSize(title: string): string {
  return title.length > 40 ? "text-[30px] @min-[860px]:text-[34px]" : title.length > 20 ? "text-[38px] @min-[860px]:text-[46px]" : "text-[46px] @min-[860px]:text-[60px]";
}

/**
 * The header on album, playlist, mix and Liked Songs pages: the cover lit from
 * behind inside a thin ring, like the specimen on Home, and a big Sora title.
 */
export function CollectionHeader({ art, kind, title, meta, actions, onTitleClick }: CollectionHeaderProps) {
  return (
    <header className="@container">
      <div className="flex items-end gap-7 @min-[860px]:gap-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 28 }}
          className="relative isolate shrink-0"
        >
          {/* the light behind the cover: an ember glow, or a soft white one on Moss */}
          <span aria-hidden className="ember-only pointer-events-none absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent-rgb)/0.34),transparent)] blur-2xl" />
          <span aria-hidden className="moss-only pointer-events-none absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.9),transparent)] blur-2xl" />
          <span aria-hidden className="pointer-events-none absolute -inset-[11px] rounded-[33px] border border-[var(--ring)]" />
          <div className="size-[196px] overflow-hidden rounded-[22px] shadow-[0_0_0_1px_var(--ring),0_30px_64px_-24px_rgb(0_0_0/calc(0.85*var(--shadow-k))),0_8px_20px_-8px_rgb(0_0_0/calc(0.4*var(--shadow-k)))] @min-[760px]:size-[224px] @min-[1100px]:size-[248px]">
            {art}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.05, ease: EASE }} className="min-w-0 flex-1 pb-1">
          <Eyebrow className="flex items-center gap-2">
            <KindDot />
            {kind}
          </Eyebrow>
          <BlurTitle
            text={title}
            onClick={onTitleClick}
            className={`mt-2.5 line-clamp-2 pb-[0.06em] font-display font-bold leading-[1.02] tracking-[-0.045em] ${titleSize(title)} ${onTitleClick ? "cursor-pointer" : ""}`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 text-[14px] text-ink-2">{meta}</div>
          {actions && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.16, ease: EASE }} className="mt-6 flex items-center gap-2.5">
              {actions}
            </motion.div>
          )}
        </motion.div>
      </div>
    </header>
  );
}

export function Dot() {
  return <span className="text-ink-3">·</span>;
}
