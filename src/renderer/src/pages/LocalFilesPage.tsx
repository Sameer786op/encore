import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { FolderOpen, FolderPlus, HardDrive, RefreshCw, Search, X } from "lucide-react";
import type { Track } from "@shared/types";
import { BigPlayButton, EmptyState, IconButton, PillButton, ShuffleButton } from "@/components/common";
import { TrackList } from "@/components/TrackList";
import { useLocal } from "@/imports/store";
import { fold } from "@/lib/search";
import { plural } from "@/lib/format";
import { openModal } from "@/ui/modal";
import { usePlayCollection } from "./usePlayCollection";

type Sort = "artist" | "title" | "album";

const SORTS: Record<Sort, (a: Track, b: Track) => number> = {
  artist: (a, b) =>
    (a.artists[0]?.name ?? "").localeCompare(b.artists[0]?.name ?? "") || (a.album?.title ?? "").localeCompare(b.album?.title ?? "") || a.title.localeCompare(b.title),
  album: (a, b) => (a.album?.title ?? "").localeCompare(b.album?.title ?? "") || a.title.localeCompare(b.title),
  title: (a, b) => a.title.localeCompare(b.title),
};

/** the last two parts of a folder path, enough to recognise it */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…\\${parts.slice(-2).join("\\")}` : path;
}

export function LocalFilesPage() {
  const state = useLocal((s) => s.state);
  const tracks = useLocal((s) => s.tracks);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("artist");

  const shown = useMemo(() => {
    const q = fold(query);
    const filtered = q ? tracks.filter((t) => fold(`${t.title} ${t.artists.map((a) => a.name).join(" ")} ${t.album?.title ?? ""}`).includes(q)) : tracks;
    return [...filtered].sort(SORTS[sort]);
  }, [tracks, query, sort]);

  const context = { kind: "playlist" as const, label: "Local files", id: "local-files" };
  const { play, shuffle, playing, loading } = usePlayCollection(shown, context);
  const addFolder = () => void window.encore.local.addFolder();

  return (
    <div className="relative">
      <div className="relative px-8 pb-16 pt-[72px]">
        <div className="flex items-end gap-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 28 }}
            className="grid size-[200px] shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#64d2ff] to-[#0a64d8] shadow-[0_24px_60px_-18px_rgb(0_0_0/0.75)]"
          >
            <HardDrive className="size-16 text-snow drop-shadow-lg" strokeWidth={1.5} />
          </motion.div>
          <div className="min-w-0 pb-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">On this computer</div>
            <h1 className="mt-1.5 font-display text-[40px] font-bold leading-[1.06] tracking-[-0.03em]">Local files</h1>
            <p className="mt-2.5 text-[14px] text-ink-2">
              {plural(state.tracks, "song")} from {plural(state.folders.length, "folder")}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {state.folders.map((folder) => (
            <span key={folder} title={folder} className="glass-control group inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-[12.5px] text-ink-2">
              <FolderOpen className="size-3.5" />
              {shortPath(folder)}
              <button
                onClick={() =>
                  openModal({
                    kind: "confirm",
                    title: "Stop using this folder?",
                    message: `Songs from ${folder} leave your Local files. The files themselves aren't touched.`,
                    confirmLabel: "Remove folder",
                    onConfirm: () => void window.encore.local.removeFolder(folder),
                  })
                }
                aria-label={`Remove ${folder}`}
                className="rounded-full p-0.5 text-ink-3 hover:bg-white/10 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <PillButton icon={<FolderPlus className="size-4" />} onClick={addFolder} className="py-1.5">
            Add folder
          </PillButton>
          {state.folders.length > 0 && (
            <IconButton label="Scan again" onClick={() => void window.encore.local.rescan()}>
              <RefreshCw className={state.scanning ? "size-4 animate-spin" : "size-4"} />
            </IconButton>
          )}
        </div>

        {state.scanning && (
          <div className="mt-4 max-w-md">
            <div className="flex justify-between text-[12px] text-ink-3">
              <span>Scanning your music…</span>
              <span className="tabular-nums">
                {state.processed} of {state.found}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full bg-accent" animate={{ width: `${state.found ? (state.processed / state.found) * 100 : 5}%` }} />
            </div>
          </div>
        )}
        {state.unsupported > 0 && !state.scanning && (
          <p className="mt-3 text-[12px] text-ink-3">{plural(state.unsupported, "file")} can't be played here (formats like WMA, AIFF and Apple Lossless).</p>
        )}

        {state.folders.length === 0 ? (
          <EmptyState
            icon={<FolderPlus className="size-7" />}
            title="Add your music folder"
            body="Vyse Music plays MP3, FLAC, AAC, Ogg, Opus and WAV files, reads their tags and cover art, and notices new files as you add them."
            action={
              <button onClick={addFolder} className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125">
                Choose a folder
              </button>
            }
          />
        ) : (
          <>
            <div className="mt-8 flex items-center gap-4">
              {shown.length > 0 && <BigPlayButton playing={playing} loading={loading} onClick={play} label="Play local files" />}
              {shown.length > 0 && (
                <ShuffleButton onClick={shuffle} />
              )}
              <div className="ml-auto flex items-center gap-2">
                <div className="flex h-9 items-center gap-2 rounded-full bg-white/[0.06] px-3">
                  <Search className="size-4 text-ink-3" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" className="w-40 bg-transparent text-[13px] outline-none placeholder:text-ink-3" />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  aria-label="Sort by"
                  className="h-9 rounded-full bg-white/[0.06] px-3 text-[13px] text-ink outline-none [&>option]:bg-surface-2"
                >
                  <option value="artist">Artist</option>
                  <option value="album">Album</option>
                  <option value="title">Title</option>
                </select>
              </div>
            </div>
            <div className="mt-6">
              {shown.length > 0 ? (
                <TrackList tracks={shown} context={context} />
              ) : (
                <p className="py-10 text-center text-sm text-ink-3">{query ? "No songs match that filter." : state.scanning ? "Looking for music…" : "No playable music found in these folders yet."}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
