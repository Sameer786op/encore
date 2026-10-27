import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Reorder, motion } from "motion/react";
import { Clock3, Ellipsis, GripVertical, Play } from "lucide-react";
import type { Track } from "@shared/types";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { toast } from "@/ui/toast";
import { currentItem, type PlayContext } from "@/player/queue";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { openMenu, type MenuEntry } from "@/ui/menu";
import { Artwork } from "./Artwork";
import { ArtistLinks, LikeButton } from "./common";
import { PlayingBars } from "./PlayingBars";
import { trackMenu } from "./trackMenu";

const ROWS_PER_PAGE = 150;

interface TrackListProps {
  tracks: Track[];
  context: PlayContext;
  /** stable keys when a list can hold the same song twice (playlists) */
  keys?: string[];
  /** album pages show track numbers instead of covers */
  numbered?: boolean;
  showAlbum?: boolean;
  /** album pages: songs by exactly these artists don't repeat them under the title */
  albumArtists?: Track["artists"];
  /** an extra column, e.g. "Date added" */
  extra?: { title: string; render: (track: Track, index: number) => ReactNode };
  menuExtras?: (track: Track, index: number) => MenuEntry[];
  /** drag to reorder; called with the new key order when a drag ends */
  onReorder?: (keys: string[]) => void;
}

function useNowPlaying() {
  const id = usePlayer((s) => currentItem(s.queue)?.track.id ?? null);
  const status = usePlayer((s) => s.status);
  return { id, playing: status === "playing" || status === "loading" };
}

interface RowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  numbered?: boolean;
  showAlbum?: boolean;
  hideArtists?: boolean;
  extra?: TrackListProps["extra"];
  draggable?: boolean;
  onPlay: (index: number) => void;
  /** double-click or Enter: play, or add to the queue, as set in Settings */
  onActivate: (index: number) => void;
  onMenu: (event: React.MouseEvent, track: Track, index: number) => void;
}

const TrackRow = memo(function TrackRow({ track, index, isCurrent, isPlaying, numbered, showAlbum, hideArtists, extra, draggable, onPlay, onActivate, onMenu }: RowProps) {
  return (
    <div
      role="row"
      tabIndex={0}
      onDoubleClick={() => onActivate(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onActivate(index);
      }}
      onContextMenu={(e) => onMenu(e, track, index)}
      className={cn(
        // no stripes: a soft fill under the pointer, and the playing song lit in the accent from the left
        "group grid items-center gap-4 rounded-[14px] px-3 py-[5px] outline-none transition-colors duration-200 hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)]",
        isCurrent && "bg-[linear-gradient(90deg,rgb(var(--accent-rgb)/0.16),rgb(var(--accent-rgb)/0.03)_55%,transparent)] shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.16)]",
        showAlbum ? "grid-cols-[28px_minmax(0,4fr)_minmax(0,3fr)_auto_auto_auto]" : "grid-cols-[28px_minmax(0,1fr)_auto_auto_auto]",
      )}
    >
      <div className="relative grid h-10 place-items-center font-display text-[12.5px] tabular-nums text-ink-3">
        {draggable && <GripVertical className="absolute -left-3 size-3.5 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100" />}
        {isCurrent ? (
          <span className="group-hover:hidden">
            <PlayingBars paused={!isPlaying} />
          </span>
        ) : (
          <span className="group-hover:hidden">{index + 1}</span>
        )}
        <button onClick={() => onPlay(index)} aria-label={`Play ${track.title}`} className="pressable hidden text-ink group-hover:block">
          <Play className="size-[15px]" fill="currentColor" strokeWidth={0} />
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {!numbered && <Artwork src={track.artwork} className="size-10 rounded-[10px] shadow-[0_0_0_1px_var(--ring),0_4px_10px_-4px_rgb(0_0_0/calc(0.5*var(--shadow-k)))]" />}
        <div className="min-w-0">
          <div className={cn("flex items-center gap-1.5 truncate text-[13.5px] font-semibold leading-snug", isCurrent ? "text-accent-ink" : "text-ink")}>
            <span className="truncate">{track.title}</span>
            {track.explicit && <span className="shrink-0 rounded-[3px] bg-white/15 px-1 text-[9px] font-bold leading-[14px] text-ink-2">E</span>}
          </div>
          {!hideArtists && <ArtistLinks artists={track.artists} className="block text-[12.5px] leading-snug text-ink-2" />}
        </div>
      </div>

      {showAlbum && (
        <div className="min-w-0 truncate text-[13px] text-ink-2">
          {track.album?.id ? (
            <button onClick={() => navigate({ name: "album", id: track.album!.id! })} onDoubleClick={(e) => e.stopPropagation()} className="truncate transition-colors hover:text-ink hover:underline hover:decoration-white/40 hover:underline-offset-2">
              {track.album.title}
            </button>
          ) : (
            track.album?.title
          )}
        </div>
      )}

      {extra ? <div className="hidden w-28 truncate text-[13px] text-ink-3 xl:block">{extra.render(track, index)}</div> : <span />}

      <div className="flex items-center gap-1">
        <LikeButton track={track} className="opacity-0 group-hover:opacity-100 aria-pressed:opacity-100" />
        <span className="w-12 text-right font-display text-[12.5px] tabular-nums text-ink-3">{track.durationMs > 0 ? formatTime(track.durationMs / 1000) : ""}</span>
      </div>

      <button
        onClick={(e) => onMenu(e, track, index)}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={`More options for ${track.title}`}
        className="pressable rounded-full p-1.5 text-ink-2 opacity-0 hover:bg-white/10 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Ellipsis className="size-4" />
      </button>
    </div>
  );
});

function artistKey(artists: Track["artists"]): string {
  return artists
    .map((a) => a.name.trim().toLowerCase())
    .sort()
    .join("|");
}

export function TrackList({ tracks, context, keys, numbered, showAlbum = true, albumArtists, extra, menuExtras, onReorder }: TrackListProps) {
  const albumKey = albumArtists?.length ? artistKey(albumArtists) : null;
  const now = useNowPlaying();
  const playTracks = usePlayer((s) => s.playTracks);
  const rowKeys = keys ?? tracks.map((t, i) => `${t.id}#${i}`);

  // local order while dragging, committed on drop
  const [order, setOrder] = useState(rowKeys);
  const latestOrder = useRef(order);
  latestOrder.current = order;
  useEffect(() => setOrder(rowKeys), [rowKeys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = new Map(rowKeys.map((k, i) => [k, tracks[i]]));

  // big lists (a music folder, years of likes) render a page at a time as you scroll
  const [limit, setLimit] = useState(ROWS_PER_PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setLimit((n) => n + ROWS_PER_PAGE), { rootMargin: "800px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, order.length]);

  const onPlay = (index: number) => {
    // play the list in its on-screen order
    const list = order.map((k) => byKey.get(k)).filter((t): t is Track => !!t);
    playTracks(list, index, context);
  };
  const doubleClick = useSettings((s) => s.doubleClick);
  const onActivate = (index: number) => {
    if (doubleClick === "play") return onPlay(index);
    const track = byKey.get(order[index]);
    if (!track) return;
    usePlayer.getState().addToQueue([track]);
    toast(`Added "${track.title}" to the queue`);
  };
  const onMenu = (event: React.MouseEvent, track: Track, index: number) => openMenu(event, trackMenu(track, menuExtras?.(track, index)));

  const header = (
    <div
      className={cn(
        "mb-2 grid items-center gap-4 border-b border-line px-3 pb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3",
        showAlbum ? "grid-cols-[28px_minmax(0,4fr)_minmax(0,3fr)_auto_auto_auto]" : "grid-cols-[28px_minmax(0,1fr)_auto_auto_auto]",
      )}
    >
      <span className="text-center">#</span>
      <span>Song</span>
      {showAlbum && <span>Album</span>}
      {extra ? <span className="hidden w-28 xl:block">{extra.title}</span> : <span />}
      <span className="flex w-[84px] justify-end pr-0">
        <Clock3 className="size-3.5" />
      </span>
      <span className="w-7" />
    </div>
  );

  const rowFor = (key: string, i: number) => {
    const track = byKey.get(key)!;
    const isCurrent = now.id === track.id;
    return (
      <TrackRow
        track={track}
        index={i}
        isCurrent={isCurrent}
        isPlaying={isCurrent && now.playing}
        numbered={numbered}
        showAlbum={showAlbum}
        hideArtists={albumKey !== null && artistKey(track.artists) === albumKey}
        extra={extra}
        draggable={!!onReorder}
        onPlay={onPlay}
        onActivate={onActivate}
        onMenu={onMenu}
      />
    );
  };

  if (onReorder) {
    return (
      <div role="table">
        {header}
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col">
          {order.map((key, i) =>
            byKey.has(key) ? (
              <Reorder.Item key={key} value={key} onDragEnd={() => onReorder(latestOrder.current)} className="relative" whileDrag={{ scale: 1.01, zIndex: 10 }}>
                {rowFor(key, i)}
              </Reorder.Item>
            ) : null,
          )}
        </Reorder.Group>
      </div>
    );
  }

  return (
    <div role="table">
      {header}
      <div className="flex flex-col">
        {order.slice(0, limit).map((key, i) =>
          byKey.has(key) ? (
            // only the first rows cascade in; long lists appear at once
            <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(i, 14) * 0.018, ease: [0.32, 0.72, 0, 1] }}>
              {rowFor(key, i)}
            </motion.div>
          ) : null,
        )}
      </div>
      {order.length > limit && <div ref={sentinel} className="h-px" />}
    </div>
  );
}
