import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Disc3, Ellipsis, Heart, History, ListMusic, MicVocal, Plus, Trash2 } from "lucide-react";
import type { HistoryEntry, Track } from "@shared/types";
import { ACCOUNT_NAMES } from "@shared/types";
import { Mosaic } from "@/components/Artwork";
import { AmbientBackground } from "@/components/AmbientBackground";
import { AlbumCard, ArtistCard, CardGrid, LikedSongsCard, PlaylistCard } from "@/components/Cards";
import { CollectionHeader, Dot } from "@/components/CollectionHeader";
import { BigPlayButton, EmptyState, IconButton, PillButton, SectionTitle, Segmented, ShuffleButton } from "@/components/common";
import { FindField, SortButton, useListPref, useTrackFinder, type SortOption } from "@/components/ListTools";
import { ServiceIcon } from "@/components/ServiceIcon";
import { TrackList } from "@/components/TrackList";
import { playlistMenu } from "@/components/playlistMenu";
import { useAccounts } from "@/accounts/store";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { artistNames, formatTotal, plural, relativeDate, timeAgo } from "@/lib/format";
import { byText, matchesQuery } from "@/lib/search";
import { openMenu } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { usePlayCollection } from "./usePlayCollection";

type LibraryTab = "playlists" | "albums" | "artists";
const TABS: { value: LibraryTab; label: string }[] = [
  { value: "playlists", label: "Playlists" },
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" },
];

type PlaylistSort = "recent" | "added" | "name";
const PLAYLIST_SORTS: SortOption<PlaylistSort>[] = [
  { value: "recent", label: "Recently updated" },
  { value: "added", label: "Recently added" },
  { value: "name", label: "Name" },
];
type AlbumSort = "recent" | "title" | "artist" | "year";
const ALBUM_SORTS: SortOption<AlbumSort>[] = [
  { value: "recent", label: "Recently saved" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "year", label: "Release year" },
];
type ArtistSort = "recent" | "name";
const ARTIST_SORTS: SortOption<ArtistSort>[] = [
  { value: "recent", label: "Recently followed" },
  { value: "name", label: "Name" },
];
const values = <T extends string>(options: SortOption<T>[]) => options.map((o) => o.value);

function NoMatches({ query }: { query: string }) {
  return <p className="py-16 text-center text-[13.5px] text-ink-3">Nothing in your library matches “{query.trim()}”.</p>;
}

function PlaylistsTab({ query, sort }: { query: string; sort: PlaylistSort }) {
  const snapshot = useLibrary((s) => s.snapshot);
  const playlists = useMemo(() => {
    const found = snapshot.playlists.filter((p) => matchesQuery(query, p.name));
    if (sort === "name") return found.sort((a, b) => byText(a.name, b.name));
    if (sort === "added") return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return found;
  }, [snapshot.playlists, query, sort]);
  const showLiked = matchesQuery(query, "Liked Songs");

  if (!showLiked && playlists.length === 0) return <NoMatches query={query} />;
  return (
    <CardGrid>
      {showLiked && <LikedSongsCard count={snapshot.liked.length} tracks={snapshot.liked.map((l) => l.track)} />}
      {playlists.map((p) => (
        <PlaylistCard key={p.id} playlist={p} />
      ))}
      {!query.trim() && (
        <button
          onClick={() => openModal({ kind: "create-playlist" })}
          className="pressable m-2.5 grid aspect-square place-items-center rounded-[10px] border border-dashed border-white/15 text-ink-2 transition-colors hover:border-white/30 hover:bg-white/[0.03] hover:text-ink"
        >
          <span className="flex flex-col items-center gap-2 text-[13px] font-medium">
            <Plus className="size-7" strokeWidth={1.5} />
            New playlist
          </span>
        </button>
      )}
    </CardGrid>
  );
}

function AlbumsTab({ query, sort }: { query: string; sort: AlbumSort }) {
  const saved = useLibrary((s) => s.snapshot.albums);
  const albums = useMemo(() => {
    const found = saved.map((a) => a.album).filter((a) => matchesQuery(query, a.title, artistNames(a.artists), a.year));
    if (sort === "title") return found.sort((a, b) => byText(a.title, b.title));
    if (sort === "artist") return found.sort((a, b) => byText(artistNames(a.artists), artistNames(b.artists)) || byText(a.title, b.title));
    // newest first; albums without a year go last
    if (sort === "year") return found.sort((a, b) => (b.year ?? "").localeCompare(a.year ?? "") || byText(a.title, b.title));
    return found;
  }, [saved, query, sort]);

  if (saved.length === 0) {
    return <EmptyState icon={<Disc3 className="size-7" />} title="Albums you save show up here" body="Open any album and press + to keep it in Your Library." />;
  }
  if (albums.length === 0) return <NoMatches query={query} />;
  return (
    <CardGrid>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} />
      ))}
    </CardGrid>
  );
}

function ArtistsTab({ query, sort }: { query: string; sort: ArtistSort }) {
  const followed = useLibrary((s) => s.snapshot.artists);
  const artists = useMemo(() => {
    const found = followed.map((a) => a.artist).filter((a) => matchesQuery(query, a.name));
    return sort === "name" ? found.sort((a, b) => byText(a.name, b.name)) : found;
  }, [followed, query, sort]);

  if (followed.length === 0) {
    return (
      <EmptyState
        icon={<MicVocal className="size-7" />}
        title="Artists you follow show up here"
        body="Press Follow on an artist's page to keep them here and hear about their new releases."
      />
    );
  }
  if (artists.length === 0) return <NoMatches query={query} />;
  return (
    <CardGrid>
      {artists.map((artist) => (
        <ArtistCard key={artist.id} artist={artist} subtitle="Following" />
      ))}
    </CardGrid>
  );
}

export function LibraryPage() {
  const snapshot = useLibrary((s) => s.snapshot);
  const [tab, setTab] = useListPref<LibraryTab>("library.tab", "playlists", values(TABS));
  const [query, setQuery] = useState("");
  const [playlistSort, setPlaylistSort] = useListPref<PlaylistSort>("library.playlists", "recent", values(PLAYLIST_SORTS));
  const [albumSort, setAlbumSort] = useListPref<AlbumSort>("library.albums", "recent", values(ALBUM_SORTS));
  const [artistSort, setArtistSort] = useListPref<ArtistSort>("library.artists", "recent", values(ARTIST_SORTS));
  // nothing to find or sort in an empty tab
  const empty = (tab === "albums" && snapshot.albums.length === 0) || (tab === "artists" && snapshot.artists.length === 0);

  return (
    <div className="px-8 pb-16 pt-[68px]">
      <div className="flex items-end justify-between">
        <h1 className="font-display text-[34px] font-bold tracking-[-0.026em]">Your Library</h1>
        <PillButton icon={<Plus className="size-4" />} onClick={() => openModal({ kind: "create-playlist" })}>
          New playlist
        </PillButton>
      </div>
      <div className="mt-6 flex min-h-9 flex-wrap items-center gap-3">
        <Segmented label="Your Library sections" value={tab} options={TABS} onChange={setTab} />
        {!empty && (
          <div className="ml-auto flex items-center gap-2">
            <FindField value={query} onChange={setQuery} placeholder={`Find in ${tab}`} />
            {tab === "playlists" ? (
              <SortButton value={playlistSort} options={PLAYLIST_SORTS} onChange={setPlaylistSort} />
            ) : tab === "albums" ? (
              <SortButton value={albumSort} options={ALBUM_SORTS} onChange={setAlbumSort} />
            ) : (
              <SortButton value={artistSort} options={ARTIST_SORTS} onChange={setArtistSort} />
            )}
          </div>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
          className="mt-6"
        >
          {tab === "playlists" ? (
            <PlaylistsTab query={query} sort={playlistSort} />
          ) : tab === "albums" ? (
            <AlbumsTab query={query} sort={albumSort} />
          ) : (
            <ArtistsTab query={query} sort={artistSort} />
          )}
        </motion.div>
      </AnimatePresence>
      {tab === "playlists" && !query.trim() && snapshot.history.length > 0 && (
        <section className="mt-12">
          <SectionTitle
            action={
              <button onClick={() => navigate({ name: "history" })} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
                See all
              </button>
            }
          >
            Recently played
          </SectionTitle>
          <TrackList tracks={uniqueTracks(snapshot.history).slice(0, 6)} context={{ kind: "history", label: "Recently played", id: "history" }} />
        </section>
      )}
    </div>
  );
}

function uniqueTracks(history: HistoryEntry[]): Track[] {
  const seen = new Set<string>();
  return history.map((h) => h.track).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function LikedPage() {
  const liked = useLibrary((s) => s.snapshot.liked);
  const tracks = useMemo(() => liked.map((l) => l.track), [liked]);
  const likedAt = useMemo(() => new Map(liked.map((l) => [l.track.id, l.likedAt])), [liked]);
  const context = { kind: "liked" as const, label: "Liked Songs", id: "liked" };
  const { play, shuffle, playing, loading } = usePlayCollection(tracks, context);
  const finder = useTrackFinder(tracks, "liked", "Recently added");

  return (
    <div className="relative">
      <div className="relative px-8 pb-16 pt-[72px]">
        <CollectionHeader
          art={
            <div className="grid size-full place-items-center bg-gradient-to-br from-accent-2 via-accent to-accent-deep">
              <Heart className="size-20 text-snow drop-shadow-lg" fill="currentColor" strokeWidth={0} />
            </div>
          }
          kind="Collection"
          title="Liked Songs"
          meta={
            <span>
              {plural(tracks.length, "song")}
              {tracks.length > 0 && `, ${formatTotal(tracks)}`}
            </span>
          }
          actions={
            tracks.length > 0 && (
              <>
                <BigPlayButton playing={playing} loading={loading} onClick={play} label="Play Liked Songs" />
                <ShuffleButton onClick={shuffle} />
              </>
            )
          }
        />
        {tracks.length === 0 ? (
          <div className="mt-8">
            <EmptyState icon={<Heart className="size-7" />} title="Songs you like will show up here" body="Tap the heart next to any song to save it here." />
          </div>
        ) : (
          <>
            {finder.toolbar}
            <div className="mt-3">
              {finder.noMatches ?? <TrackList tracks={finder.tracks} context={context} extra={{ title: "Date added", render: (t) => relativeDate(likedAt.get(t.id) ?? "") }} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.snapshot.playlists.find((p) => p.id === id));
  const loaded = useLibrary((s) => s.loaded);
  const tracks = useMemo(() => playlist?.items.map((i) => i.track) ?? [], [playlist]);
  const context = { kind: "playlist" as const, label: playlist?.name ?? "Playlist", id };
  const { play, shuffle, playing, loading } = usePlayCollection(tracks, context);
  const finder = useTrackFinder(tracks, `playlist.${id}`);
  // when a synced playlist's account last looked for changes
  const lastSync = useAccounts((s) => s.accounts.find((a) => a.service === playlist?.synced?.service)?.lastSync);

  if (!playlist) {
    return loaded ? <EmptyState icon={<ListMusic className="size-7" />} title="This playlist doesn't exist" body="It may have been deleted." /> : null;
  }

  const itemIds = playlist.items.map((i) => i.itemId);
  const art = tracks.map((t) => t.artwork);
  // a synced playlist changes only where it comes from
  const synced = playlist.synced;
  const from = synced ? ACCOUNT_NAMES[synced.service] : "";

  return (
    <div className="relative">
      <AmbientBackground src={tracks[0]?.artwork} />
      <div className="relative px-8 pb-16 pt-[72px]">
        <CollectionHeader
          art={<Mosaic sources={art} className="size-full" fallback={<ListMusic className="size-16" strokeWidth={1.25} />} />}
          kind={synced ? `Playlist from ${from}` : "Playlist"}
          title={playlist.name}
          onTitleClick={synced ? undefined : () => openModal({ kind: "rename-playlist", id: playlist.id, name: playlist.name })}
          meta={
            <>
              {synced && (
                <>
                  <span className="inline-flex items-center gap-1.5" title={`Songs added or removed on ${from} change here too`}>
                    <ServiceIcon service={synced.service} className="size-3.5" />
                    {lastSync ? `Synced ${timeAgo(lastSync)}` : `Synced from ${from}`}
                  </span>
                  <Dot />
                </>
              )}
              <span>{plural(tracks.length, "song")}</span>
              {tracks.length > 0 && (
                <>
                  <Dot />
                  <span>{formatTotal(tracks)}</span>
                </>
              )}
            </>
          }
          actions={
            <>
              {tracks.length > 0 && (
                <>
                  <BigPlayButton playing={playing} loading={loading} onClick={play} label={`Play ${playlist.name}`} />
                  <ShuffleButton onClick={shuffle} />
                </>
              )}
              <IconButton label="More options" onClick={(e) => openMenu(e, playlistMenu(playlist))}>
                <Ellipsis className="size-6" />
              </IconButton>
            </>
          }
        />
        {tracks.length > 0 && finder.toolbar}
        <div className={tracks.length > 0 ? "mt-3" : "mt-8"}>
          {tracks.length === 0 && synced ? (
            <EmptyState
              icon={<ListMusic className="size-7" />}
              title="Nothing here yet"
              body={`Songs you add to this playlist on ${from} show up here by themselves.`}
            />
          ) : tracks.length === 0 ? (
            <EmptyState
              icon={<ListMusic className="size-7" />}
              title="This playlist is empty"
              body="Search for songs, then right-click one (or use its ⋯ menu) and choose Add to playlist."
              action={
                <PillButton onClick={() => navigate({ name: "search" })} icon={<Plus className="size-4" />}>
                  Find songs
                </PillButton>
              }
            />
          ) : (
            (finder.noMatches ?? (
              <TrackList
                tracks={finder.tracks}
                keys={finder.indexes.map((i) => itemIds[i])}
                context={context}
                extra={{ title: "Date added", render: (_t, i) => relativeDate(playlist.items[finder.indexes[i]]?.addedAt ?? "") }}
                menuExtras={
                  synced
                    ? undefined
                    : (_t, i) => [
                        {
                          label: "Remove from this playlist",
                          icon: Trash2,
                          danger: true,
                          onSelect: () => void useLibrary.getState().removeFromPlaylist(playlist.id, playlist.items[finder.indexes[i]].itemId),
                        },
                      ]
                }
                // dragging only makes sense in the playlist's own order
                onReorder={
                  finder.changed || synced
                    ? undefined
                    : (keys) => {
                        if (keys.join("|") !== itemIds.join("|")) void useLibrary.getState().reorderPlaylist(playlist.id, keys);
                      }
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const history = useLibrary((s) => s.snapshot.history);
  const clearHistory = useLibrary((s) => s.clearHistory);

  // group plays by day: Today, Yesterday, ...
  const groups = useMemo(() => {
    const out: { label: string; entries: HistoryEntry[] }[] = [];
    for (const entry of history) {
      const label = relativeDate(entry.playedAt);
      const group = out[out.length - 1];
      if (group?.label === label) group.entries.push(entry);
      else out.push({ label, entries: [entry] });
    }
    return out;
  }, [history]);

  return (
    <div className="px-8 pb-16 pt-[68px]">
      <div className="flex items-end justify-between">
        <h1 className="font-display text-[34px] font-bold tracking-[-0.026em]">Recently played</h1>
        {history.length > 0 && (
          <PillButton
            icon={<Trash2 className="size-4" />}
            onClick={() =>
              openModal({
                kind: "confirm",
                title: "Clear listening history?",
                message: "Your play history on this computer will be erased. Liked songs and playlists stay.",
                confirmLabel: "Clear history",
                danger: true,
                onConfirm: () => void clearHistory(),
              })
            }
          >
            Clear history
          </PillButton>
        )}
      </div>
      {history.length === 0 ? (
        <EmptyState icon={<History className="size-7" />} title="Nothing here yet" body="Songs you listen to for more than 30 seconds appear here." />
      ) : (
        groups.map((group) => (
          <section key={group.label} className="mt-8">
            <SectionTitle>{group.label}</SectionTitle>
            <TrackList
              tracks={group.entries.map((e) => e.track)}
              keys={group.entries.map((e, i) => `${e.playedAt}#${i}`)}
              context={{ kind: "history", label: "Recently played", id: "history" }}
              extra={{ title: "Played at", render: (_t, i) => new Date(group.entries[i].playedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }}
            />
          </section>
        ))
      )}
    </div>
  );
}
