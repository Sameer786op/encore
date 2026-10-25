import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { useCurrentTrack } from "@/player/store";
import { useSettings } from "@/settings/store";

// The only background in the app. By default it's the cover of what's
// playing, blown up and blurred into a soft wash of its colours, dimmed
// enough for text to read; album, artist and playlist pages show their own
// cover instead while open. Settings → Appearance can swap it for a picture
// of your own or a plain colour, and set how blurred and dim it is.

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

const EASE = [0.32, 0.72, 0, 1] as const;

export function Backdrop() {
  const background = useSettings((s) => s.background);
  const look = useSettings((s) => s.artworkLook);
  const wallpaper = useSettings((s) => s.wallpaper);
  const track = useCurrentTrack();
  const page = useBackdrop((s) => s.stack[s.stack.length - 1]?.src);
  const raw = page ?? track?.artwork;
  const src = background === "artwork" && raw ? small(raw) : undefined;
  const picture = background === "wallpaper" ? wallpaper.url : null;
  const dim = background === "artwork" ? look.dim : background === "wallpaper" ? wallpaper.dim : 0;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-bg transition-colors duration-500">
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
            transition={{ duration: 1.1, ease: EASE }}
            style={{ filter: `blur(${look.blur}px) saturate(1.7)` }}
            className="absolute left-1/2 top-1/2 h-[150%] w-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover"
          />
        )}
        {picture && (
          <motion.img
            key={picture}
            src={picture}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
            // blurring softens the edges, so blow it up a little to hide them
            style={{ filter: wallpaper.blur ? `blur(${wallpaper.blur}px)` : undefined, scale: wallpaper.blur ? 1 + wallpaper.blur / 300 : 1 }}
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </AnimatePresence>
      {/* dim it evenly (or wash it out, in the light theme), a little more at the edges, so text always reads */}
      <div className="absolute inset-0 transition-[background-color] duration-500" style={{ backgroundColor: `rgb(var(--backdrop-tint) / ${dim})` }} />
      {background === "plain" ? (
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_15%_0%,rgb(var(--accent-rgb)/0.09),transparent_70%)]" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,transparent_40%,rgb(var(--backdrop-edge)/0.45))]" />
      )}
    </div>
  );
}
