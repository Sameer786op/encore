import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BarChart3, ListPlus, LoaderCircle, Music, Play } from "lucide-react";
import type { ListeningInsights, TopSong, Track } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { CountUp, EmptyState, PageTitle, SectionTitle } from "@/components/common";
import { Chip, Glow, Tile } from "@/components/home/Tile";
import { ORIGIN_COLOR, ORIGIN_LABEL, yearRange } from "@/imports/labels";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { useSearch } from "@/search/store";
import { classifyScore } from "@shared/matching";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { rampAt } from "@/ui/ramp";
import { toast } from "@/ui/toast";

const hours = (ms: number) => ms / 3_600_000;

function Stat({ label, value, format, index, lit }: { label: string; value: number; format?: (n: number) => string; index: number; lit?: boolean }) {
  return (
    <Tile index={index} className="px-5 pb-[18px] pt-5">
      {lit && (
        <>
          <Glow className="ember-only" style={{ background: "radial-gradient(90% 90% at 100% 100%, rgb(var(--accent-rgb) / 0.3), transparent 70%)" }} />
          <Glow className="moss-only" style={{ background: "radial-gradient(90% 90% at 100% 100%, rgb(150 210 40 / 0.32), transparent 70%)" }} />
        </>
      )}
      <div className="font-display text-[42px] font-light leading-[0.95] tracking-[-0.05em] tabular-nums">
        <CountUp value={value} format={format} />
      </div>
      <div className="mt-2.5 text-[12px] font-semibold text-ink-2">{label}</div>
    </Tile>
  );
}

/** rows of dots in each year's column */
const DOT_ROWS = 10;

/** plays by year as a dot matrix: each year's dots light from the bottom, along the signature gradient */
function YearDots({ years }: { years: ListeningInsights["years"] }) {
  const still = useReducedMotion();
  const max = Math.max(...years.map((y) => y.plays), 1);
  const dots = DOT_ROWS * 2;
  return (
    <Tile index={5} label="Plays by year" className="px-6 pb-5 pt-6">
      <div className="flex items-end justify-between gap-2" role="img" aria-label={years.map((y) => `${y.year}: ${plural(y.plays, "play")}`).join(", ")}>
        {years.map((y, i) => {
          const lit = y.plays > 0 ? Math.max(1, Math.round((y.plays / max) * dots)) : 0;
          return (
            <div key={y.year} className="group flex min-w-0 flex-1 flex-col items-center" title={`${y.year}: ${plural(y.plays, "play")}${y.ms ? `, ${Math.round(hours(y.ms))} hours` : ""}`}>
              <span className="mb-2 font-display text-[11px] tabular-nums text-ink-2 opacity-0 transition-opacity group-hover:opacity-100">{y.plays.toLocaleString()}</span>
              <div className="grid grid-cols-2 gap-[5px]">
                {Array.from({ length: dots }, (_, k) => {
                  // laid out top to bottom; n counts up from the bottom
                  const n = (DOT_ROWS - 1 - Math.floor(k / 2)) * 2 + (k % 2);
                  const row = Math.floor(n / 2);
                  const on = n < lit;
                  return (
                    <motion.i
                      key={k}
                      initial={still ? false : { opacity: 0, scale: 0.3 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.45, delay: 0.15 + i * 0.04 + row * 0.03, ease: [0.16, 1, 0.3, 1] }}
                      className={cn("block size-[8px] rounded-full transition-[filter] group-hover:brightness-125", !on && "bg-white/[0.09]")}
                      style={on ? { background: rampAt(row / (DOT_ROWS - 1)) } : undefined}
                    />
                  );
                })}
              </div>
              <span className="mt-3 font-display text-[11.5px] tabular-nums text-ink-2">{y.year}</span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/** bars in an artist's meter */
const BARCODE = 40;

/** this artist's plays against your top artist's, as a barcode lit along the signature gradient */
function Barcode({ share, delay }: { share: number; delay: number }) {
  const still = useReducedMotion();
  const lit = Math.max(1, Math.round(share * BARCODE));
  return (
    <span aria-hidden className="relative flex h-3 items-end gap-[2px]">
      {Array.from({ length: BARCODE }, (_, i) => (
        <i key={i} className="block h-full w-[3px] shrink-0 rounded-[1px] bg-white/[0.08]" />
      ))}
      <motion.span
        initial={still ? false : { clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: "inset(0 0% 0 0)" }}
        transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-y-0 left-0 flex items-end gap-[2px]"
      >
        {Array.from({ length: lit }, (_, i) => (
          <i key={i} className="block h-full w-[3px] shrink-0 rounded-[1px]" style={{ background: rampAt(i / (BARCODE - 1)) }} />
        ))}
      </motion.span>
    </span>
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
    <div onDoubleClick={onPlay} className="group grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-4 rounded-[14px] px-3 py-1.5 transition-colors duration-200 hover:bg-[var(--row-hover)]">
      {/* the top three in the signature gradient */}
      <span className={cn("text-right font-display text-[15px] font-semibold tabular-nums", rank <= 3 ? "ember:text-gradient moss:text-accent-ink" : "text-ink-3")}>{rank}</span>
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onPlay} aria-label={`Play ${song.title}`} className="relative shrink-0">
          <Artwork src={song.track?.artwork} className="size-10 rounded-[10px] shadow-[0_0_0_1px_var(--ring)]" fallback={<Music className="size-4" />} />
          <span className="absolute inset-0 grid place-items-center rounded-[10px] bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {busy ? <LoaderCircle className="size-4 animate-spin text-snow" /> : <Play className="size-4 text-snow" fill="currentColor" strokeWidth={0} />}
          </span>
        </button>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{song.title}</div>
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
          body="Import your history from Spotify, YouTube Music or Apple Music, or just keep listening in Vyse Music."
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
      <PageTitle eyebrow="From your history" title="Your listening" />
      <div className="mt-3 flex flex-wrap gap-2">
        {insights.sources.map((s) => (
          <Chip key={s.origin}>
            <span className="mr-0.5 size-1.5 rounded-full" style={{ background: ORIGIN_COLOR[s.origin] }} />
            {ORIGIN_LABEL[s.origin]} · {yearRange(s.firstAt, s.lastAt)}
          </Chip>
        ))}
        <Chip>
          <span className="mr-0.5 size-1.5 rounded-full" style={{ background: ORIGIN_COLOR.encore }} />
          Vyse Music
        </Chip>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 @3xl:grid-cols-5">
        <Stat label="plays" value={totals.plays} index={0} lit />
        {totals.ms < 3_600_000 ? (
          <Stat label="minutes listened" value={totals.ms / 60_000} index={1} />
        ) : (
          <Stat label="hours listened" value={hours(totals.ms)} format={(n) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString())} index={1} />
        )}
        <Stat label="different songs" value={totals.songs} index={2} />
        <Stat label="artists" value={totals.artists} index={3} />
        <Stat label="listening since" value={since} format={(n) => String(Math.round(n))} index={4} />
      </div>

      {insights.years.length > 1 && (
        <section className="mt-9">
          <SectionTitle>Plays by year</SectionTitle>
          <YearDots years={insights.years} />
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
                  className="group grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2 text-left transition-colors duration-200 hover:bg-[var(--row-hover)]"
                >
                  <span className={cn("self-start pt-px text-right font-display text-[13px] font-semibold tabular-nums", i < 3 ? "ember:text-gradient moss:text-accent-ink" : "text-ink-3")}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{artist.name}</span>
                    <span className="mt-1.5 block overflow-hidden">
                      <Barcode share={share} delay={0.1 + Math.min(i, 12) * 0.035} />
                    </span>
                  </span>
                  <span className="self-start pt-0.5 text-[12.5px] tabular-nums text-ink-2">{plural(artist.plays, "play")}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
