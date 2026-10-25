import { useMemo } from "react";
import { Ellipsis, Heart, History, ListMusic, Plus, Trash2 } from "lucide-react";
import type { HistoryEntry, Track } from "@shared/types";
import { Mosaic } from "@/components/Artwork";
import { AmbientBackground } from "@/components/AmbientBackground";
import { CardGrid, LikedSongsCard, PlaylistCard } from "@/components/Cards";
import { CollectionHeader, Dot } from "@/components/CollectionHeader";
import { BigPlayButton, EmptyState, IconButton, PillButton, SectionTitle, ShuffleButton } from "@/components/common";
import { TrackList } from "@/components/TrackList";
import { playlistMenu } from "@/components/playlistMenu";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { formatTotal, plural, relativeDate } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { usePlayCollection } from "./usePlayCollection";

export function LibraryPage() {
  const snapshot = useLibrary((s) => s.snapshot);
  return (
    <div className="px-8 pb-16 pt-[68px]">
      <div className="flex items-end justify-between">
        <h1 className="font-display text-[34px] font-bold tracking-[-0.026em]">Your Library</h1>
        <PillButton icon={<Plus className="size-4" />} onClick={() => openModal({ kind: "create-playlist" })}>
          New playlist
        </PillButton>
      </div>
      <div className="mt-8">
        <CardGrid>
          <LikedSongsCard count={snapshot.liked.length} tracks={snapshot.liked.map((l) => l.track)} />
          {snapshot.playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
          <button
            onClick={() => openModal({ kind: "create-playlist" })}
            className="pressable m-2.5 grid aspect-square place-items-center rounded-[10px] border border-dashed border-white/15 text-ink-2 transition-colors hover:border-white/30 hover:bg-white/[0.03] hover:text-ink"
          >
            <span className="flex flex-col items-center gap-2 text-[13px] font-medium">
              <Plus className="size-7" strokeWidth={1.5} />
              New playlist
            </span>
          </button>
        </CardGrid>
      </div>
      {snapshot.history.length > 0 && (
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

  return (
    <div className="relative">
      <div className="relative px-8 pb-16 pt-[72px]">
        <CollectionHeader
          art={
            <div className="grid size-full place-items-center bg-gradient-to-br from-[#ff6b81] via-[#fa2d48] to-[#a3122d]">
              <Heart className="size-20 text-white drop-shadow-lg" fill="currentColor" strokeWidth={0} />
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
        <div className="mt-8">
          {tracks.length === 0 ? (
            <EmptyState icon={<Heart className="size-7" />} title="Songs you like will show up here" body="Tap the heart next to any song to save it here." />
          ) : (
            <TrackList tracks={tracks} context={context} extra={{ title: "Date added", render: (t) => relativeDate(likedAt.get(t.id) ?? "") }} />
          )}
        </div>
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

  if (!playlist) {
    return loaded ? <EmptyState icon={<ListMusic className="size-7" />} title="This playlist doesn't exist" body="It may have been deleted." /> : null;
  }

  const itemIds = playlist.items.map((i) => i.itemId);
  const art = tracks.map((t) => t.artwork);

  return (
    <div className="relative">
      <AmbientBackground src={tracks[0]?.artwork} />
      <div className="relative px-8 pb-16 pt-[72px]">
        <CollectionHeader
          art={<Mosaic sources={art} className="size-full" fallback={<ListMusic className="size-16" strokeWidth={1.25} />} />}
          kind="Playlist"
          title={playlist.name}
          onTitleClick={() => openModal({ kind: "rename-playlist", id: playlist.id, name: playlist.name })}
          meta={
            <>
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
        <div className="mt-8">
          {tracks.length === 0 ? (
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
            <TrackList
              tracks={tracks}
              keys={itemIds}
              context={context}
              extra={{ title: "Date added", render: (_t, i) => relativeDate(playlist.items[i]?.addedAt ?? "") }}
              menuExtras={(_t, i) => [
                {
                  label: "Remove from this playlist",
                  icon: Trash2,
                  danger: true,
                  onSelect: () => void useLibrary.getState().removeFromPlaylist(playlist.id, playlist.items[i].itemId),
                },
              ]}
              onReorder={(keys) => {
                if (keys.join("|") !== itemIds.join("|")) void useLibrary.getState().reorderPlaylist(playlist.id, keys);
              }}
            />
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
