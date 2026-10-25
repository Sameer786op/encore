import { useState } from "react";
import { motion } from "motion/react";
import { Clock3, Play, SearchX, X } from "lucide-react";
import type { SearchResults } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { AlbumCard, ArtistCard, CardRow, TrackCard } from "@/components/Cards";
import { EmptyState, SectionTitle } from "@/components/common";
import { TrackList } from "@/components/TrackList";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { useSearch } from "@/search/store";
import { artistNames } from "@/lib/format";

function TopResult({ results }: { results: SearchResults }) {
  const top = results.top;
  if (!top) return null;
  const art = top.kind === "track" ? top.track.artwork : top.kind === "album" ? top.album.artwork : top.artist.artwork;
  const title = top.kind === "track" ? top.track.title : top.kind === "album" ? top.album.title : top.artist.name;
  const subtitle = top.kind === "track" ? `Song • ${artistNames(top.track.artists)}` : top.kind === "album" ? `${top.album.kind ?? "Album"} • ${artistNames(top.album.artists)}` : "Artist";
  const open = () => {
    if (top.kind === "track") usePlayer.getState().playTracks([top.track, ...results.tracks.filter((t) => t.id !== top.track.id)], 0, { kind: "search", label: `"${results.query}"` });
    else if (top.kind === "album") navigate({ name: "album", id: top.album.id });
    else navigate({ name: "artist", id: top.artist.id });
  };
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      className="glass group relative flex flex-1 items-center gap-6 overflow-hidden rounded-[24px] p-6 transition-[filter] duration-300 hover:brightness-110 @5xl:min-h-[236px] @5xl:flex-col @5xl:items-start @5xl:justify-end @5xl:gap-0"
    >
      <Artwork src={art} className={top.kind === "artist" ? "size-28 rounded-full shadow-xl shadow-black/40 @5xl:mb-auto" : "size-28 rounded-[12px] shadow-xl shadow-black/40 @5xl:mb-auto"} />
      <div className="min-w-0 @5xl:mt-5 @5xl:w-full">
        <div className="line-clamp-2 font-display text-[30px] font-bold leading-tight tracking-[-0.03em]">{title}</div>
        <div className="mt-1 truncate text-[14px] text-ink-2">{subtitle}</div>
      </div>
      <div className="absolute bottom-6 right-6 grid size-12 scale-75 place-items-center rounded-full bg-accent text-white opacity-0 shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4),0_8px_22px_-8px_rgb(250_45_72/0.7)] transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-100 group-hover:opacity-100">
        <Play className="ml-0.5 size-5" fill="currentColor" strokeWidth={0} />
      </div>
    </motion.div>
  );
}

function SearchSkeleton() {
  return (
    <div className="mt-2 grid grid-cols-[2fr_3fr] gap-6">
      <div className="skeleton h-[236px] rounded-[24px]" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton size-12 rounded-md" />
            <div className="flex-1">
              <div className="skeleton h-3.5 w-2/3 rounded" />
              <div className="skeleton mt-2 h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentSearches() {
  const recent = useSearch((s) => s.recent);
  const submit = useSearch((s) => s.submit);
  const forget = useSearch((s) => s.forgetRecent);
  const clear = useSearch((s) => s.clearRecent);
  if (recent.length === 0) {
    return <EmptyState icon={<SearchX className="size-7" />} title="Find something to play" body="Search YouTube Music's whole catalog: songs, albums, artists and live versions. No ads, no account." />;
  }
  return (
    <section className="max-w-2xl">
      <SectionTitle
        action={
          <button onClick={clear} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
            Clear all
          </button>
        }
      >
        Recent searches
      </SectionTitle>
      <div className="flex flex-col">
        {recent.map((q) => (
          <div key={q} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.06]">
            <Clock3 className="size-4 text-ink-3" />
            <button onClick={() => submit(q)} className="min-w-0 flex-1 truncate text-left text-[14px]">
              {q}
            </button>
            <button onClick={() => forget(q)} aria-label={`Remove ${q}`} className="rounded-full p-1 text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SearchPage() {
  const query = useSearch((s) => s.query);
  const results = useSearch((s) => s.results);
  const loading = useSearch((s) => s.loading);
  const error = useSearch((s) => s.error);
  const submit = useSearch((s) => s.submit);
  const [showAllSongs, setShowAllSongs] = useState(false);

  const context = { kind: "search" as const, label: `"${results?.query ?? query}"` };
  const hasAnything = results && (results.tracks.length || results.albums.length || results.artists.length || results.videos.length);

  return (
    <div className="@container px-8 pb-16 pt-[68px]">
      {!query.trim() && <RecentSearches />}

      {query.trim() && loading && !results && <SearchSkeleton />}

      {query.trim() && error && (
        <EmptyState
          icon={<SearchX className="size-7" />}
          title="Search didn't go through"
          body={error}
          action={
            <button onClick={() => submit()} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
              Try again
            </button>
          }
        />
      )}

      {query.trim() && results && !hasAnything && !loading && (
        <EmptyState icon={<SearchX className="size-7" />} title={`No results for "${results.query}"`} body="Check the spelling, or try fewer or different words." />
      )}

      {query.trim() && results && hasAnything ? (
        <motion.div key={results.query} initial={{ opacity: 0 }} animate={{ opacity: loading ? 0.6 : 1 }} transition={{ duration: 0.2 }}>
          {results.top && (
            <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <section className="flex flex-col">
                <SectionTitle>Top result</SectionTitle>
                <TopResult results={results} />
              </section>
              <section className="min-w-0">
                <SectionTitle>Songs</SectionTitle>
                <TrackList tracks={results.tracks.slice(0, 4)} context={context} showAlbum={false} />
              </section>
            </div>
          )}

          {results.tracks.length > (results.top ? 4 : 0) && (
            <section className="mt-9">
              <SectionTitle
                action={
                  results.tracks.length > 10 && (
                    <button onClick={() => setShowAllSongs((v) => !v)} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
                      {showAllSongs ? "Show less" : "Show all"}
                    </button>
                  )
                }
              >
                {results.top ? "More songs" : "Songs"}
              </SectionTitle>
              <TrackList tracks={results.tracks.slice(results.top ? 4 : 0, showAllSongs ? undefined : (results.top ? 4 : 0) + 10)} context={context} />
            </section>
          )}

          {results.artists.length > 0 && (
            <section className="mt-9">
              <SectionTitle>Artists</SectionTitle>
              <CardRow>{results.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
            </section>
          )}

          {results.albums.length > 0 && (
            <section className="mt-9">
              <SectionTitle>Albums</SectionTitle>
              <CardRow>{results.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
            </section>
          )}

          {results.videos.length > 0 && (
            <section className="mt-9">
              <SectionTitle>Videos and live versions</SectionTitle>
              <CardRow>
                {results.videos.map((t, i) => (
                  <TrackCard key={t.id} track={t} list={results.videos} index={i} context={context} />
                ))}
              </CardRow>
            </section>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
