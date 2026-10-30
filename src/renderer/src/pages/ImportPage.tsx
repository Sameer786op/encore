import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, CircleAlert, FileArchive, Link2, ListMusic, LoaderCircle, Trash2, Upload, X } from "lucide-react";
import type { ExportSummary, HistorySource, ImportJob } from "@shared/types";
import { EmptyState, PageTitle, SectionTitle } from "@/components/common";
import { ORIGIN_COLOR, ORIGIN_LABEL, destinationLabel, guessService, yearRange } from "@/imports/labels";
import { useImports } from "@/imports/store";
import { navigate } from "@/nav/store";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { openModal } from "@/ui/modal";
import { toast } from "@/ui/toast";

function OriginChip({ origin }: { origin: ImportJob["origin"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[12px] font-medium text-ink-2">
      <span className="size-1.5 rounded-full" style={{ background: ORIGIN_COLOR[origin] }} />
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

function LinkCard() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const service = guessService(url);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const job = await window.encore.imports.fromLink(url.trim());
      setUrl("");
      navigate({ name: "import-job", id: job.id });
    } catch (err) {
      setError(friendlyError(err, "That link didn't work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col fill-group rounded-[24px] p-6">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent-ink">
          <Link2 className="size-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold">Paste a playlist link</h2>
          <p className="text-[13px] text-ink-2">Spotify, Apple Music or YouTube. Playlists and albums.</p>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-[12px] border border-transparent bg-white/[0.07] px-3 focus-within:border-accent/60">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="https://open.spotify.com/playlist/…"
          spellCheck={false}
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
        />
        <AnimatePresence>
          {service && (
            <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <OriginChip origin={service} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      <button
        type="submit"
        disabled={!url.trim() || busy}
        className="mt-4 inline-flex items-center justify-center gap-2 self-start glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125 transition-transform active:scale-95 disabled:opacity-40"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {busy ? "Reading the playlist…" : "Import"}
      </button>
      <p className="mt-auto pt-4 text-[12px] leading-relaxed text-ink-3">Spotify shares up to 100 songs of a playlist without signing in. For more, use your data export below.</p>
    </form>
  );
}

function ExportCard({ onSummary }: { onSummary: (summary: ExportSummary) => void }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async (path: string | null) => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      onSummary(await window.encore.imports.analyzeExport(path));
    } catch (err) {
      setError(friendlyError(err, "Couldn't read that file."));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void analyze(window.encore.imports.pathForFile(file));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-dashed p-6 transition-colors",
        dragging ? "border-accent bg-accent/10" : "border-white/15 bg-white/[0.03]",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-[var(--ramp-2)]/15 text-[var(--ramp-2)]">
          <FileArchive className="size-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold">Import your data export</h2>
          <p className="text-[13px] text-ink-2">Your full history, liked songs and playlists.</p>
        </div>
      </div>
      <div className="mt-5 grid flex-1 place-items-center rounded-xl bg-white/[0.04] px-4 py-7 text-center">
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-sm text-ink-2">
            <LoaderCircle className="size-6 animate-spin text-accent-ink" />
            Reading your export…
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="size-6 text-ink-3" />
            <p className="text-[13px] text-ink-2">Drop the .zip here, or</p>
            <button
              onClick={async () => analyze(await window.encore.imports.pickFile())}
              className="glass-control pressable rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:brightness-125 transition-transform active:scale-95"
            >
              Choose file
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}
      <p className="pt-4 text-[12px] leading-relaxed text-ink-3">Works with Spotify, Google Takeout and Apple exports, and CSVs from Exportify, TuneMyMusic or Soundiiz.</p>
    </div>
  );
}

const GUIDES = [
  {
    origin: "spotify" as const,
    title: "Spotify",
    steps: [
      "Open spotify.com/account/privacy and sign in.",
      'Tick "Extended streaming history" for every year you\'ve listened, or "Account data" for the last year plus your library and playlists. You can request both.',
      "Spotify emails you a link, usually within a few days.",
      "Download the .zip and drop it here.",
    ],
    link: "https://www.spotify.com/account/privacy/",
  },
  {
    origin: "youtube" as const,
    title: "YouTube Music (Google Takeout)",
    steps: [
      "Open takeout.google.com and click Deselect all.",
      'Tick "YouTube and YouTube Music". Under "All YouTube data included", keep only history and playlists.',
      'Optional: in "Multiple formats", set history to JSON.',
      "Create the export, download the .zip when it's ready, and drop it here.",
    ],
    link: "https://takeout.google.com/",
  },
  {
    origin: "apple" as const,
    title: "Apple Music",
    steps: [
      'Open privacy.apple.com and choose "Request a copy of your data".',
      'Select "Apple Media Services information".',
      "Apple emails you when it's ready, usually within a week.",
      "Download the .zip and drop it here. Vyse Music reads the zips inside it for you.",
    ],
    link: "https://privacy.apple.com/",
  },
];

function Guides() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
      {GUIDES.map((g) => (
        <div key={g.origin} className="fill-group rounded-[24px]">
          <button onClick={() => setOpen(open === g.origin ? null : g.origin)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
            <span className="size-2 rounded-full" style={{ background: ORIGIN_COLOR[g.origin] }} />
            <span className="flex-1 text-[14px] font-medium">{g.title}</span>
            <ChevronDown className={cn("size-4 text-ink-3 transition-transform", open === g.origin && "rotate-180")} />
          </button>
          <AnimatePresence initial={false}>
            {open === g.origin && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <ol className="space-y-2 px-5 pb-4 text-[13px] leading-relaxed text-ink-2">
                  {g.steps.map((step, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-ink">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <a href={g.link} target="_blank" rel="noreferrer" className="mx-5 mb-4 inline-flex text-[13px] font-medium text-accent-ink hover:underline">
                  Open {new URL(g.link).hostname.replace(/^www\./, "")}
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("grid size-5 shrink-0 place-items-center rounded-md border transition-colors", checked ? "border-accent bg-accent text-on-accent" : "border-white/25")}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

/** what we found in an export, and what to bring in */
function ExportChooser({ summary, onClose }: { summary: ExportSummary; onClose: () => void }) {
  const [history, setHistory] = useState(!!summary.history);
  // big libraries take a while to match, so they start unticked when there's a loved list too
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(summary.collections.filter((c) => !(c.key === "apple:library" && summary.collections.some((x) => x.key === "apple:loved"))).map((c) => c.key)),
  );
  const [busy, setBusy] = useState(false);
  const toggle = (key: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    setChosen(next);
  };
  const songsToMatch = summary.collections.filter((c) => chosen.has(c.key)).reduce((s, c) => s + c.count, 0);

  const apply = async () => {
    setBusy(true);
    try {
      const result = await window.encore.imports.applyExport(summary.token, { history, collections: [...chosen] });
      const parts = [];
      if (history) parts.push(result.historyAdded > 0 ? `Saved ${plural(result.historyAdded, "play")} to your history` : "Your history was already saved");
      if (result.jobs.length) parts.push(`matching ${plural(result.jobs.length, "list")}`);
      toast(parts.join(", ") || "Nothing selected");
      onClose();
      if (result.jobs.length === 1) navigate({ name: "import-job", id: result.jobs[0].id });
      else if (history && result.jobs.length === 0) navigate({ name: "listening" });
    } catch (err) {
      toast(friendlyError(err, "Import failed"), { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center bg-black/45 moss:bg-[rgb(23_21_59/0.22)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Choose what to import"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
        transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.8 }}
        className="glass-menu flex max-h-[84vh] w-[560px] max-w-[calc(100vw-32px)] flex-col rounded-[28px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] p-6">
          <div className="min-w-0">
            <OriginChip origin={summary.origin} />
            <h2 className="mt-2 font-display text-[22px] font-bold tracking-[-0.035em]">Here's what's in your export</h2>
            <p className="mt-0.5 truncate text-[13px] text-ink-3">{summary.fileName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="pressable grid size-7 place-items-center rounded-full bg-white/[0.08] text-ink-2 hover:bg-white/[0.14] hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {summary.history && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.04] p-4">
              <Checkbox checked={history} onChange={setHistory} label="Listening history" />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium">Listening history</span>
                <span className="block text-[13px] text-ink-2">
                  {plural(summary.history.plays, "play")} of {plural(summary.history.songs, "song")}, {yearRange(summary.history.firstAt, summary.history.lastAt)}
                </span>
                <span className="mt-1 block text-[12px] text-ink-3">
                  Saved right away. Powers "Your listening".{!summary.history.hasListeningTime && " YouTube doesn't record how long you listened, so only plays are counted."}
                </span>
              </span>
            </label>
          )}
          {summary.collections.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-xl bg-white/[0.04] p-4">
              <Checkbox checked={chosen.has(c.key)} onChange={(on) => toggle(c.key, on)} label={c.name} />
              <ListMusic className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{c.name}</span>
                <span className="block text-[12px] text-ink-3">
                  {plural(c.count, "song")} → {destinationLabel(c.destination)}
                </span>
              </span>
            </label>
          ))}
          {!summary.history && summary.collections.length === 0 && <p className="p-4 text-sm text-ink-2">We couldn't find songs in this file.</p>}
          {summary.warnings.map((w, i) => (
            <p key={i} className="flex gap-2 px-1 pt-1 text-[12px] leading-relaxed text-warn">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
            </p>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.08] p-5">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-3">
            {songsToMatch > 0 ? `${plural(songsToMatch, "song")} will be matched to YouTube Music. You review them before anything is added.` : " "}
          </p>
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-ink-2 hover:bg-white/8 hover:text-ink">
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={busy || (!history && chosen.size === 0)}
            className="inline-flex items-center gap-2 pressable rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4)] hover:brightness-110 disabled:opacity-40"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            Import
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function JobCard({ job }: { job: ImportJob }) {
  const done = job.counts.matched + job.counts.review + job.counts.missing + job.counts.accepted + job.counts.skipped;
  const ready = job.counts.matched + job.counts.accepted;
  const percent = job.total > 0 ? Math.round((done / job.total) * 100) : 100;

  const remove = () =>
    job.status === "done"
      ? void window.encore.imports.remove(job.id)
      : openModal({
          kind: "confirm",
          title: "Remove this import?",
          message: `"${job.name}" hasn't been added yet. Removing it throws away the matches.`,
          confirmLabel: "Remove",
          danger: true,
          onConfirm: () => void window.encore.imports.remove(job.id),
        });

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="group flex items-center gap-4 fill-group rounded-[24px] p-4">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.06]">
        {job.status === "matching" ? <LoaderCircle className="size-5 animate-spin text-accent-ink" /> : job.status === "done" ? <Check className="size-5 text-good" /> : <ListMusic className="size-5 text-ink-2" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">{job.name}</span>
          <OriginChip origin={job.origin} />
        </div>
        {job.status === "matching" ? (
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-[linear-gradient(90deg,var(--ramp-1),var(--ramp-2),var(--ramp-3))]" animate={{ width: `${percent}%` }} transition={{ ease: "easeOut" }} />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
              {done} of {job.total}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 text-[12.5px] text-ink-2">
            {job.status === "done"
              ? `Added ${plural(ready, "song")} to ${job.destination.kind === "liked" ? "Liked Songs" : "a new playlist"}`
              : `${plural(ready, "song")} found${job.counts.review ? `, ${job.counts.review} to check` : ""}${job.counts.missing ? `, ${job.counts.missing} not found` : ""}`}
          </div>
        )}
      </div>
      {job.status === "done" ? (
        <button
          onClick={() => navigate(job.resultPlaylistId ? { name: "playlist", id: job.resultPlaylistId } : { name: "liked" })}
          className="glass-control pressable rounded-full px-4 py-1.5 text-[13px] font-medium hover:brightness-125"
        >
          Open
        </button>
      ) : (
        <button onClick={() => navigate({ name: "import-job", id: job.id })} className="pressable rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-on-accent hover:brightness-110">
          {job.status === "matching" ? "View" : "Review"}
        </button>
      )}
      <button onClick={remove} aria-label={`Remove ${job.name}`} className="rounded-full p-1.5 text-ink-3 opacity-0 hover:bg-white/8 hover:text-ink group-hover:opacity-100">
        <Trash2 className="size-4" />
      </button>
    </motion.div>
  );
}

function HistorySources() {
  const [sources, setSources] = useState<HistorySource[] | null>(null);
  const jobs = useImports((s) => s.jobs);
  const load = () => void window.encore.history.insights().then((i) => setSources(i.sources));
  useEffect(load, [jobs.length]);
  if (!sources || sources.length === 0) return null;
  return (
    <section className="mt-12">
      <SectionTitle
        action={
          <button onClick={() => navigate({ name: "listening" })} className="pressable rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-ink hover:bg-accent/10">
            See your listening
          </button>
        }
      >
        Saved listening history
      </SectionTitle>
      <div className="flex flex-col gap-2">
        {sources.map((s) => (
          <div key={s.origin} className="group flex items-center gap-4 fill-group rounded-[24px] p-4">
            <OriginChip origin={s.origin} />
            <span className="flex-1 text-[13px] text-ink-2">
              {plural(s.plays, "play")}, {yearRange(s.firstAt, s.lastAt)}
            </span>
            <button
              onClick={() =>
                openModal({
                  kind: "confirm",
                  title: `Remove ${ORIGIN_LABEL[s.origin]} history?`,
                  message: "The plays you imported from this service are deleted from Vyse Music. You can import the export again later.",
                  confirmLabel: "Remove",
                  danger: true,
                  onConfirm: () => void window.encore.history.removeImported(s.origin).then(load),
                })
              }
              className="rounded-full p-1.5 text-ink-3 opacity-0 hover:bg-white/8 hover:text-ink group-hover:opacity-100"
              aria-label={`Remove ${ORIGIN_LABEL[s.origin]} history`}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ImportPage() {
  const jobs = useImports((s) => s.jobs);
  const [summary, setSummary] = useState<ExportSummary | null>(null);

  return (
    <div className="@container px-8 pb-16 pt-[68px]">
      <PageTitle eyebrow="Import" title="Bring your music" />
      <p className="mt-2 max-w-2xl text-[15px] text-ink-2">
        Import playlists from a link, or everything you've listened to from your data export. To keep YouTube Music or Apple Music playlists up to date by themselves,{" "}
        {/* Connected accounts is the first thing in Settings */}
        <button onClick={() => navigate({ name: "settings" })} className="font-semibold text-accent-ink hover:underline">
          connect your account
        </button>{" "}
        instead.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <LinkCard />
        <ExportCard onSummary={setSummary} />
      </div>

      <section className="mt-9">
        <SectionTitle>How to get your data export</SectionTitle>
        <Guides />
      </section>

      <section className="mt-12">
        <SectionTitle>Your imports</SectionTitle>
        {jobs.length === 0 ? (
          <EmptyState icon={<ListMusic className="size-7" />} title="Nothing imported yet" body="Paste a link or drop an export above. Songs are matched to YouTube Music and you check them before anything is added." />
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>

      <HistorySources />

      {/* the page itself is animated, so the dialog lives at the top of the window */}
      {createPortal(<AnimatePresence>{summary && <ExportChooser key={summary.token} summary={summary} onClose={() => setSummary(null)} />}</AnimatePresence>, document.body)}
    </div>
  );
}
