import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { useCurrentTrack } from "@/player/store";

// The only background in the app: the cover of what's playing, blown up and
// blurred into a soft wash of its colours, darkened enough for text to read.
// Album, artist and playlist pages show their own cover instead while open.

interface BackdropStore {
  /** covers asked for by open pages; the newest one wins */
  stack: { token: number; src: string }[];
}

const useBackdrop = create<BackdropStore>(() => ({ stack: [] }));
let nextToken = 1;

/** show this cover behind the app while the calling page is open */
export function usePageBackdrop(src: string | undefined): void {
  useEffect(() => {
    if (!src) return;
    const token = nextToken++;
    useBackdrop.setState((s) => ({ stack: [...s.stack, { token, src }] }));
    return () => useBackdrop.setState((s) => ({ stack: s.stack.filter((e) => e.token !== token) }));
  }, [src]);
}

/** a small copy is plenty for something this blurred, and much quicker to paint */
function small(src: string): string {
  if (/googleusercontent\.com|ggpht\.com/.test(src)) return src.replace(/=w\d+-h\d+[^&?]*$/, "=w180-h180-l90-rj");
  return src;
}

export function Backdrop() {
  const track = useCurrentTrack();
  const page = useBackdrop((s) => s.stack[s.stack.length - 1]?.src);
  const raw = page ?? track?.artwork;
  const src = raw ? small(raw) : undefined;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-bg">
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }}
            className="absolute left-1/2 top-1/2 h-[150%] w-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover blur-[90px] saturate-[1.7]"
          />
        )}
      </AnimatePresence>
      {/* dim it evenly, a little more at the edges, so text always reads */}
      <div className="absolute inset-0 bg-[#08080b]/[0.58]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_40%,rgb(0_0_0/0.45))]" />
    </div>
  );
}
