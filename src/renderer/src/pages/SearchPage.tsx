import { useState } from "react";
import { motion } from "motion/react";
import { Clock3, LoaderCircle, Play, RefreshCw, Search, SearchX, X } from "lucide-react";
import type { SearchResults, SearchTab } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { AlbumCard, ArtistCard, CardGrid, CardRow, RemotePlaylistCard, TrackCard } from "@/components/Cards";
import { EmptyState, KindDot, SectionTitle, SPRING } from "@/components/common";
import { Eyebrow, Glow } from "@/components/home/Tile";
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
  const kind = top.kind === "track" ? "Song" : top.kind === "album" ? (top.album.kind ?? "Album") : "Artist";
  const byline = top.kind === "track" ? artistNames(top.track.artists) : top.kind === "album" ? artistNames(top.album.artists) : null;
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
      className="tile group relative isolate flex flex-1 items-center gap-5 overflow-hidden p-4 pr-20 transition-[filter] duration-300 hover:brightness-110 @3xl:flex-col @3xl:items-start @3xl:justify-end @3xl:gap-0 @3xl:p-6"
    >
      <Glow className="ember-only" style={{ background: "radial-gradient(70% 80% at 100% 100%, rgb(var(--accent-rgb) / 0.28), transparent 70%)" }} />
      <Glow className="moss-only" style={{ background: "radial-gradient(70% 80% at 100% 100%, rgb(150 210 40 / 0.3), transparent 70%)" }} />
      <Artwork
        src={art}
        className={cn(
          "size-20 shadow-[0_0_0_1px_var(--ring),0_14px_30px_-12px_rgb(0_0_0/calc(0.7*var(--shadow-k)))] @3xl:mb-auto @3xl:size-28",
          // an artist in black and white, back in colour under the pointer
          top.kind === "artist" ? "rounded-full grayscale transition-[filter] duration-500 group-hover:grayscale-0" : "rounded-[18px]",
        )}
      />
      <div className="min-w-0 @3xl:mt-5 @3xl:w-full">
        <Eyebrow className="flex items-center gap-2">
          <KindDot />
          {kind}
        </Eyebrow>
        <div className="mt-1.5 line-clamp-2 pb-[0.06em] font-display text-[26px] font-bold leading-[1.04] tracking-[-0.04em] @3xl:text-[34px]">{title}</div>
        {byline && <div className="mt-1 truncate text-[13.5px] text-ink-2">{byline}</div>}
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
      className="pressable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-ink hover:bg-accent/10 disabled:opacity-70"
    >
      <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div className="mt-2 grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="skeleton h-[112px] rounded-[24px] @3xl:h-[236px]" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton size-10 rounded-[10px]" />
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
          <button onClick={clear} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-ink hover:bg-accent/10">
            Clear all
          </button>
        }
      >
        Recent searches
      </SectionTitle>
      <div className="flex flex-col">
        {recent.map((q) => (
          <div key={q} className="group flex items-center gap-3 rounded-[14px] px-3 py-2 transition-colors duration-200 hover:bg-[var(--row-hover)]">
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

const TABS: { value: SearchTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "songs", label: "Songs" },
  { value: "videos", label: "Videos" },
  { value: "artists", label: "Artists" },
  { value: "albums", label: "Albums" },
  { value: "playlists", label: "Playlists" },
];

/** All, Songs, Videos… the accent pill slides to the one picked */
function SearchTabs() {
  const tab = useSearch((s) => s.tab);
  const setTab = useSearch((s) => s.setTab);
  return (
    <div role="tablist" aria-label="Kinds of results" className="mb-7 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={tab === t.value}
          onClick={() => setTab(t.value)}
          className={cn(
            "pressable relative h-8 rounded-full px-4 text-[13px] font-semibold transition-[color,filter] duration-200",
            tab === t.value ? "text-on-accent" : "glass-control text-ink hover:brightness-125",
          )}
        >
          {tab === t.value && (
            <motion.span
              layoutId="search-tab"
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
              className="absolute inset-0 rounded-full bg-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.45),inset_0_-1px_1px_rgb(0_0_0/0.18),0_6px_18px_-8px_rgb(var(--accent-rgb)/0.7)]"
            />
          )}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** the page scrolls in a column of its own; a new search starts at its top */
const toTop = (from: Element) => from.closest(".overflow-y-auto")?.scrollTo({ top: 0, behavior: "smooth" });

/** "Showing results for…" when YouTube Music corrected the spelling, "Did you mean…?" when it only suggests one */
function Correction({ results }: { results: SearchResults }) {
  const submit = useSearch((s) => s.submit);
  if (results.showingFor) {
    return (
      <p className="-mt-2 mb-6 text-[14px] text-ink-2">
        Showing results for <span className="font-semibold text-ink">{results.showingFor}</span>
      </p>
    );
  }
  if (!results.didYouMean) return null;
  const meant = results.didYouMean;
  return (
    <p className="-mt-2 mb-6 text-[14px] text-ink-2">
      Did you mean{" "}
      <button
        onClick={(e) => {
          submit(meant);
          toTop(e.currentTarget);
        }}
        className="font-semibold text-accent-ink underline-offset-2 hover:underline"
      >
        {meant}
      </button>
      ?
    </p>
  );
}

/** other searches to try, as chips; picking one searches it */
function RelatedSearches({ queries, title = "Related searches", centered, className }: { queries: string[]; title?: string; centered?: boolean; className?: string }) {
  const submit = useSearch((s) => s.submit);
  if (queries.length === 0) return null;
  return (
    <section aria-label={title} className={className}>
      {title && <h2 className={cn("mb-3 font-display text-[17px] font-bold tracking-[-0.02em]", centered && "text-center")}>{title}</h2>}
      <div className={cn("flex flex-wrap gap-2", centered && "justify-center")}>
        {queries.map((q, i) => (
          <motion.button
            key={q}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ ...SPRING, delay: i * 0.035 }}
            onClick={(e) => {
              submit(q);
              toTop(e.currentTarget);
            }}
            className="glass-control inline-flex h-9 max-w-full items-center gap-2 rounded-full pl-3.5 pr-4 text-[13.5px] font-medium text-ink transition-[filter] hover:brightness-125"
          >
            <Search className="size-3.5 shrink-0 text-ink-3" strokeWidth={2.4} />
            <span className="truncate">{q}</span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function ShowMore({ what }: { what: "songs" | "videos" }) {
  const loadMore = useSearch((s) => s.loadMore);
  const loadingMore = useSearch((s) => s.loadingMore);
  return (
    <div className="mt-4 flex justify-center">
      <button
        onClick={() => void loadMore(what)}
        disabled={loadingMore}
        className="glass-control pressable inline-flex h-9 items-center gap-2 rounded-full px-5 text-[13px] font-semibold text-ink hover:brightness-125 disabled:opacity-70"
      >
        {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
        {loadingMore ? `Loading more ${what}` : `Show more ${what}`}
      </button>
    </div>
  );
}

/** a tab with nothing on it still offers somewhere to go */
function NothingHere({ what, results }: { what: string; results: SearchResults }) {
  return (
    <div className="py-10">
      <p className="mb-6 text-[14px] text-ink-2">
        No {what} for "{results.showingFor ?? results.query}".
      </p>
      <RelatedSearches queries={results.related} title="Try searching for" />
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(172px,1fr))] gap-x-5 gap-y-6">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i}>
          <div className="skeleton aspect-square rounded-[18px]" />
          <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

/** the Artists, Albums and Playlists tabs, which ask YouTube Music for that kind alone */
function KindResults({ tab, results }: { tab: "artists" | "albums" | "playlists"; results: SearchResults }) {
  const kind = useSearch((s) => s.kind);
  const loading = useSearch((s) => s.kindLoading);
  const failed = useSearch((s) => s.kindError);
  const setTab = useSearch((s) => s.setTab);
  const q = results.showingFor ?? results.query;
  const current = kind && kind.tab === tab && kind.query === q ? kind.results : null;
  if (failed && !current) {
    return (
      <EmptyState
        icon={<SearchX className="size-7" />}
        title={`Couldn't load ${tab}`}
        body="Check your connection and try again."
        action={
          <button onClick={() => setTab(tab)} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
            Try again
          </button>
        }
      />
    );
  }
  if (!current) return loading ? <CardsSkeleton /> : null;
  const list = current[tab];
  if (list.length === 0) return <NothingHere what={tab} results={results} />;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: loading ? 0.6 : 1 }} transition={{ duration: 0.2 }}>
      <CardGrid>
        {tab === "artists" && current.artists.map((a) => <ArtistCard key={a.id} artist={a} subtitle={a.subtitle?.replace(/^Artist\s*•\s*/, "") || "Artist"} />)}
        {tab === "albums" && current.albums.map((a) => <AlbumCard key={a.id} album={a} />)}
        {tab === "playlists" && current.playlists.map((p) => <RemotePlaylistCard key={p.id} playlist={p} />)}
      </CardGrid>
    </motion.div>
  );
}

function AllResults({ results }: { results: SearchResults }) {
  const [showAllSongs, setShowAllSongs] = useState(false);
  const context = { kind: "search" as const, label: `"${results.query}"` };

  // with a top result, the first four songs sit beside it and the rest come after albums;
  // without one, all the songs lead
  const skip = results.top ? 4 : 0;
  const moreSongs = results.tracks.length > skip && (
    <section className="mt-9 first:mt-0">
      <SectionTitle
        action={
          <div className="flex items-center gap-1">
            {/* with a top result, Refresh sits by the first songs at the top instead */}
            {!skip && <RefreshResults />}
            {results.tracks.length > skip + 10 && (
              <button onClick={() => setShowAllSongs((v) => !v)} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-ink hover:bg-accent/10">
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
        <div onClickCapture={() => setShowAllSongs(true)}>
          <ShowMore what="songs" />
        </div>
      )}
    </section>
  );

  return (
    <>
      {/* when nothing holds the words searched, other searches come first */}
      {results.noExactMatch && <RelatedSearches queries={results.related} className="mb-9" />}

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
            {results.videos.slice(0, 12).map((t, i, list) => (
              <TrackCard key={t.id} track={t} list={list} index={i} context={context} />
            ))}
          </CardRow>
        </section>
      )}

      {results.playlists.length > 0 && (
        <section className="mt-9">
          <SectionTitle>Playlists</SectionTitle>
          <CardRow>{results.playlists.map((p) => <RemotePlaylistCard key={p.id} playlist={p} />)}</CardRow>
        </section>
      )}

      {!results.noExactMatch && <RelatedSearches queries={results.related} className="mt-11" />}
    </>
  );
}

export function SearchPage() {
  const query = useSearch((s) => s.query);
  const results = useSearch((s) => s.results);
  const loading = useSearch((s) => s.loading);
  const error = useSearch((s) => s.error);
  const submit = useSearch((s) => s.submit);
  const tab = useSearch((s) => s.tab);

  const context = { kind: "search" as const, label: `"${results?.query ?? query}"` };
  const hasAnything = results && (results.tracks.length || results.albums.length || results.artists.length || results.videos.length || results.playlists.length);

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
        <EmptyState
          icon={<SearchX className="size-7" />}
          title={`No results for "${results.query}"`}
          body={results.related.length ? "Try one of these searches instead." : "Check the spelling, or try fewer or different words."}
          action={results.related.length > 0 && <RelatedSearches queries={results.related} title="" centered />}
        />
      )}

      {query.trim() && results && hasAnything ? (
        <>
          <SearchTabs />
          <motion.div key={`${results.query}:${tab}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: loading ? 0.6 : 1, y: 0 }} transition={{ opacity: { duration: 0.2 }, y: { type: "spring", stiffness: 300, damping: 32 } }}>
            <Correction results={results} />

            {tab === "all" && <AllResults results={results} />}

            {tab === "songs" &&
              (results.tracks.length === 0 ? (
                <NothingHere what="songs" results={results} />
              ) : (
                <section>
                  <SectionTitle action={<RefreshResults />}>Songs</SectionTitle>
                  <TrackList tracks={results.tracks} context={context} />
                  {results.moreSongs && <ShowMore what="songs" />}
                </section>
              ))}

            {tab === "videos" &&
              (results.videos.length === 0 ? (
                <NothingHere what="videos" results={results} />
              ) : (
                <section>
                  <SectionTitle action={<RefreshResults />}>Videos and live versions</SectionTitle>
                  <TrackList tracks={results.videos} context={context} showAlbum={false} />
                  {results.moreVideos && <ShowMore what="videos" />}
                </section>
              ))}

            {(tab === "artists" || tab === "albums" || tab === "playlists") && <KindResults tab={tab} results={results} />}
          </motion.div>
        </>
      ) : null}
    </div>
  );
}
