import { useMemo, useState } from "react";
import { ArrowDownUp, Check, Search, X } from "lucide-react";
import type { Track } from "@shared/types";
import { cn } from "@/lib/cn";
import { artistNames } from "@/lib/format";
import { byText, matchesQuery } from "@/lib/search";
import { openMenu } from "@/ui/menu";

// A find box and a sort menu for narrowing down a list: Your Library, a
// playlist, an album, Liked Songs.

/** a small search box; Escape clears it */
export function FindField({ value, onChange, placeholder = "Find", className }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cn("group flex h-9 items-center gap-2 rounded-full bg-white/[0.06] pl-3 pr-1.5 transition-colors focus-within:bg-white/[0.1]", className)}>
      <Search className="size-4 shrink-0 text-ink-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !value) return;
          e.stopPropagation();
          onChange("");
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-36 min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
      />
      <button
        onClick={() => onChange("")}
        aria-label="Clear"
        tabIndex={-1}
        className={cn("grid size-6 place-items-center rounded-full text-ink-3 transition-opacity hover:bg-white/10 hover:text-ink", value ? "opacity-100" : "pointer-events-none opacity-0")}
      >
        <X className="size-3.5" />
      </button>
    </label>
  );
}

export interface SortOption<T extends string> {
  value: T;
  label: string;
}

/** shows the current order; a click opens the choices */
export function SortButton<T extends string>({ value, options, onChange }: { value: T; options: SortOption<T>[]; onChange: (value: T) => void }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <button
      onClick={(e) => openMenu(e, options.map((o) => ({ label: o.label, icon: o.value === value ? Check : undefined, onSelect: () => onChange(o.value) })))}
      aria-label={`Sort by: ${current.label}`}
      aria-haspopup="menu"
      className="pressable flex h-9 items-center gap-2 rounded-full bg-white/[0.06] px-3.5 text-[13px] text-ink transition-colors hover:bg-white/[0.1]"
    >
      <ArrowDownUp className="size-3.5 text-ink-2" />
      {current.label}
    </button>
  );
}

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`encore.list.${key}`);
  } catch {
    return null;
  }
}

/** a choice remembered between visits, like the order a list was sorted in */
export function useListPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = readPref(key) as T | null;
    return saved && allowed.includes(saved) ? saved : fallback;
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(`encore.list.${key}`, next);
    } catch {
      // it just won't be remembered
    }
  };
  return [value, set];
}

// ---- song lists ----

export type TrackSort = "default" | "title" | "artist" | "album" | "duration";

const TRACK_COMPARE: Record<Exclude<TrackSort, "default">, (a: Track, b: Track) => number> = {
  title: (a, b) => byText(a.title, b.title),
  artist: (a, b) => byText(artistNames(a.artists), artistNames(b.artists)) || byText(a.album?.title ?? "", b.album?.title ?? "") || byText(a.title, b.title),
  album: (a, b) => byText(a.album?.title ?? "", b.album?.title ?? "") || byText(a.title, b.title),
  duration: (a, b) => a.durationMs - b.durationMs,
};

const TRACK_SORTS: TrackSort[] = ["default", "title", "artist", "album", "duration"];

/**
 * Find and sort for a list of songs. Returns the songs to show and where
 * each came from in the full list (so playlist rows keep their own keys),
 * plus the controls to put above the list.
 */
export function useTrackFinder(tracks: Track[], listKey: string, defaultLabel = "Custom order") {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useListPref<TrackSort>(`sort.${listKey}`, "default", TRACK_SORTS);
  const shown = useMemo(() => {
    const indexed = tracks.map((track, index) => ({ track, index })).filter(({ track }) => matchesQuery(query, track.title, artistNames(track.artists), track.album?.title));
    if (sort !== "default") indexed.sort((a, b) => TRACK_COMPARE[sort](a.track, b.track));
    return indexed;
  }, [tracks, query, sort]);

  const options: SortOption<TrackSort>[] = [
    { value: "default", label: defaultLabel },
    { value: "title", label: "Title" },
    { value: "artist", label: "Artist" },
    { value: "album", label: "Album" },
    { value: "duration", label: "Duration" },
  ];
  const toolbar = (
    <div className="mt-8 flex items-center justify-end gap-2">
      <FindField value={query} onChange={setQuery} placeholder="Find in list" />
      <SortButton value={sort} options={options} onChange={setSort} />
    </div>
  );
  return {
    tracks: shown.map((s) => s.track),
    /** where each shown song sits in the full list */
    indexes: shown.map((s) => s.index),
    query,
    /** true while the list is narrowed or reordered, so dragging to reorder is off */
    changed: query.trim() !== "" || sort !== "default",
    /** the find box and sort menu, right-aligned above the list */
    toolbar,
    /** shown in place of the list when the find box rules everything out */
    noMatches: tracks.length > 0 && shown.length === 0 ? <p className="py-12 text-center text-[13.5px] text-ink-3">No songs here match “{query.trim()}”.</p> : null,
  };
}
