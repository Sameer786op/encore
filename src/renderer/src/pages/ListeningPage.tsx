import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView } from "motion/react";
import { BarChart3, ListPlus, LoaderCircle, Music, Play } from "lucide-react";
import type { ListeningInsights, TopSong, Track } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { EmptyState, SectionTitle } from "@/components/common";
import { ORIGIN_COLOR, ORIGIN_LABEL, yearRange } from "@/imports/labels";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { useSearch } from "@/search/store";
import { classifyScore } from "@shared/matching";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { toast } from "@/ui/toast";

function CountUp({ value, format = (n) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    const controls = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (el.textContent = format(v)) });
    return () => controls.stop();
  }, [inView, value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref}>{format(0)}</span>;
}

const hours = (ms: number) => ms / 3_600_000;

function Stat({ label, value, format, delay }: { label: string; value: number; format?: (n: number) => string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="fill-group rounded-[20px] p-5"
    >
      <div className="font-display text-[34px] font-bold leading-none tracking-tight tabular-nums">
        <CountUp value={value} format={format} />
      </div>
      <div className="mt-2 text-[13px] text-ink-2">{label}</div>
    </motion.div>
  );
}

function YearChart({ years }: { years: ListeningInsights["years"] }) {
  const max = Math.max(...years.map((y) => y.plays), 1);
  return (
    <div className="flex h-48 items-end gap-2 fill-group rounded-[20px] px-5 pb-4 pt-6">
      {years.map((y, i) => (
        <div key={y.year} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <span className="text-[11px] tabular-nums text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">{y.plays.toLocaleString()}</span>
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(3, (y.plays / max) * 100)}%` }}
            transition={{ duration: 0.9, delay: 0.15 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-14 rounded-t-lg bg-gradient-to-t from-accent/55 to-[#ff6b81]/85 transition-[filter] group-hover:brightness-125"
            title={`${y.year}: ${plural(y.plays, "play")}${y.ms ? `, ${Math.round(hours(y.ms))} hours` : ""}`}
          />
          <span className="text-[12px] tabular-nums text-ink-2">{y.year}</span>
        </div>
      ))}
    </div>
  );
}

/** the playable version of a top song, searching YouTube Music if we don't know it yet */
async function resolve(song: TopSong): Promise<Track | null> {
  if (song.track) return song.track;
  const [best] = await window.encore.imports.matchOne(song.source);
  return best && classifyScore(best.score) !== "missing" ? best.track : null;
}

function TopSongRow({ song, rank, onPlay, busy }: { song: TopSong; rank: number; onPlay: () => void; busy: boolean }) {
  return (
    <div onDoubleClick={onPlay} className="group grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-4 rounded-lg px-3 py-1.5 hover:bg-white/[0.06]">
      <span className="text-right text-[15px] font-semibold tabular-nums text-ink-3">{rank}</span>
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onPlay} aria-label={`Play ${song.title}`} className="relative shrink-0">
          <Artwork src={song.track?.artwork} className="size-10 rounded-md" fallback={<Music className="size-4" />} />
          <span className="absolute inset-0 grid place-items-center rounded-md bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {busy ? <LoaderCircle className="size-4 animate-spin text-white" /> : <Play className="size-4 text-white" fill="currentColor" strokeWidth={0} />}
          </span>
        </button>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{song.title}</div>
          <div className="truncate text-[12.5px] text-ink-2">{song.artist}</div>
        </div>
      </div>
      <div className="text-right text-[12.5px] tabular-nums text-ink-2">
        {plural(song.plays, "play")}
        {song.ms > 0 && <div className="text-[11.5px] text-ink-3">{hours(song.ms) >= 1 ? `${hours(song.ms).toFixed(1)} h` : `${Math.round(song.ms / 60000)} min`}</div>}
      </div>
    </div>
  );
}

export function ListeningPage() {
  const [insights, setInsights] = useState<ListeningInsights | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void window.encore.history.insights().then(setInsights);
  }, []);

  if (!insights) {
    return (
      <div className="grid place-items-center pt-40">
        <LoaderCircle className="size-6 animate-spin text-ink-3" />
      </div>
    );
  }

  if (insights.totals.plays === 0) {
    return (
      <div className="px-8 pt-16">
        <EmptyState
          icon={<BarChart3 className="size-7" />}
          title="Your listening shows up here"
          body="Import your history from Spotify, YouTube Music or Apple Music, or just keep listening in Encore."
          action={
            <button onClick={() => navigate({ name: "import" })} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
              Import your history
            </button>
          }
        />
      </div>
    );
  }

  const { totals } = insights;
  const since = totals.firstAt ? new Date(totals.firstAt).getFullYear() : new Date().getFullYear();
  const songs = showAll ? insights.topSongs : insights.topSongs.slice(0, 20);

  const play = async (song: TopSong, index: number) => {
    setResolving(song.key);
    try {
      const track = await resolve(song);
      if (!track) return toast(`Couldn't find "${song.title}" on YouTube Music`, { kind: "error" });
      // the rest of the list plays after it, as far as we already know the songs
      const rest = insights.topSongs.slice(index + 1).map((s) => s.track).filter((t): t is Track => !!t);
      usePlayer.getState().playTracks([track, ...rest], 0, { kind: "history", label: "Your top songs", id: "top-songs" });
    } catch (err) {
      toast(friendlyError(err, "Couldn't play that"), { kind: "error" });
    } finally {
      setResolving(null);
    }
  };

  const makePlaylist = async () => {
    setMaking(true);
    try {
      const job = await window.encore.history.playlistFromTopSongs(50);
      navigate({ name: "import-job", id: job.id });
    } catch (err) {
      toast(friendlyError(err), { kind: "error" });
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="@container px-8 pb-16 pt-[68px]">
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[34px] font-bold tracking-[-0.026em]">
        Your listening
      </motion.h1>
      <div className="mt-2 flex flex-wrap gap-2">
        {insights.sources.map((s) => (
          <span key={s.origin} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-[12.5px] text-ink-2">
            <span className="size-1.5 rounded-full" style={{ background: ORIGIN_COLOR[s.origin] }} />
            {ORIGIN_LABEL[s.origin]} · {yearRange(s.firstAt, s.lastAt)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-[12.5px] text-ink-2">
          <span className="size-1.5 rounded-full" style={{ background: ORIGIN_COLOR.encore }} />
          Encore
        </span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 @3xl:grid-cols-5">
        <Stat label="plays" value={totals.plays} delay={0} />
        {totals.ms < 3_600_000 ? (
          <Stat label="minutes listened" value={totals.ms / 60_000} delay={0.05} />
        ) : (
          <Stat label="hours listened" value={hours(totals.ms)} format={(n) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString())} delay={0.05} />
        )}
        <Stat label="different songs" value={totals.songs} delay={0.1} />
        <Stat label="artists" value={totals.artists} delay={0.15} />
        <Stat label="listening since" value={since} format={(n) => String(Math.round(n))} delay={0.2} />
      </div>

      {insights.years.length > 1 && (
        <section className="mt-9">
          <SectionTitle>Plays by year</SectionTitle>
          <YearChart years={insights.years} />
        </section>
      )}

      <div className="mt-10 grid grid-cols-1 gap-10 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <SectionTitle
            action={
              <button
                onClick={makePlaylist}
                disabled={making}
                className="glass-control pressable inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125 disabled:opacity-50"
              >
                {making ? <LoaderCircle className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                Playlist of your top 50
              </button>
            }
          >
            Top songs
          </SectionTitle>
          <div className="flex flex-col">
            {songs.map((song, i) => (
              <TopSongRow key={song.key} song={song} rank={i + 1} busy={resolving === song.key} onPlay={() => void play(song, i)} />
            ))}
          </div>
          {insights.topSongs.length > 20 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-3 text-[13px] font-semibold text-ink-2 hover:text-ink">
              {showAll ? "Show less" : `Show all ${insights.topSongs.length}`}
            </button>
          )}
        </section>

        <section>
          <SectionTitle>Top artists</SectionTitle>
          <div className="flex flex-col gap-1">
            {insights.topArtists.map((artist, i) => {
              const share = artist.plays / (insights.topArtists[0]?.plays || 1);
              return (
                <button
                  key={artist.name}
                  onClick={() => {
                    useSearch.getState().submit(artist.name);
                    navigate({ name: "search" });
                  }}
                  className="group relative overflow-hidden rounded-lg px-3 py-2 text-left hover:bg-white/[0.04]"
                >
                  <motion.span
                    initial={{ width: 0 }}
                    animate={{ width: `${share * 100}%` }}
                    transition={{ duration: 0.9, delay: 0.1 + i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                    className={cn("absolute inset-y-1 left-0 rounded-md bg-gradient-to-r from-accent/25 to-accent/5")}
                  />
                  <span className="relative flex items-center gap-3">
                    <span className="w-5 text-right text-[13px] font-semibold tabular-nums text-ink-3">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{artist.name}</span>
                    <span className="text-[12.5px] tabular-nums text-ink-2">{plural(artist.plays, "play")}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
