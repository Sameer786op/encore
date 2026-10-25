import { BookmarkPlus, Ellipsis, ListMusic, ListPlus } from "lucide-react";
import { Artwork } from "@/components/Artwork";
import { AmbientBackground } from "@/components/AmbientBackground";
import { CollectionHeader, Dot } from "@/components/CollectionHeader";
import { BigPlayButton, EmptyState, IconButton, ShuffleButton } from "@/components/common";
import { useTrackFinder } from "@/components/ListTools";
import { TrackList } from "@/components/TrackList";
import { addToPlaylistEntries, queueEntries } from "@/components/trackMenu";
import { useLibrary } from "@/library/store";
import { formatTotal, plural } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { remotePlaylistCache } from "./albumCache";
import { useAsync } from "./useAsync";
import { usePlayCollection } from "./usePlayCollection";

// A YouTube Music playlist opened from Home, such as a chart. Its songs can
// change from day to day, so saving it makes a copy in Your Library.

function HeaderSkeleton() {
  return (
    <div className="flex items-end gap-7">
      <div className="skeleton size-[220px] rounded-xl" />
      <div className="flex-1 pb-2">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton mt-4 h-14 w-2/3 rounded-lg" />
        <div className="skeleton mt-5 h-3.5 w-1/3 rounded" />
      </div>
    </div>
  );
}

export function RemotePlaylistPage({ id }: { id: string }) {
  const { data: playlist, error, retry } = useAsync(() => remotePlaylistCache.get(id), id);
  const tracks = playlist?.tracks ?? [];
  const context = { kind: "home" as const, label: playlist?.title ?? "Playlist", id: `ytplaylist:${id}` };
  const { play, shuffle, playing, loading } = usePlayCollection(tracks, context);
  const finder = useTrackFinder(tracks, `ytplaylist.${id}`, "Playlist order");

  const save = () => {
    const day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    void useLibrary.getState().createPlaylist(`${playlist!.title} (${day})`, tracks);
  };

  return (
    <div className="relative">
      <AmbientBackground src={playlist?.artwork} />
      <div className="relative px-8 pb-16 pt-[72px]">
        {error ? (
          <EmptyState
            icon={<ListMusic className="size-7" />}
            title="Couldn't open this playlist"
            body="It may not be available in your region, or the connection dropped."
            action={
              <button onClick={retry} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
                Try again
              </button>
            }
          />
        ) : !playlist ? (
          <HeaderSkeleton />
        ) : (
          <>
            <CollectionHeader
              art={<Artwork src={playlist.artwork} className="size-full" />}
              kind="Playlist"
              title={playlist.title}
              meta={
                <>
                  {playlist.subtitle && (
                    <>
                      <span className="text-ink">{playlist.subtitle}</span>
                      <Dot />
                    </>
                  )}
                  <span>
                    {plural(tracks.length, "song")}, {formatTotal(tracks)}
                  </span>
                </>
              }
              actions={
                tracks.length > 0 && (
                  <>
                    <BigPlayButton playing={playing} loading={loading} onClick={play} label={`Play ${playlist.title}`} />
                    <ShuffleButton onClick={shuffle} />
                    <IconButton label="Save as a playlist" onClick={save}>
                      <BookmarkPlus className="size-6" />
                    </IconButton>
                    <IconButton label="Add to playlist" onClick={(e) => openMenu(e, addToPlaylistEntries(tracks))}>
                      <ListPlus className="size-6" />
                    </IconButton>
                    <IconButton label="More options" onClick={(e) => openMenu(e, queueEntries(tracks, playlist.title))}>
                      <Ellipsis className="size-6" />
                    </IconButton>
                  </>
                )
              }
            />
            {tracks.length > 1 && finder.toolbar}
            <div className={tracks.length > 1 ? "mt-3" : "mt-8"}>{finder.noMatches ?? <TrackList tracks={finder.tracks} context={context} numbered />}</div>
            {playlist.description && <p className="mt-10 max-w-3xl whitespace-pre-line text-[13px] leading-relaxed text-ink-3">{playlist.description}</p>}
          </>
        )}
      </div>
    </div>
  );
}
