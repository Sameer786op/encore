import { useState } from "react";
import { motion } from "motion/react";
import { Clock3, LoaderCircle, Play, RefreshCw, SearchX, X } from "lucide-react";
import type { SearchResults } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { AlbumCard, ArtistCard, CardRow, TrackCard } from "@/components/Cards";
import { EmptyState, SectionTitle } from "@/components/common";
import { TrackList } from "@/components/TrackList";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { useSearch } from "@/search/store";
import { artistNames } from "@/lib/format";
import { cn } from "@/lib/cn";

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
      className="glass group relative flex flex-1 items-center gap-5 overflow-hidden rounded-[22px] p-4 pr-20 transition-[filter] duration-300 hover:brightness-110 @3xl:flex-col @3xl:items-start @3xl:justify-end @3xl:gap-0 @3xl:p-5"
    >
      <Artwork
        src={art}
        className={cn("size-20 shadow-[0_10px_28px_-8px_rgb(0_0_0/0.6)] @3xl:mb-auto @3xl:size-24", top.kind === "artist" ? "rounded-full" : "rounded-[10px]")}
      />
      <div className="min-w-0 @3xl:mt-4 @3xl:w-full">
        <div className="line-clamp-2 font-display text-[24px] font-bold leading-tight tracking-[-0.03em] @3xl:text-[26px]">{title}</div>
        <div className="mt-0.5 truncate text-[13.5px] text-ink-2">{subtitle}</div>
      </div>
      <div className="absolute bottom-1/2 right-5 grid size-11 translate-y-1/2 scale-90 place-items-center rounded-full bg-accent text-on-accent opacity-0 shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4),0_8px_22px_-8px_rgb(var(--accent-rgb)/0.7)] transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-100 group-hover:opacity-100 @3xl:bottom-5 @3xl:translate-y-0">
        <Play className="ml-0.5 size-5" fill="currentColor" strokeWidth={0} />
      </div>
    </motion.div>
  );
}

/** search again right away instead of using what was kept from the last 10 minutes */
function RefreshResults() {
  const refresh = useSearch((s) => s.refresh);
  const loading = useSearch((s) => s.loading);
  return (
    <button
      onClick={refresh}
      disabled={loading}
      title="Ask YouTube Music again for the newest results"
      className="pressable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-70"
    >
      <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div className="mt-2 grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="skeleton h-[112px] rounded-[22px] @3xl:h-[236px]" />
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
  const loadMore = useSearch((s) => s.loadMore);
  const loadingMore = useSearch((s) => s.loadingMore);
  const [showAllSongs, setShowAllSongs] = useState(false);

  const context = { kind: "search" as const, label: `"${results?.query ?? query}"` };
  const hasAnything = results && (results.tracks.length || results.albums.length || results.artists.length || results.videos.length);

  // with a top result, the first four songs sit beside it and the rest come after albums;
  // without one, all the songs lead
  const skip = results?.top ? 4 : 0;
  const moreSongs = results && results.tracks.length > skip && (
    <section className="mt-9">
      <SectionTitle
        action={
          <div className="flex items-center gap-1">
            {/* with a top result, Refresh sits by the first songs at the top instead */}
            {!skip && <RefreshResults />}
            {results.tracks.length > skip + 10 && (
              <button onClick={() => setShowAllSongs((v) => !v)} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
                {showAllSongs ? "Show less" : "Show all"}
              </button>
            )}
          </div>
        }
      >
        {skip ? "More songs" : "Songs"}
      </SectionTitle>
      <TrackList tracks={results.tracks.slice(skip, showAllSongs ? undefined : skip + 10)} context={context} />
      {results.moreSongs && (showAllSongs || results.tracks.length <= skip + 10) && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => {
              setShowAllSongs(true);
              void loadMore();
            }}
            disabled={loadingMore}
            className="glass-control pressable inline-flex h-9 items-center gap-2 rounded-full px-5 text-[13px] font-semibold text-ink hover:brightness-125 disabled:opacity-70"
          >
            {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
            {loadingMore ? "Loading more songs" : "Show more songs"}
          </button>
        </div>
      )}
    </section>
  );

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
            <div className="grid grid-cols-1 gap-x-6 gap-y-8 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <section className="flex flex-col">
                <SectionTitle>Top result</SectionTitle>
                <TopResult results={results} />
              </section>
              <section className="min-w-0">
                <SectionTitle action={<RefreshResults />}>Songs</SectionTitle>
                <TrackList tracks={results.tracks.slice(0, 4)} context={context} showAlbum={false} />
              </section>
            </div>
          )}

          {!results.top && moreSongs}

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

          {results.top && moreSongs}

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
