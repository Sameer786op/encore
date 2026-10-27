import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { useCurrentTrack } from "@/player/store";
import { useSettings } from "@/settings/store";
import { forGlow } from "@/visuals/palette";
import { usePalette } from "@/visuals/usePalette";
import { artAt } from "@/lib/art";

// The only background in the app. By default it's Ember & Moss's own: in
// Ember, a black window lit by slow, grainy ember glows; in Moss, a pale
// wash over a soft, out-of-focus moss floor. Either picks up a little colour
// from the cover of what's playing, or of the album, artist or playlist page
// that's open. Settings → Appearance can swap it for the cover itself, blown
// up and blurred, a picture of your own or a plain colour.

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
  return artAt(src, 180);
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
      {background === "signature" && <Signature cover={raw ? small(raw) : undefined} />}
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

const rgb = ([r, g, b]: [number, number, number], alpha: number) => `rgb(${r} ${g} ${b} / ${alpha})`;

/** Ember's glows and Moss's floor; styles.css shows only the half that suits the theme */
function Signature({ cover }: { cover?: string }) {
  const [tint] = forGlow(usePalette(cover), 1);
  return (
    <>
      <div className="ember-only absolute inset-0">
        {/* the main glow rises from the bottom right, white-hot at its core, the way the tiles in Trivex glow */}
        <div className="absolute -bottom-[45%] -right-[25%] h-[110%] w-[85%] animate-drift rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent-rgb)/0.5),rgb(var(--accent-rgb)/0.16)_55%,transparent)]" />
        <div className="absolute -bottom-[22%] -right-[8%] h-[55%] w-[40%] animate-drift rounded-full bg-[radial-gradient(closest-side,rgb(255_213_194/0.3),transparent)] [animation-delay:-9s]" />
        {/* and the cover's own colour, faintly, from the top left */}
        <motion.div
          animate={{ background: `radial-gradient(closest-side, ${rgb(tint, 0.2)}, transparent)` }}
          transition={{ duration: 1.6, ease: EASE }}
          className="absolute -left-[20%] -top-[35%] h-[90%] w-[70%] animate-drift rounded-full [animation-delay:-14s] [animation-direction:alternate-reverse]"
        />
      </div>
      <div className="moss-only absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(60%_55%_at_80%_92%,rgb(98_140_40/0.5),transparent_70%),radial-gradient(45%_50%_at_6%_100%,rgb(70_110_30/0.42),transparent_70%),radial-gradient(55%_45%_at_50%_35%,rgb(255_255_255/0.75),transparent_70%),linear-gradient(180deg,#ececea,#dcdcd6)]" />
        <div className="moss-floor absolute inset-x-0 bottom-0 h-[58%]" />
        <motion.div
          animate={{ background: `radial-gradient(closest-side, ${rgb(tint, 0.22)}, transparent)` }}
          transition={{ duration: 1.6, ease: EASE }}
          className="absolute -right-[15%] -top-[30%] h-[85%] w-[60%] animate-drift rounded-full [animation-delay:-6s]"
        />
      </div>
      <div className="grain absolute inset-0" />
    </>
  );
}
