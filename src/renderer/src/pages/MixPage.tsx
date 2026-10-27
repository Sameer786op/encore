import { BookmarkPlus, Ellipsis, ListPlus, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { isMoodId, moodById } from "@shared/moods";
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
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { openMenu } from "@/ui/menu";
import { toast } from "@/ui/toast";
import { usePlayCollection } from "./usePlayCollection";

export function MixPage({ id }: { id: string }) {
  const feed = useFeed((s) => s.feed);
  const loaded = useFeed((s) => s.loaded);
  const moodMixes = useFeed((s) => s.moodMixes);
  const moodBuilding = useFeed((s) => s.moodBuilding);
  const mix = feed?.mixes.find((m) => m.id === id) ?? moodMixes.find((m) => m.id === id);
  const tracks = mix?.tracks ?? [];
  const context = { kind: "mix" as const, label: mix?.title ?? "Daily mix", id };
  const { play, shuffle, playing, loading } = usePlayCollection(tracks, context);
  const finder = useTrackFinder(tracks, "mix", "Mix order");
  const moodId = id.replace(/^mood-/, "");
  const mood = id.startsWith("mood-") && isMoodId(moodId) ? moodById(moodId) : null;
  const remaking = !!mood && moodBuilding === mood.id;

  const remake = async (fresh: boolean) => {
    if (!mood) return;
    try {
      await useFeed.getState().moodMix(mood.id, fresh);
      if (fresh) toast(`Here's a new ${mood.name} mix`);
    } catch (error) {
      toast(friendlyError(error, `Couldn't make a ${mood.name} mix right now.`), { kind: "error" });
    }
  };

  if (!mix) {
    if (!loaded) return null;
    return (
      <div className="px-8 pt-16">
        <EmptyState
          icon={<Sparkles className="size-7" />}
          title="This mix has moved on"
          body={
            mood
              ? "Mood mixes are made fresh every day from what you've been playing."
              : "Daily mixes are made fresh every day from what you've been playing. Today's are on the home page."
          }
          action={
            mood ? (
              <button
                onClick={() => void remake(false)}
                disabled={remaking}
                className="glass-control pressable inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125 disabled:opacity-70"
              >
                {remaking && <LoaderCircle className="size-4 animate-spin" />}
                Make today's {mood.name} mix
              </button>
            ) : (
              <button onClick={() => navigate({ name: "home" })} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
                Go home
              </button>
            )
          }
        />
      </div>
    );
  }

  const save = () => {
    const day = new Date(feed?.builtAt ?? Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    void useLibrary.getState().createPlaylist(`${mix.title} (${day})`, tracks);
  };

  return (
    <div className="relative">
      <AmbientBackground src={mix.artists.find((a) => a.artwork)?.artwork ?? (mood ? tracks.find((t) => t.artwork)?.artwork : undefined)} />
      <div className="relative px-8 pb-16 pt-[72px]">
        <CollectionHeader
          art={<MixCover mix={mix} className="size-full" live />}
          kind={mood ? "Mood mix" : "Made for you"}
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
              {mood && (
                <button
                  onClick={() => void remake(true)}
                  disabled={remaking}
                  title={`Make a different ${mood.name} mix`}
                  className="glass-control pressable inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-ink hover:brightness-125 disabled:opacity-80"
                >
                  <RefreshCw className={cn("size-4", remaking && "animate-spin")} />
                  {remaking ? "Making…" : "New mix"}
                </button>
              )}
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
        <p className="mt-8 text-[12.5px] text-ink-3">
          {mood
            ? `Your songs that suit the mood, with YouTube Music's radio tuned to ${mood.name.toLowerCase()}. A new one is made every day; press New mix for another, or save it as a playlist to keep this one.`
            : "A new version of this mix is made every day. Save it as a playlist to keep this one."}
        </p>
      </div>
    </div>
  );
}
