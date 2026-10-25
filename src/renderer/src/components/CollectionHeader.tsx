import type { ReactNode } from "react";
import { motion } from "motion/react";

interface CollectionHeaderProps {
  art: ReactNode;
  kind: string;
  title: string;
  meta: ReactNode;
  actions?: ReactNode;
  onTitleClick?: () => void;
}

const EASE = [0.32, 0.72, 0, 1] as const;

/** the header on album, playlist and Liked Songs pages: cover on the left, Apple Music style */
export function CollectionHeader({ art, kind, title, meta, actions, onTitleClick }: CollectionHeaderProps) {
  const size = title.length > 40 ? "text-[26px]" : title.length > 22 ? "text-[32px]" : "text-[40px]";
  return (
    <header className="flex items-end gap-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="size-[232px] shrink-0 overflow-hidden rounded-[14px] shadow-[0_24px_60px_-18px_rgb(0_0_0/0.75),0_0_0_0.5px_rgb(255_255_255/0.08)] xl:size-[256px]"
      >
        {art}
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.05, ease: EASE }} className="min-w-0 flex-1 pb-1">
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">{kind}</div>
        <h1
          onClick={onTitleClick}
          title={onTitleClick ? "Rename" : undefined}
          className={`mt-1.5 line-clamp-2 font-display font-bold leading-[1.06] tracking-[-0.03em] ${size} ${onTitleClick ? "cursor-pointer" : ""}`}
        >
          {title}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[14px] text-ink-2">{meta}</div>
        {actions && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: EASE }} className="mt-6 flex items-center gap-2.5">
            {actions}
          </motion.div>
        )}
      </motion.div>
    </header>
  );
}

export function Dot() {
  return <span className="text-ink-3">·</span>;
}
