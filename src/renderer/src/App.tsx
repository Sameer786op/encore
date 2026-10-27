import { useEffect, useRef, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import { Backdrop } from "@/components/Backdrop";
import { ContextMenu } from "@/components/ContextMenu";
import { FullscreenPlayer } from "@/components/FullscreenPlayer";
import { Modals } from "@/components/Modals";
import { PlayerBar } from "@/components/PlayerBar";
import { QueuePanel } from "@/components/QueuePanel";
import { Sidebar } from "@/components/Sidebar";
import { Toasts } from "@/components/Toasts";
import { TopBar } from "@/components/TopBar";
import { useLibrary } from "@/library/store";
import { navigate, useNav, type Route } from "@/nav/store";
import { connectMediaSession } from "@/player/mediaSession";
import { connectOutputWatch } from "@/player/outputWatch";
import { connectPlayerSync } from "@/player/sync";
import { connectWaveform } from "@/player/waveform";
import { useView } from "@/ui/view";
import { connectAppearance } from "@/ui/appearance";
import { connectUpdates } from "@/ui/updates";
import { connectGlobalKeys, connectShortcuts } from "@/ui/shortcuts";
import { usePlayer } from "@/player/store";
import { AlbumPage } from "@/pages/AlbumPage";
import { ArtistPage } from "@/pages/ArtistPage";
import { HomePage } from "@/pages/HomePage";
import { MixPage } from "@/pages/MixPage";
import { RemotePlaylistPage } from "@/pages/RemotePlaylistPage";
import { useFeed } from "@/feed/store";
import { useAccounts } from "@/accounts/store";
import { HistoryPage, LibraryPage, LikedPage, PlaylistPage } from "@/pages/LibraryPages";
import { ImportPage } from "@/pages/ImportPage";
import { ImportReviewPage } from "@/pages/ImportReviewPage";
import { ListeningPage } from "@/pages/ListeningPage";
import { LocalFilesPage } from "@/pages/LocalFilesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SearchPage } from "@/pages/SearchPage";
import { useImports, useLocal } from "@/imports/store";

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage />;
    case "library":
      return <LibraryPage />;
    case "liked":
      return <LikedPage />;
    case "history":
      return <HistoryPage />;
    case "playlist":
      return <PlaylistPage id={route.id} />;
    case "album":
      return <AlbumPage id={route.id} />;
    case "artist":
      return <ArtistPage id={route.id} />;
    case "mix":
      return <MixPage id={route.id} />;
    case "ytplaylist":
      return <RemotePlaylistPage id={route.id} />;
    case "import":
      return <ImportPage />;
    case "import-job":
      return <ImportReviewPage id={route.id} />;
    case "listening":
      return <ListeningPage />;
    case "local":
      return <LocalFilesPage />;
    case "settings":
      return <SettingsPage />;
  }
}

/** the queue panel's width, plus the gap on each side of it */
export const QUEUE_SPACE = 352 + 8;

export default function App() {
  const route = useNav((s) => s.route);
  const index = useNav((s) => s.index);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    useLibrary.getState().init();
    useImports.getState().init();
    useLocal.getState().init();
    useFeed.getState().init();
    useAccounts.getState().init();
    const stopAppearance = connectAppearance();
    const stopUpdates = connectUpdates();
    const stopSync = connectPlayerSync();
    const stopMedia = connectMediaSession();
    const stopOutputWatch = connectOutputWatch();
    const stopWaveform = connectWaveform();
    const stopShortcuts = connectShortcuts();
    const stopGlobalKeys = connectGlobalKeys();
    const stopMini = window.encore.mini.onVisible((miniOpen) => useView.setState({ miniOpen }));
    // a new-release notification was clicked
    const stopReleases = window.encore.feed.onOpenAlbum((albumId) => {
      useView.getState().closeFullscreen();
      navigate(albumId ? { name: "album", id: albumId } : { name: "home" });
    });
    return () => {
      stopAppearance();
      stopUpdates();
      stopSync();
      stopMedia();
      stopOutputWatch();
      stopWaveform();
      stopShortcuts();
      stopGlobalKeys();
      stopMini();
      stopReleases();
    };
  }, []);

  // each visit to a page starts at the top
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [index]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-full overflow-hidden text-ink">
        <Backdrop />
        {/* Pages scroll in one column right of the sidebar. The toolbar and the
            player float over it as glass, so the page shows through them. */}
        <main className="absolute inset-0">
          <div
            ref={scroller}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
            className="absolute inset-y-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
            style={{ left: "calc(var(--sidebar-w) + 8px)", right: queueOpen ? QUEUE_SPACE : 0 }}
          >
            <motion.div
              key={`${index}:${JSON.stringify(route)}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ opacity: { duration: 0.24, ease: "easeOut" }, y: { type: "spring", stiffness: 260, damping: 32, mass: 0.8 } }}
              className="relative min-h-full pb-32"
            >
              <Page route={route} />
            </motion.div>
          </div>
        </main>
        <Sidebar />
        <TopBar scrolled={scrolled} right={queueOpen ? QUEUE_SPACE : 0} />
        <QueuePanel />
        <PlayerBar right={queueOpen ? QUEUE_SPACE : 0} />
        <FullscreenPlayer />
        <ContextMenu />
        <Modals />
        <Toasts />
      </div>
    </MotionConfig>
  );
}
