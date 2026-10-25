import { BookmarkPlus, Ellipsis, ListPlus, Sparkles } from "lucide-react";
import { AmbientBackground } from "@/components/AmbientBackground";
import { ArtistCard, CardRow } from "@/components/Cards";
import { CollectionHeader, Dot } from "@/components/CollectionHeader";
import { BigPlayButton, EmptyState, IconButton, SectionTitle, ShuffleButton } from "@/components/common";
import { MixCover } from "@/components/MixCover";
import { useTrackFinder } from "@/components/ListTools";
import { TrackList } from "@/components/TrackList";
import { addToPlaylistEntries, queueEntries } from "@/components/trackMenu";
import { useFeed } from "@/feed/store";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { formatTotal, plural } from "@/lib/format";
import { openMenu } from "@/ui/menu";
import { usePlayCollection } from "./usePlayCollection";

export function MixPage({ id }: { id: string }) {
  const feed = useFeed((s) => s.feed);
  const loaded = useFeed((s) => s.loaded);
  const mix = feed?.mixes.find((m) => m.id === id);
  const tracks = mix?.tracks ?? [];
  const context = { kind: "mix" as const, label: mix?.title ?? "Daily mix", id };
  const { play, shuffle, playing, loading } = usePlayCollection(tracks, context);
  const finder = useTrackFinder(tracks, "mix", "Mix order");

  if (!mix) {
    if (!loaded) return null;
    return (
      <div className="px-8 pt-16">
        <EmptyState
          icon={<Sparkles className="size-7" />}
          title="This mix has moved on"
          body="Daily mixes are made fresh every day from what you've been playing. Today's are on the home page."
          action={
            <button onClick={() => navigate({ name: "home" })} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
              Go home
            </button>
          }
        />
      </div>
    );
  }

  const save = () => {
    const day = new Date(feed!.builtAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    void useLibrary.getState().createPlaylist(`${mix.title} (${day})`, tracks);
  };

  return (
    <div className="relative">
      <AmbientBackground src={mix.artists.find((a) => a.artwork)?.artwork} />
      <div className="relative px-8 pb-16 pt-[72px]">
        <CollectionHeader
          art={<MixCover mix={mix} className="size-full" />}
          kind="Made for you"
          title={mix.title}
          meta={
            <>
              <span className="text-ink">{mix.description}</span>
              <Dot />
              <span>
                {plural(tracks.length, "song")}, {formatTotal(tracks)}
              </span>
            </>
          }
          actions={
            <>
              <BigPlayButton playing={playing} loading={loading} onClick={play} label={`Play ${mix.title}`} />
              <ShuffleButton onClick={shuffle} />
              <IconButton label="Save as a playlist" onClick={save}>
                <BookmarkPlus className="size-6" />
              </IconButton>
              <IconButton label="Add to playlist" onClick={(e) => openMenu(e, addToPlaylistEntries(tracks))}>
                <ListPlus className="size-6" />
              </IconButton>
              <IconButton label="More options" onClick={(e) => openMenu(e, queueEntries(tracks, mix.title))}>
                <Ellipsis className="size-6" />
              </IconButton>
            </>
          }
        />
        {finder.toolbar}
        <div className="mt-3">{finder.noMatches ?? <TrackList tracks={finder.tracks} context={context} numbered />}</div>
        {mix.artists.length > 0 && (
          <section className="mt-12">
            <SectionTitle>Built around</SectionTitle>
            <CardRow>{mix.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
          </section>
        )}
        <p className="mt-8 text-[12.5px] text-ink-3">A new version of this mix is made every day. Save it as a playlist to keep this one.</p>
      </div>
    </div>
  );
}
