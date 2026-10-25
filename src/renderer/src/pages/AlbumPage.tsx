import { Disc3, Ellipsis, ListPlus } from "lucide-react";
import { Artwork } from "@/components/Artwork";
import { AmbientBackground } from "@/components/AmbientBackground";
import { CollectionHeader, Dot } from "@/components/CollectionHeader";
import { ArtistLinks, BigPlayButton, EmptyState, IconButton, ShuffleButton } from "@/components/common";
import { TrackList } from "@/components/TrackList";
import { addToPlaylistEntries, queueEntries } from "@/components/trackMenu";
import { formatTotal, plural } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { albumCache } from "./albumCache";
import { useAsync } from "./useAsync";
import { usePlayCollection } from "./usePlayCollection";

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

export function AlbumPage({ id }: { id: string }) {
  const { data: album, error, retry } = useAsync(() => albumCache.get(id), id);
  const tracks = album?.tracks ?? [];
  const context = { kind: "album" as const, label: album?.title ?? "Album", id };
  const { play, shuffle, playing, loading } = usePlayCollection(tracks, context);

  return (
    <div className="relative">
      <AmbientBackground src={album?.artwork} />
      <div className="relative px-8 pb-16 pt-[72px]">
        {error ? (
          <EmptyState
            icon={<Disc3 className="size-7" />}
            title="Couldn't open this album"
            body="It may not be available in your region, or the connection dropped."
            action={
              <button onClick={retry} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
                Try again
              </button>
            }
          />
        ) : !album ? (
          <HeaderSkeleton />
        ) : (
          <>
            <CollectionHeader
              art={<Artwork src={album.artwork} className="size-full" />}
              kind={album.kind ?? "Album"}
              title={album.title}
              meta={
                <>
                  <ArtistLinks artists={album.artists} className="font-semibold text-accent" />
                  {album.year && (
                    <>
                      <Dot />
                      <span>{album.year}</span>
                    </>
                  )}
                  <Dot />
                  <span>
                    {plural(tracks.length, "song")}, {formatTotal(tracks)}
                  </span>
                </>
              }
              actions={
                tracks.length > 0 && (
                  <>
                    <BigPlayButton playing={playing} loading={loading} onClick={play} label={`Play ${album.title}`} />
                    <ShuffleButton onClick={shuffle} />
                    <IconButton label="Add to playlist" onClick={(e) => openMenu(e, addToPlaylistEntries(tracks))}>
                      <ListPlus className="size-6" />
                    </IconButton>
                    <IconButton label="More options" onClick={(e) => openMenu(e, queueEntries(tracks, album.title))}>
                      <Ellipsis className="size-6" />
                    </IconButton>
                  </>
                )
              }
            />
            <div className="mt-8">
              <TrackList tracks={tracks} context={context} numbered showAlbum={false} />
            </div>
            {album.description && <p className="mt-10 max-w-3xl whitespace-pre-line text-[13px] leading-relaxed text-ink-3">{album.description}</p>}
          </>
        )}
      </div>
    </div>
  );
}
