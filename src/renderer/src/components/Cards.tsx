import { useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { BellOff, BellRing, Check, ChevronLeft, ChevronRight, Heart, ListMusic, Play, Plus, Shuffle } from "lucide-react";
import type { AlbumSummary, ArtistSummary, DailyMix, Playlist, RemotePlaylist, Track } from "@shared/types";
import { ACCOUNT_NAMES } from "@shared/types";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import type { PlayContext } from "@/player/queue";
import { cn } from "@/lib/cn";
import { artistNames, plural } from "@/lib/format";
import { openMenu, type MenuEntry } from "@/ui/menu";
import { toast } from "@/ui/toast";
import { Artwork, Mosaic } from "./Artwork";
import { GlowCover } from "./GlowCover";
import { MixCover } from "./MixCover";
import { ServiceIcon } from "./ServiceIcon";
import { trackMenu } from "./trackMenu";
import { playlistMenu } from "./playlistMenu";
import { albumCache, remotePlaylistCache } from "@/pages/albumCache";

function HoverPlay({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      initial={false}
      whileTap={{ scale: 0.88 }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      className="glass-clear absolute bottom-2.5 left-2.5 grid size-9 scale-75 place-items-center rounded-full text-snow opacity-0 transition-[opacity,scale,background-color,color] hover:text-on-accent duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
    >
      <Play className="ml-px size-4" fill="currentColor" strokeWidth={0} />
    </motion.button>
  );
}

/** cover art on a card: a hairline ring (milky on Moss) and a shadow that deepens as the card lifts */
const COVER =
  "aspect-square w-full shadow-[0_0_0_1px_var(--ring),0_10px_24px_-12px_rgb(0_0_0/calc(0.7*var(--shadow-k)))] transition-[box-shadow,filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:shadow-[0_0_0_1px_var(--ring),0_24px_38px_-16px_rgb(0_0_0/calc(0.85*var(--shadow-k)))]";
const ART = cn(COVER, "rounded-[18px] group-hover:brightness-[0.9]");
/** the cover and its play button rise together on hover */
const LIFT = "relative transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-safe:group-hover:-translate-y-1 motion-safe:group-focus-visible:-translate-y-1";
const TITLE = "mt-3 truncate font-display text-[13.5px] font-semibold leading-tight tracking-[-0.015em]";
const LINE = "mt-1 truncate text-[12.5px] leading-tight text-ink-2";

function CardShell({ children, onClick, onContextMenu, className }: { children: ReactNode; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onContextMenu={onContextMenu}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      className={cn("group w-full rounded-[22px] p-2.5 outline-none focus-visible:bg-[var(--row-hover)]", className)}
    >
      {children}
    </motion.div>
  );
}

export function TrackCard({ track, list, index, context }: { track: Track; list: Track[]; index: number; context: PlayContext }) {
  const play = () => usePlayer.getState().playTracks(list, index, context);
  return (
    <CardShell onClick={play} onContextMenu={(e) => openMenu(e, trackMenu(track))}>
      <div className={LIFT}>
        <Artwork src={track.artwork} className={ART} />
        <HoverPlay onClick={play} label={`Play ${track.title}`} />
      </div>
      <div className={TITLE}>{track.title}</div>
      <div className={LINE}>{artistNames(track.artists)}</div>
    </CardShell>
  );
}

async function playAlbum(album: AlbumSummary, shuffle = false): Promise<void> {
  try {
    const details = await albumCache.get(album.id);
    const player = usePlayer.getState();
    if (shuffle && !player.queue.shuffle) player.toggleShuffle();
    const start = shuffle ? Math.floor(Math.random() * details.tracks.length) : 0;
    player.playTracks(details.tracks, start, { kind: "album", label: details.title, id: details.id });
  } catch {
    toast(`Couldn't load "${album.title}"`, { kind: "error" });
  }
}

function albumMenu(album: AlbumSummary): MenuEntry[] {
  const saved = useLibrary.getState().savedAlbumIds.has(album.id);
  return [
    { label: "Play", icon: Play, onSelect: () => void playAlbum(album) },
    { label: "Shuffle play", icon: Shuffle, onSelect: () => void playAlbum(album, true) },
    "divider",
    saved
      ? { label: "Remove from Your Library", icon: Check, onSelect: () => void useLibrary.getState().setAlbumSaved(album, false) }
      : { label: "Save to Your Library", icon: Plus, onSelect: () => void useLibrary.getState().setAlbumSaved(album, true) },
  ];
}

function artistMenu(artist: ArtistSummary): MenuEntry[] {
  const following = useLibrary.getState().followedIds.has(artist.id);
  return [
    following
      ? { label: "Unfollow", icon: BellOff, onSelect: () => void useLibrary.getState().setFollowing(artist, false) }
      : { label: "Follow", icon: BellRing, onSelect: () => void useLibrary.getState().setFollowing(artist, true) },
  ];
}

export function AlbumCard({ album, subtitle, badge }: { album: AlbumSummary; subtitle?: string; badge?: string }) {
  const line = subtitle ?? [album.kind ?? (album.year ? undefined : "Album"), album.year, artistNames(album.artists)].filter(Boolean).join(" • ");
  return (
    <CardShell onClick={() => navigate({ name: "album", id: album.id })} onContextMenu={(e) => openMenu(e, albumMenu(album))}>
      <div className={LIFT}>
        <Artwork src={album.artwork} className={ART} />
        {badge && <span className="absolute left-2.5 top-2.5 rounded-full bg-accent px-2.5 py-[4px] text-[9.5px] font-bold uppercase tracking-[0.14em] text-on-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4),0_0_16px_-2px_rgb(var(--accent-rgb)/0.7)]">{badge}</span>}
        <HoverPlay onClick={() => void playAlbum(album)} label={`Play ${album.title}`} />
      </div>
      <div className={TITLE}>{album.title}</div>
      <div className={LINE}>{line}</div>
    </CardShell>
  );
}

async function playRemotePlaylist(playlist: RemotePlaylist): Promise<void> {
  try {
    const details = await remotePlaylistCache.get(playlist.id);
    usePlayer.getState().playTracks(details.tracks, 0, { kind: "home", label: details.title, id: `ytplaylist:${details.id}` });
  } catch {
    toast(`Couldn't load "${playlist.title}"`, { kind: "error" });
  }
}

/** a YouTube Music playlist, such as a chart */
export function RemotePlaylistCard({ playlist }: { playlist: RemotePlaylist }) {
  return (
    <CardShell onClick={() => navigate({ name: "ytplaylist", id: playlist.id })}>
      <div className={LIFT}>
        <Artwork src={playlist.artwork} className={ART} />
        <HoverPlay onClick={() => void playRemotePlaylist(playlist)} label={`Play ${playlist.title}`} />
      </div>
      <div className={TITLE}>{playlist.title}</div>
      <div className={LINE}>{playlist.subtitle ?? "Playlist"}</div>
    </CardShell>
  );
}

export function MixCard({ mix }: { mix: DailyMix }) {
  const play = () => usePlayer.getState().playTracks(mix.tracks, 0, { kind: "mix", label: mix.title, id: mix.id });
  return (
    <CardShell onClick={() => navigate({ name: "mix", id: mix.id })}>
      <div className={LIFT}>
        <MixCover mix={mix} className={ART} />
        <HoverPlay onClick={play} label={`Play ${mix.title}`} />
      </div>
      <div className={TITLE}>{mix.title}</div>
      <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{mix.description}</div>
    </CardShell>
  );
}

export function ArtistCard({ artist, subtitle = "Artist" }: { artist: ArtistSummary; subtitle?: string }) {
  return (
    <CardShell onClick={() => navigate({ name: "artist", id: artist.id })} onContextMenu={(e) => openMenu(e, artistMenu(artist))}>
      {/* black and white, like the portraits; lit from behind and back in colour under the pointer */}
      <div className={cn(LIFT, "isolate")}>
        <span aria-hidden className="pointer-events-none absolute inset-[4%] -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent-rgb)/0.75),transparent)] opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
        <Artwork src={artist.artwork} className={cn(COVER, "rounded-full grayscale contrast-[1.06] group-hover:grayscale-0")} />
      </div>
      <div className={cn(TITLE, "text-center")}>{artist.name}</div>
      <div className={cn(LINE, "text-center")}>{subtitle}</div>
    </CardShell>
  );
}

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const tracks = playlist.items.map((i) => i.track);
  const play = () => {
    if (tracks.length === 0) return toast("This playlist is empty");
    usePlayer.getState().playTracks(tracks, 0, { kind: "playlist", label: playlist.name, id: playlist.id });
  };
  return (
    <CardShell onClick={() => navigate({ name: "playlist", id: playlist.id })} onContextMenu={(e) => openMenu(e, playlistMenu(playlist))}>
      <div className={LIFT}>
        <Mosaic sources={tracks.map((t) => t.artwork)} className={ART} fallback={<ListMusic className="size-1/3" strokeWidth={1.5} />} />
        {tracks.length > 0 && <HoverPlay onClick={play} label={`Play ${playlist.name}`} />}
      </div>
      <div className={TITLE}>{playlist.name}</div>
      <div className={cn(LINE, "flex items-center gap-1.5")}>
        {playlist.synced && <ServiceIcon service={playlist.synced.service} plain className="size-3 shrink-0" />}
        <span className="truncate">{playlist.synced ? ACCOUNT_NAMES[playlist.synced.service] : "Playlist"} • {plural(tracks.length, "song")}</span>
      </div>
    </CardShell>
  );
}

export function LikedSongsCard({ count, tracks }: { count: number; tracks: Track[] }) {
  const play = () => usePlayer.getState().playTracks(tracks, 0, { kind: "liked", label: "Liked Songs", id: "liked" });
  return (
    <CardShell onClick={() => navigate({ name: "liked" })}>
      <div className={LIFT}>
        <GlowCover tone="liked" icon={<Heart className="size-1/3" fill="currentColor" strokeWidth={0} />} className={ART} />
        {count > 0 && <HoverPlay onClick={play} label="Play Liked Songs" />}
      </div>
      <div className={TITLE}>Liked Songs</div>
      <div className={LINE}>{plural(count, "song")}</div>
    </CardShell>
  );
}

/** a horizontal row of cards with arrow buttons */
export function CardRow({ children }: { children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  };
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="group/row relative -mx-2.5">
      <div ref={ref} onScroll={update} onMouseEnter={update} className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto">
        {children.map((child, i) => (
          <div key={i} className="w-[184px] shrink-0 snap-start">
            {child}
          </div>
        ))}
      </div>
      {!edges.start && (
        <button
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
          className="absolute left-1 top-[38%] glass-control grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink opacity-0 transition-opacity duration-300 group-hover/row:opacity-100"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      {!edges.end && children.length > 4 && (
        <button
          onClick={() => scroll(1)}
          aria-label="Scroll right"
          className="absolute right-1 top-[38%] glass-control grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink opacity-0 transition-opacity duration-300 group-hover/row:opacity-100"
        >
          <ChevronRight className="size-5" />
        </button>
      )}
    </div>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="-mx-2.5 grid grid-cols-[repeat(auto-fill,minmax(172px,1fr))]">{children}</div>;
}

export function CardSkeletonRow() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-[164px] shrink-0">
          <div className="skeleton aspect-square rounded-[18px]" />
          <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
