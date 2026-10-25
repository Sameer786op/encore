import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LoaderCircle, Search } from "lucide-react";
import type { Track } from "@shared/types";
import { artistNames, formatTime } from "@/lib/format";
import { Artwork } from "./Artwork";
import { useLibrary } from "@/library/store";
import { navigate } from "@/nav/store";
import { cn } from "@/lib/cn";
import { useModal, type ModalState } from "@/ui/modal";

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-40 grid place-items-center bg-black/45"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-menu w-[420px] max-w-[calc(100vw-32px)] rounded-[28px] p-6"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
        transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.8 }}
      >
        <h2 className="font-display text-[19px] font-bold tracking-[-0.02em]">{title}</h2>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Buttons({ onCancel, confirmLabel, danger, disabled }: { onCancel: () => void; confirmLabel: string; danger?: boolean; disabled?: boolean }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-2.5">
      <button type="button" onClick={onCancel} className="glass-control pressable h-10 rounded-full text-[14px] font-semibold text-ink hover:brightness-125">
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className={cn(
          "pressable h-10 rounded-full text-[14px] font-semibold shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4)] hover:brightness-110 disabled:opacity-40",
          danger ? "bg-[#ff453a] text-snow" : "bg-accent text-on-accent",
        )}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function NameForm({ initial, confirmLabel, onSubmit, onCancel }: { initial: string; confirmLabel: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <form onSubmit={submit}>
      <input
        ref={input}
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        placeholder="Playlist name"
        className="mt-4 w-full rounded-[12px] border border-transparent bg-white/[0.07] px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/60"
      />
      <Buttons onCancel={onCancel} confirmLabel={confirmLabel} disabled={!name.trim()} />
    </form>
  );
}

/** search YouTube Music and pick one song */
function PickSong({ initial, onPick, close }: { initial: string; onPick: (track: Track) => void; close: () => void }) {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setResults(null);
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      window.encore.catalog
        .search(q)
        .then((r) => !cancelled && setResults([...r.tracks, ...r.videos].slice(0, 12)))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <Dialog title="Find the right song" onClose={close}>
      <div className="mt-4 flex h-11 items-center gap-2 rounded-[12px] border border-transparent bg-white/[0.07] px-3 focus-within:border-accent/60">
        <Search className="size-4 text-ink-3" />
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
        {loading && <LoaderCircle className="size-4 animate-spin text-ink-3" />}
      </div>
      <div className="mt-3 max-h-[46vh] overflow-y-auto">
        {results?.length === 0 && <p className="py-6 text-center text-sm text-ink-3">No songs found. Try other words.</p>}
        {results?.map((track) => (
          <button
            key={track.id}
            onClick={() => {
              close();
              onPick(track);
            }}
            className="flex w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors hover:bg-white/[0.08]"
          >
            <Artwork src={track.artwork} className="size-10 rounded-[7px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{track.title}</span>
              <span className="block truncate text-[12.5px] text-ink-2">{artistNames(track.artists)}</span>
            </span>
            {track.durationMs > 0 && <span className="text-[12px] tabular-nums text-ink-3">{formatTime(track.durationMs / 1000)}</span>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function ModalBody({ modal, close }: { modal: ModalState; close: () => void }) {
  const library = useLibrary();
  switch (modal.kind) {
    case "create-playlist":
      return (
        <Dialog title="New playlist" onClose={close}>
          <NameForm
            initial={modal.name ?? `My playlist #${library.snapshot.playlists.length + 1}`}
            confirmLabel="Create"
            onCancel={close}
            onSubmit={async (name) => {
              close();
              const playlist = await library.createPlaylist(name, modal.tracks);
              if (modal.onCreated) modal.onCreated(playlist);
              else if (!modal.tracks?.length) navigate({ name: "playlist", id: playlist.id });
            }}
          />
        </Dialog>
      );
    case "rename-playlist":
      return (
        <Dialog title="Rename playlist" onClose={close}>
          <NameForm
            initial={modal.name}
            confirmLabel="Save"
            onCancel={close}
            onSubmit={(name) => {
              close();
              void library.renamePlaylist(modal.id, name);
            }}
          />
        </Dialog>
      );
    case "pick-song":
      return <PickSong initial={modal.query} onPick={modal.onPick} close={close} />;
    case "confirm":
      return (
        <Dialog title={modal.title} onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              close();
              modal.onConfirm();
            }}
          >
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{modal.message}</p>
            <Buttons onCancel={close} confirmLabel={modal.confirmLabel} danger={modal.danger} />
          </form>
        </Dialog>
      );
  }
}

export function Modals() {
  const modal = useModal((s) => s.modal);
  const close = useModal((s) => s.close);
  return <AnimatePresence>{modal && <ModalBody key={modal.kind} modal={modal} close={close} />}</AnimatePresence>;
}
