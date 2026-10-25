import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, ListMusic, LoaderCircle, Play, RotateCcw, Search, X } from "lucide-react";
import type { ImportItem, ImportItemStatus, ImportJobDetails, Track } from "@shared/types";
import { Artwork } from "@/components/Artwork";
import { EmptyState } from "@/components/common";
import { ORIGIN_COLOR, ORIGIN_LABEL, destinationLabel } from "@/imports/labels";
import { useImports } from "@/imports/store";
import { navigate } from "@/nav/store";
import { usePlayer } from "@/player/store";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/errors";
import { artistNames, formatTime, plural } from "@/lib/format";
import { openMenu, type MenuEntry } from "@/ui/menu";
import { openModal } from "@/ui/modal";
import { toast } from "@/ui/toast";

type Tab = "review" | "found" | "missing" | "skipped" | "all";
const PAGE = 100;

const inTab: Record<Tab, (s: ImportItemStatus) => boolean> = {
  review: (s) => s === "review",
  found: (s) => s === "matched" || s === "accepted",
  missing: (s) => s === "missing",
  skipped: (s) => s === "skipped",
  all: () => true,
};

/** the song that will be added for this item, if any */
const pickedTrack = (item: ImportItem): Track | undefined => item.chosen ?? item.candidates[0]?.track;

function StatusPill({ item }: { item: ImportItem }) {
  const score = item.candidates[0] ? Math.round(item.candidates[0].score * 100) : 0;
  const map: Record<ImportItemStatus, [string, string]> = {
    pending: ["Matching…", "bg-white/10 text-ink-2"],
    matched: [`Found · ${score}%`, "bg-switch/15 text-[#63e6a0]"],
    accepted: [item.chosen && item.chosen.id !== item.candidates[0]?.track.id ? "Your pick" : `Accepted · ${score}%`, "bg-accent/15 text-[#ff8a9b]"],
    review: [`Check · ${score}%`, "bg-[#ff9f0a]/15 text-[#ffc46b]"],
    missing: ["Not found", "bg-red-400/15 text-red-300"],
    skipped: ["Left out", "bg-white/10 text-ink-3"],
  };
  const [label, style] = map[item.status];
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", style)}>{label}</span>;
}

function SongCell({ title, subtitle, art, dim }: { title: string; subtitle: string; art?: React.ReactNode; dim?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", dim && "opacity-45")}>
      {art}
      <div className="min-w-0">
        <div className="truncate text-[14px] font-medium">{title || "Unknown song"}</div>
        <div className="truncate text-[12.5px] text-ink-2">{subtitle}</div>
      </div>
    </div>
  );
}

function ItemRow({ job, item, onChange }: { job: ImportJobDetails; item: ImportItem; onChange: (index: number, track: Track | null) => void }) {
  const track = pickedTrack(item);
  const source = item.source;
  const sourceSub = [source.artists.join(", "), source.album, source.durationMs ? formatTime(source.durationMs / 1000) : ""].filter(Boolean).join(" · ");
  const editable = job.status === "review";
  const left = item.status === "skipped";

  const menu = (e: React.MouseEvent) => {
    const entries: MenuEntry[] = [
      ...item.candidates.map((c) => ({
        label: `${c.track.title} — ${artistNames(c.track.artists)} · ${c.track.durationMs ? formatTime(c.track.durationMs / 1000) : "?"} · ${Math.round(c.score * 100)}%`,
        icon: c.track.id === track?.id ? Check : undefined,
        onSelect: () => onChange(item.index, c.track),
      })),
      "divider",
      {
        label: "Search for another song…",
        icon: Search,
        onSelect: () => openModal({ kind: "pick-song", query: `${source.title} ${source.artists[0] ?? ""}`.trim(), onPick: (t) => onChange(item.index, t) }),
      },
    ];
    openMenu(e, entries);
  };

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-3 py-2 hover:bg-white/[0.04]">
      <SongCell title={source.title} subtitle={sourceSub} dim={left} />
      <ArrowRight className={cn("size-4 text-ink-3", left && "opacity-40")} />
      {track && item.status !== "missing" ? (
        <SongCell
          title={track.title}
          subtitle={[artistNames(track.artists), track.durationMs ? formatTime(track.durationMs / 1000) : ""].filter(Boolean).join(" · ")}
          dim={left}
          art={
            <button
              onClick={() => usePlayer.getState().playTracks([track], 0, { kind: "track", label: `Preview of "${track.title}"` })}
              aria-label={`Preview ${track.title}`}
              className="group/art relative shrink-0"
            >
              <Artwork src={track.artwork} className="size-10 rounded-md" />
              <span className="absolute inset-0 grid place-items-center rounded-md bg-black/50 opacity-0 transition-opacity group-hover/art:opacity-100">
                <Play className="size-4 text-white" fill="currentColor" strokeWidth={0} />
              </span>
            </button>
          }
        />
      ) : (
        <div className="text-[13px] text-ink-3">{item.status === "pending" ? "Searching…" : "No match on YouTube Music"}</div>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <StatusPill item={item} />
        {editable && (
          <div className="flex items-center gap-0.5">
            {item.status === "review" && track && (
              <button onClick={() => onChange(item.index, track)} title="Use this song" aria-label="Use this song" className="rounded-full p-1.5 text-emerald-300 hover:bg-switch/15">
                <Check className="size-4" />
              </button>
            )}
            {left ? (
              <button onClick={() => track && onChange(item.index, track)} disabled={!track} title="Put it back" aria-label="Put it back" className="rounded-full p-1.5 text-ink-2 hover:bg-white/10 disabled:opacity-30">
                <RotateCcw className="size-4" />
              </button>
            ) : (
              item.status !== "missing" && (
                <button onClick={() => onChange(item.index, null)} title="Leave it out" aria-label="Leave it out" className="rounded-full p-1.5 text-ink-2 hover:bg-white/10 hover:text-ink">
                  <X className="size-4" />
                </button>
              )
            )}
            <button onClick={menu} title="Pick a different song" aria-label="Pick a different song" className="rounded-full p-1.5 text-ink-2 hover:bg-white/10 hover:text-ink">
              {item.status === "missing" ? <Search className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ImportReviewPage({ id }: { id: string }) {
  const [job, setJob] = useState<ImportJobDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const summary = useImports((s) => s.jobs.find((j) => j.id === id));
  const loadedOnce = useRef(false);

  // reload whenever the job's counts move
  const signature = summary ? `${summary.status}|${Object.values(summary.counts).join(",")}` : "";
  useEffect(() => {
    let alive = true;
    window.encore.imports.get(id).then(
      (details) => {
        if (!alive) return;
        setJob(details);
        loadedOnce.current = true;
      },
      (err) => alive && setError(friendlyError(err)),
    );
    return () => {
      alive = false;
    };
  }, [id, signature]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { review: 0, found: 0, missing: 0, skipped: 0, all: 0 };
    for (const item of job?.items ?? []) for (const t of Object.keys(inTab) as Tab[]) if (inTab[t](item.status)) c[t]++;
    return c;
  }, [job]);

  // start on the tab that needs attention
  const activeTab: Tab = tab ?? (counts.review > 0 ? "review" : "all");
  const items = (job?.items ?? []).filter((i) => inTab[activeTab](i.status));

  const change = (index: number, track: Track | null) => {
    if (!job) return;
    // show it right away; the main process confirms
    setJob({
      ...job,
      items: job.items.map((i) => (i.index === index ? { ...i, status: track ? "accepted" : "skipped", chosen: track ?? undefined } : i)),
    });
    void window.encore.imports.choose(job.id, index, track);
  };

  if (error) return <EmptyState icon={<ListMusic className="size-7" />} title="This import is gone" body={error} />;
  if (!job) {
    return (
      <div className="grid place-items-center pt-40">
        <LoaderCircle className="size-6 animate-spin text-ink-3" />
      </div>
    );
  }

  const adding = job.items.filter((i) => i.status === "matched" || i.status === "accepted").length;
  const matching = job.status === "matching";
  const processed = job.items.filter((i) => i.status !== "pending").length;

  const finish = async () => {
    setBusy(true);
    try {
      const done = await window.encore.imports.finish(job.id);
      toast(job.destination.kind === "liked" ? `Added ${plural(adding, "song")} to Liked Songs` : `Created "${job.destination.name}" with ${plural(adding, "song")}`);
      navigate(done.resultPlaylistId ? { name: "playlist", id: done.resultPlaylistId } : { name: "liked" });
    } catch (err) {
      toast(friendlyError(err, "Couldn't finish the import"), { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string][] = [
    ["review", "To check"],
    ["found", "Found"],
    ["missing", "Not found"],
    ["skipped", "Left out"],
    ["all", "All"],
  ];

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 px-8 pb-6 pt-16">
        <button onClick={() => navigate({ name: "import" })} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Imports
        </button>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 font-medium">
            <span className="size-1.5 rounded-full" style={{ background: ORIGIN_COLOR[job.origin] }} />
            {ORIGIN_LABEL[job.origin]}
          </span>
          <ArrowRight className="size-3.5 text-ink-3" />
          <span>{destinationLabel(job.destination)}</span>
        </div>
        <h1 className="mt-3 font-display text-[34px] font-bold leading-tight tracking-[-0.026em]">{job.name}</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {matching
            ? `Matching ${processed} of ${job.total} songs with YouTube Music…`
            : job.status === "done"
              ? `Done: ${plural(adding, "song")} added.`
              : `${plural(counts.found, "song")} found${counts.review ? `, ${counts.review} need a quick look` : ""}${counts.missing ? `, ${counts.missing} not found` : ""}.`}
        </p>
        {matching && (
          <div className="mt-4 h-1.5 max-w-xl overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-[#ff6b81]" animate={{ width: `${job.total ? (processed / job.total) * 100 : 0}%` }} />
          </div>
        )}
        {job.note && (
          <p className="mt-4 flex max-w-3xl gap-2 rounded-xl bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-100/90">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" /> {job.note}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setShown(PAGE);
              }}
              className={cn("relative rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors", activeTab === key ? "text-white" : "bg-white/[0.07] text-ink-2 hover:bg-white/[0.11] hover:text-ink")}
            >
              {activeTab === key && <motion.span layoutId="review-tab" className="absolute inset-0 rounded-full bg-accent shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4)]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <span className="relative">
                {label} <span className="tabular-nums opacity-70">{counts[key]}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_auto] gap-4 border-b border-white/[0.07] px-3 pb-2 text-[12px] font-medium text-ink-3">
          <span>From {ORIGIN_LABEL[job.origin]}</span>
          <span />
          <span>On YouTube Music</span>
          <span className="w-24" />
        </div>
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">{activeTab === "review" ? "Nothing needs checking." : "Nothing here."}</p>
        ) : (
          <div className="mt-1 flex flex-col">
            {items.slice(0, shown).map((item) => (
              <ItemRow key={item.index} job={job} item={item} onChange={change} />
            ))}
          </div>
        )}
        {items.length > shown && (
          <button onClick={() => setShown((n) => n + PAGE)} className="glass-control pressable mx-auto mt-4 block rounded-full px-5 py-2 text-[13px] font-medium hover:brightness-125">
            Show {Math.min(PAGE, items.length - shown)} more
          </button>
        )}
      </div>

      {job.status !== "done" && (
        <div className="glass-menu sticky bottom-[92px] z-10 mx-6 mt-6 flex items-center gap-3 rounded-[22px] px-6 py-3.5">
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            {matching ? "You can start checking while the rest are matched." : `${plural(adding, "song")} will be added to ${job.destination.kind === "liked" ? "Liked Songs" : `"${job.destination.name}"`}.`}
          </p>
          {counts.review > 0 && !matching && (
            <button
              onClick={() => void window.encore.imports.acceptSuggestions(job.id).then((n) => toast(`Accepted ${plural(n, "suggestion")}`))}
              className="glass-control pressable rounded-full px-4 py-2 text-[13px] font-medium hover:brightness-125"
            >
              Accept all suggestions
            </button>
          )}
          <button
            onClick={finish}
            disabled={matching || busy || adding === 0}
            className="inline-flex items-center gap-2 pressable rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4)] hover:brightness-110 disabled:opacity-40"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {job.destination.kind === "liked" ? "Add to Liked Songs" : "Create playlist"}
          </button>
        </div>
      )}
    </div>
  );
}
