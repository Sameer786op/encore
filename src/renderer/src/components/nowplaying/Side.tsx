import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ellipsis, LoaderCircle, Minimize2 } from "lucide-react";
import type { AlbumSummary, ArtistDetails, Track } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { Portrait } from "@/components/home/ArtistPortrait";
import { Tile } from "@/components/home/Tile";
import { EASE } from "@/components/Specimen";
import { trackMenu } from "@/components/trackMenu";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { artistCache } from "@/pages/albumCache";
import { upcomingItems } from "@/player/queue";
import { usePlayer } from "@/player/store";
import { openMenu } from "@/ui/menu";
import { useView } from "@/ui/view";
import { artistNames, formatTime } from "@/lib/format";

// The right of the full-screen player: whoever you're listening to, in black
// and white, and what plays next. The Up next tile can grow over the
// portrait to show the whole queue.

/** rows beyond this are left out, so a huge queue stays quick */
const SHOWN = 80;

/** the artist's page, from the cache the artist page uses: undefined while it loads, null if it couldn't */
function useArtistDetails(id: string | undefined): ArtistDetails | null | undefined {
  const [details, setDetails] = useState<{ id: string; value: ArtistDetails | null }>();
  useEffect(() => {
    if (!id) return;
    let alive = true;
    artistCache.get(id).then(
      (value) => alive && setDetails({ id, value }),
      () => alive && setDetails({ id, value: null }),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  if (!id) return null;
  return details?.id === id ? details.value : undefined;
}

/** their newest single or album that says when it came out */
function latestRelease(details: ArtistDetails): AlbumSummary | undefined {
  const all = [...details.singles, ...details.albums];
  return all.filter((r) => r.year).sort((a, b) => Number(b.year) - Number(a.year))[0] ?? all[0];
}

function ArtistTile({ track }: { track: Track }) {
  const artist = track.artists.find((a) => a.id) ?? track.artists[0];
  const details = useArtistDetails(artist?.id);
  const following = useLibrary((s) => !!artist?.id && s.followedIds.has(artist.id));
  const latest = details ? latestRelease(details) : undefined;
  const name = details?.name ?? artist?.name ?? "Unknown artist";
  const line = latest ? `Latest: ${latest.title}${latest.year ? ` · ${latest.year}` : ""}` : (details?.subtitle ?? (details === undefined ? "…" : undefined));
  return (
    <Portrait
      name={name}
      artwork={details?.artwork}
      eyebrow="The artist"
      line={line}
      badge={following ? "Following" : null}
      label={`The artist: ${name}`}
      onOpen={
        artist?.id
          ? () => {
              useView.getState().closeFullscreen();
              navigate({ name: "artist", id: artist.id! });
            }
          : undefined
      }
      className="h-full"
      index={2}
    />
  );
}

function UpNext({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const queue = usePlayer((s) => s.queue);
  const autoplay = usePlayer((s) => s.autoplay);
  const radioLoading = usePlayer((s) => s.radioLoading);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const upcoming = upcomingItems(queue);
  const shown = upcoming.slice(0, expanded ? SHOWN : 6);

  return (
    <Tile label="Up next" index={3} className="flex min-h-0 flex-1 flex-col px-5 pb-2 pt-[16px]">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <h3 className="font-display text-[14.5px] font-semibold tracking-[-0.01em]">Up next</h3>
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Show the artist again" : "Show the whole queue"}
          title={expanded ? "Show less" : "The whole queue"}
          className="pressable -mr-1.5 grid size-7 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.08] hover:text-ink"
        >
          {expanded ? <Minimize2 className="size-3.5" /> : <Ellipsis className="size-4" />}
        </button>
      </div>
      {upcoming.length === 0 ? (
        <div className="grid flex-1 place-items-center pb-3 text-center">
          <div>
            <p className="font-display text-[15px] font-semibold">Nothing up next</p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
              {autoplay && radioLoading && <LoaderCircle className="size-3 animate-spin" />}
              {autoplay ? (radioLoading ? "Finding similar songs…" : "Similar songs will follow this one") : "Add songs to hear them next"}
            </p>
          </div>
        </div>
      ) : (
        <div className="scrollbar-none -mx-2 min-h-0 flex-1 overflow-y-auto px-2 [mask-image:linear-gradient(to_bottom,black_88%,transparent)]">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((item) => (
              <motion.button
                layout="position"
                key={item.uid}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24, transition: { duration: 0.25 } }}
                transition={{ duration: 0.5, ease: EASE }}
                onClick={() => jumpTo(item.uid)}
                onContextMenu={(e) => openMenu(e, trackMenu(item.track))}
                title={`Play ${item.track.title} now`}
                className="group relative -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors duration-200 after:absolute after:inset-x-2 after:top-0 after:h-px after:bg-[var(--color-line)] first:after:hidden hover:bg-[var(--row-on)] hover:after:opacity-0"
              >
                <Artwork src={item.track.artwork} className="size-10 shrink-0 rounded-[10px] shadow-[0_2px_8px_rgb(0_0_0/calc(0.3*var(--shadow-k)))]" />
                <div className="min-w-0 flex-1 leading-tight">
                  <b className="block truncate font-display text-[13.5px] font-semibold tracking-[-0.01em]">{item.track.title}</b>
                  <small className="mt-0.5 block truncate text-[11.5px] font-semibold text-ink-3">{artistNames(item.track.artists)}</small>
                </div>
                <span className="shrink-0 font-display text-[12px] tabular-nums text-ink-3">{formatTime(item.track.durationMs / 1000)}</span>
              </motion.button>
            ))}
          </AnimatePresence>
          {expanded && upcoming.length > shown.length && <p className="py-3 text-center text-[12px] font-semibold text-ink-3">and {(upcoming.length - shown.length).toLocaleString()} more</p>}
        </div>
      )}
    </Tile>
  );
}

/** the portrait over Up next; `expanded` folds the portrait away so the queue has the column */
export function SideColumn({ track, expanded, onToggle }: { track: Track; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <motion.div
        initial={false}
        animate={{ flexGrow: expanded ? 0 : 1.25, opacity: expanded ? 0 : 1, marginBottom: expanded ? 0 : 18 }}
        transition={{ type: "spring", stiffness: 260, damping: 34, mass: 0.9 }}
        inert={expanded}
        className="min-h-0 basis-0"
      >
        <ArtistTile track={track} />
      </motion.div>
      <UpNext expanded={expanded} onToggle={onToggle} />
    </div>
  );
}
