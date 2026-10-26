import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { History, Import, LoaderCircle, RefreshCw, Search } from "lucide-react";
import type { HomeSection, Track } from "@shared/types";
import { AlbumCard, ArtistCard, CardRow, CardSkeletonRow, LikedSongsCard, MixCard, PlaylistCard, RemotePlaylistCard, TrackCard } from "@/components/Cards";
import { SectionTitle } from "@/components/common";
import { MoodPicker } from "@/components/MoodPicker";
import { SEARCH_INPUT_ID } from "@/components/TopBar";
import { useFeed } from "@/feed/store";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { greeting } from "@/lib/format";
import { cn } from "@/lib/cn";
import { toast } from "@/ui/toast";

// What's new and popular on YouTube Music: its home page, new releases,
// trending songs and charts. Looked at again every 10 minutes so the latest
// songs turn up without a restart.
const HOME_FRESH_MS = 10 * 60_000;
let homeFeed: { sections: Promise<HomeSection[]>; at: number } | null = null;

function loadHomeFeed(force = false): Promise<HomeSection[]> {
  if (!homeFeed || force || Date.now() - homeFeed.at >= HOME_FRESH_MS) {
    const entry = { sections: window.encore.catalog.home(), at: Date.now() };
    // a failed load is tried again next time instead of being kept
    entry.sections.catch(() => homeFeed === entry && (homeFeed = null));
    homeFeed = entry;
  }
  return homeFeed.sections;
}

function useHomeFeed() {
  const [sections, setSections] = useState<HomeSection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(false);
  // a refresh that fails keeps what's already on screen; says whether it worked
  const load = useCallback(
    (force = false) =>
      loadHomeFeed(force).then(
        (s) => {
          if (alive.current) setSections(s);
          return true;
        },
        () => {
          if (alive.current) setFailed(true);
          return false;
        },
      ),
    [],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => !document.hidden && void load(true), HOME_FRESH_MS);
    // coming back to the window after a while
    const onVisible = () => !document.hidden && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /** ask YouTube Music for what's new right now, instead of waiting for the next 10-minute look */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    // your artists' new releases arrive in the background, as "New releases for you" and a notification
    void window.encore.feed.checkReleases().catch(() => undefined);
    const ok = await load(true);
    if (!alive.current) return;
    setRefreshing(false);
    if (ok) toast("Home has the newest songs from YouTube Music");
    else toast("Couldn't reach YouTube Music. Check your connection and try again.", { kind: "error" });
  }, [load]);

  return { sections, failed, refreshing, refresh };
}

function Section({ title, children, delay = 0, action }: { title: string; children: React.ReactNode; delay?: number; action?: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay, ease: [0.32, 0.72, 0, 1] }} className="mt-9">
      <SectionTitle action={action}>{title}</SectionTitle>
      {children}
    </motion.section>
  );
}

/** "Refresh" for the mixes, or what the builder is doing right now */
function FeedAction() {
  const status = useFeed((s) => s.status);
  const refresh = useFeed((s) => s.refresh);
  if (status.building) {
    return (
      <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-3">
        <LoaderCircle className="size-3.5 animate-spin" /> {status.step ?? "Updating"}…
      </span>
    );
  }
  return (
    <button onClick={() => void refresh()} title="Make today's mixes again" className="pressable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
      <RefreshCw className="size-3.5" /> Refresh
    </button>
  );
}

const fromFeed = (label: string, id: string) => ({ kind: "home" as const, label, id: `feed:${id}` });

export function HomePage() {
  const snapshot = useLibrary((s) => s.snapshot);
  const loaded = useLibrary((s) => s.loaded);
  const { sections, failed, refreshing, refresh } = useHomeFeed();
  const feed = useFeed((s) => s.feed);
  const moodMixes = useFeed((s) => s.moodMixes);
  const building = useFeed((s) => s.status.building);

  // the most recent plays, one card per song
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const entry of snapshot.history) {
      if (seen.has(entry.track.id)) continue;
      seen.add(entry.track.id);
      tracks.push(entry.track);
      if (tracks.length === 16) break;
    }
    return tracks;
  }, [snapshot.history]);

  const isNew = loaded && recent.length === 0 && snapshot.liked.length === 0 && snapshot.playlists.length === 0 && !feed?.hasHistory;
  // mood mixes you started today come first
  const mixes = [...moodMixes, ...(feed?.mixes ?? [])];

  return (
    <div className="px-8 pb-16 pt-[68px]">
      <div className="flex items-center justify-between gap-4">
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="font-display text-[34px] font-bold tracking-[-0.026em]"
        >
          {greeting()}
        </motion.h1>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Ask YouTube Music for the newest songs now, and look for new releases from your artists"
          className="glass-control pressable inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-ink hover:brightness-125 disabled:opacity-70"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Checking…" : "Check for new songs"}
        </button>
      </div>

      {isNew && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: [0.32, 0.72, 0, 1] }}
          className="glass relative mt-7 overflow-hidden rounded-[28px] p-10"
        >
          <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-accent/25 blur-3xl" />
          <h2 className="relative max-w-xl font-display text-[34px] font-bold leading-[1.1] tracking-[-0.026em]">
            All your music. <span className="text-gradient">No ads. Ever.</span>
          </h2>
          <p className="relative mt-3 max-w-lg text-[15px] leading-relaxed text-ink-2">
            Search for any song and press play, or bring in your playlists and history from Spotify, YouTube Music and Apple Music. Everything stays on this computer.
          </p>
          <button
            onClick={() => {
              navigate({ name: "search" });
              requestAnimationFrame(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
            }}
            className="pressable relative mt-7 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-on-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.45),0_8px_22px_-8px_rgb(var(--accent-rgb)/0.7)] hover:brightness-110"
          >
            <Search className="size-4" /> Start searching
          </button>
          <button
            onClick={() => navigate({ name: "import" })}
            className="glass-control pressable relative ml-3 mt-7 inline-flex h-10 items-center gap-2 rounded-full px-6 text-[14px] font-semibold text-ink hover:brightness-125"
          >
            <Import className="size-4" /> Import your music
          </button>
        </motion.div>
      )}

      <MoodPicker />

      {mixes.length > 0 ? (
        <Section title="Made for you" action={<FeedAction />}>
          <CardRow>{mixes.map((mix) => <MixCard key={mix.id} mix={mix} />)}</CardRow>
        </Section>
      ) : building && !isNew ? (
        <div className="mt-9">
          <SectionTitle action={<FeedAction />}>Made for you</SectionTitle>
          <CardSkeletonRow />
        </div>
      ) : (
        feed &&
        !feed.hasHistory &&
        !isNew && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
            className="fill-group mt-9 flex items-center gap-5 rounded-[22px] p-5"
          >
            <div className="grid size-12 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              <History className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">Your daily mixes will show up here</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                Keep listening, or bring in your history from Spotify, YouTube Music or Apple Music, and Vyse Music will make mixes from the artists you love.
              </div>
            </div>
            <button onClick={() => navigate({ name: "import" })} className="glass-control pressable h-9 shrink-0 rounded-full px-5 text-[13px] font-semibold text-accent hover:brightness-125">
              Import history
            </button>
          </motion.div>
        )
      )}

      {feed && feed.newReleases.length > 0 && (
        <Section title="New releases for you" delay={0.03}>
          <CardRow>
            {feed.newReleases.map((r) => (
              <AlbumCard key={r.album.id} album={r.album} subtitle={`${r.album.kind ?? "Album"} • ${r.artist.name}`} badge={r.isNew ? "New" : undefined} />
            ))}
          </CardRow>
        </Section>
      )}

      {recent.length > 0 && (
        <Section title="Jump back in">
          <CardRow>
            {recent.map((track, i) => (
              <TrackCard key={track.id} track={track} list={recent} index={i} context={{ kind: "history", label: "Recently played", id: "history" }} />
            ))}
          </CardRow>
        </Section>
      )}

      {feed && feed.onRepeat.length > 0 && (
        <Section title="On repeat" delay={0.04}>
          <CardRow>
            {feed.onRepeat.map((track, i) => (
              <TrackCard key={track.id} track={track} list={feed.onRepeat} index={i} context={fromFeed("On repeat", "on-repeat")} />
            ))}
          </CardRow>
        </Section>
      )}

      {feed && feed.topArtists.length > 0 && (
        <Section title="Your top artists" delay={0.05}>
          <CardRow>{feed.topArtists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
        </Section>
      )}

      {(snapshot.playlists.length > 0 || snapshot.liked.length > 0) && (
        <Section title="Your playlists" delay={0.05}>
          <CardRow>
            {[
              ...(snapshot.liked.length > 0 ? [<LikedSongsCard key="liked" count={snapshot.liked.length} tracks={snapshot.liked.map((l) => l.track)} />] : []),
              ...snapshot.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} />),
            ]}
          </CardRow>
        </Section>
      )}

      {feed && feed.rediscover.length > 0 && (
        <Section title="Forgotten favourites" delay={0.05}>
          <CardRow>
            {feed.rediscover.map((track, i) => (
              <TrackCard key={track.id} track={track} list={feed.rediscover} index={i} context={fromFeed("Forgotten favourites", "rediscover")} />
            ))}
          </CardRow>
        </Section>
      )}

      {sections === null && !failed && (
        <div className="mt-9">
          <div className="skeleton mb-4 h-6 w-48 rounded-md" />
          <CardSkeletonRow />
        </div>
      )}

      {sections?.map((section, si) => (
        <Section key={`${section.title}-${si}`} title={section.title} delay={0.05 * Math.min(si, 4)}>
          <CardRow>
            {[
              ...section.tracks.map((track, i) => (
                <TrackCard key={track.id} track={track} list={section.tracks} index={i} context={{ kind: "home", label: section.title, id: `home:${section.title}` }} />
              )),
              ...section.albums.map((album) => <AlbumCard key={album.id} album={album} />),
              ...section.playlists.map((playlist) => <RemotePlaylistCard key={playlist.id} playlist={playlist} />),
            ]}
          </CardRow>
        </Section>
      ))}
    </div>
  );
}
