import { useState } from "react";
import { motion } from "motion/react";
import { BellRing, Check, MicVocal, Radio } from "lucide-react";
import type { ArtistSummary } from "@shared/types";
import { AlbumCard, ArtistCard, CardRow } from "@/components/Cards";
import { BigPlayButton, BlurTitle, EmptyState, KindDot, PillButton, SectionTitle } from "@/components/common";
import { TrackList } from "@/components/TrackList";
import { useLibrary } from "@/library/store";
import { usePlayer } from "@/player/store";
import { cn } from "@/lib/cn";
import { artistCache } from "./albumCache";
import { useAsync } from "./useAsync";
import { usePlayCollection } from "./usePlayCollection";

/** following an artist keeps them in Your Library and means hearing about their new releases */
function FollowButton({ artist }: { artist: ArtistSummary }) {
  const following = useLibrary((s) => s.followedIds.has(artist.id));
  const loaded = useLibrary((s) => s.loaded);
  if (!loaded) return null;
  return (
    <button
      onClick={() => void useLibrary.getState().setFollowing(artist, !following)}
      aria-pressed={following}
      className={cn(
        "glass-control pressable inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold hover:brightness-125",
        following ? "text-accent-ink" : "text-ink",
      )}
    >
      {following ? <Check className="size-4" /> : <BellRing className="size-4" />}
      {following ? "Following" : "Follow"}
    </button>
  );
}

export function ArtistPage({ id }: { id: string }) {
  const { data: artist, error, retry } = useAsync(() => artistCache.get(id), id);
  const [showAll, setShowAll] = useState(false);
  const tracks = artist?.topTracks ?? [];
  const context = { kind: "artist" as const, label: artist?.name ?? "Artist", id };
  const { play, playing, loading } = usePlayCollection(tracks, context);

  if (error) {
    return (
      <EmptyState
        icon={<MicVocal className="size-7" />}
        title="Couldn't open this artist"
        body="The connection may have dropped. Try again in a moment."
        action={
          <button onClick={retry} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
            Try again
          </button>
        }
      />
    );
  }

  return (
    <div className="relative">
      {/* the photo runs to the top, under the toolbar, and melts into the page below: in black
          and white, lit from behind by an ember glow (a lime one on Moss), with film grain */}
      <div className="relative isolate h-[440px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_56%,transparent)]">
        {artist?.artwork ? (
          <motion.img
            src={artist.artwork}
            alt=""
            referrerPolicy="no-referrer"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.4, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 size-full object-cover object-[50%_25%] brightness-[0.88] contrast-125 grayscale"
          />
        ) : (
          <div className={artist ? "absolute inset-0 bg-[#121212]" : "skeleton absolute inset-0"} />
        )}
        <span aria-hidden className="ember-only absolute inset-0 bg-[radial-gradient(55%_75%_at_92%_100%,rgb(var(--accent-rgb)/0.8),transparent_70%),radial-gradient(40%_55%_at_4%_0%,color-mix(in_srgb,var(--ramp-2)_32%,transparent),transparent_70%)]" />
        <span aria-hidden className="moss-only absolute inset-0 bg-[radial-gradient(55%_75%_at_92%_100%,rgb(150_210_40/0.7),transparent_70%),radial-gradient(40%_55%_at_4%_0%,rgb(255_255_255/0.4),transparent_70%)]" />
        <span aria-hidden className="grain absolute inset-0" />
        <div className="ember-only absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/45" />
        {/* on Moss the photo fades into milk where the name sits */}
        <div className="moss-only absolute inset-0 bg-[linear-gradient(180deg,rgb(236_237_231/0.72),rgb(236_237_231/0.22)_24%,transparent_36%,rgb(236_237_231/0.55)_62%,rgb(236_237_231/0.9))]" />
      </div>
      <div className="relative -mt-[150px] px-8">
        {artist && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}>
            <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-snow/75 moss:text-ink-2">
              <KindDot />
              Artist
            </div>
          </motion.div>
        )}
        {artist && (
          <BlurTitle
            text={artist.name}
            className="mt-2 line-clamp-2 pb-[0.06em] font-display text-[clamp(52px,7.2vw,104px)] font-bold leading-[0.94] tracking-[-0.055em] text-snow drop-shadow-[0_4px_28px_rgb(0_0_0/0.5)] moss:text-ink moss:drop-shadow-[0_2px_22px_rgb(255_255_255/0.75)]"
          />
        )}
      </div>

      {artist && (
        <div className="relative px-8 pb-16">
          <div className="mt-5 flex items-center gap-2.5">
            {tracks.length > 0 && <BigPlayButton playing={playing} loading={loading} onClick={play} label={`Play ${artist.name}`} />}
            {tracks.length > 0 && (
              <PillButton icon={<Radio className="size-4" />} onClick={() => void usePlayer.getState().startRadio(tracks[0])}>
                Artist radio
              </PillButton>
            )}
            <FollowButton artist={{ id, name: artist.name, artwork: artist.artwork }} />
          </div>

          {tracks.length > 0 && (
            <section className="mt-9">
              <SectionTitle
                action={
                  tracks.length > 5 && (
                    <button onClick={() => setShowAll((v) => !v)} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-ink hover:bg-accent/10">
                      {showAll ? "Show less" : "Show more"}
                    </button>
                  )
                }
              >
                Popular
              </SectionTitle>
              <TrackList tracks={showAll ? tracks : tracks.slice(0, 5)} context={context} showAlbum={false} />
            </section>
          )}

          {artist.albums.length > 0 && (
            <section className="mt-9">
              <SectionTitle>Albums</SectionTitle>
              <CardRow>{artist.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
            </section>
          )}

          {artist.singles.length > 0 && (
            <section className="mt-9">
              <SectionTitle>Singles and EPs</SectionTitle>
              <CardRow>{artist.singles.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
            </section>
          )}

          {artist.related.length > 0 && (
            <section className="mt-9">
              <SectionTitle>Fans also like</SectionTitle>
              <CardRow>{artist.related.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
            </section>
          )}

          {artist.description && (
            <section className="mt-12 max-w-3xl">
              <SectionTitle>About</SectionTitle>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{artist.description}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
