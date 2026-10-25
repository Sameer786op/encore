import { create } from "zustand";
import type { SearchKind, SearchKindResults, SearchResults, SearchTab } from "@shared/types";
import { toast } from "@/ui/toast";

const RECENT_KEY = "encore.recentSearches";
const DEBOUNCE_MS = 300;

interface SearchStore {
  query: string;
  results: SearchResults | null;
  loading: boolean;
  /** the next page of songs or videos is on its way */
  loadingMore: boolean;
  error: string | null;
  recent: string[];
  tab: SearchTab;
  /** the artists, albums or playlists on their tab, for the search on screen */
  kind: { query: string; tab: SearchKind; results: SearchKindResults } | null;
  kindLoading: boolean;
  kindError: boolean;
  setQuery(query: string): void;
  /** search right away, e.g. on Enter */
  submit(query?: string): void;
  /** ask YouTube Music again for the search on screen, skipping what was kept from earlier */
  refresh(): void;
  setTab(tab: SearchTab): void;
  forgetRecent(query: string): void;
  clearRecent(): void;
  /** add the next page of songs or videos to the results */
  loadMore(what?: "songs" | "videos"): Promise<void>;
}

function loadRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // not important enough to report
  }
}

// the same search within 10 minutes is instant; after that YouTube Music is asked again, for anything new
const FRESH_MS = 10 * 60_000;
const cache = new Map<string, { results: SearchResults; at: number }>();
const kindCache = new Map<string, { results: SearchKindResults; at: number }>();
function fresh<T>(map: Map<string, { results: T; at: number }>, key: string): T | undefined {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < FRESH_MS ? hit.results : undefined;
}
function keep<T>(map: Map<string, { results: T; at: number }>, key: string, results: T): void {
  map.delete(key);
  map.set(key, { results, at: Date.now() });
  if (map.size > 40) map.delete(map.keys().next().value!);
}
const isKind = (tab: SearchTab): tab is SearchKind => tab === "artists" || tab === "albums" || tab === "playlists";
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;
let latestKind = 0;

export const useSearch = create<SearchStore>((set, get) => {
  async function run(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return set({ results: null, loading: false, error: null });
    const key = q.toLowerCase();
    const hit = fresh(cache, key);
    if (hit) {
      set({ results: hit, loading: false, error: null });
      return loadKind();
    }
    const ticket = ++latest;
    set({ loading: true, error: null });
    try {
      const results = await window.encore.catalog.search(q);
      keep(cache, key, results);
      if (ticket !== latest) return;
      set({ results, loading: false });
      void loadKind();
    } catch {
      if (ticket === latest) set({ loading: false, error: "Search isn't working right now. Check your connection and try again." });
    }
  }

  /** the open tab's artists, albums or playlists, for the spelling the results are for */
  async function loadKind(): Promise<void> {
    const { tab, results } = get();
    if (!isKind(tab) || !results) return;
    const q = (results.showingFor ?? results.query).trim();
    const key = `${tab}:${q.toLowerCase()}`;
    const hit = fresh(kindCache, key);
    if (hit) return set({ kind: { query: q, tab, results: hit }, kindLoading: false, kindError: false });
    const ticket = ++latestKind;
    set({ kindLoading: true, kindError: false });
    try {
      const found = await window.encore.catalog.searchKind(q, tab);
      keep(kindCache, key, found);
      if (ticket === latestKind) set({ kind: { query: q, tab, results: found }, kindLoading: false });
    } catch {
      if (ticket === latestKind) set({ kindLoading: false, kindError: true });
    }
  }

  function remember(query: string): void {
    const q = query.trim();
    if (!q) return;
    const recent = [q, ...get().recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 12);
    set({ recent });
    saveRecent(recent);
  }

  return {
    query: "",
    results: null,
    loading: false,
    loadingMore: false,
    error: null,
    recent: loadRecent(),
    tab: "all",
    kind: null,
    kindLoading: false,
    kindError: false,
    setQuery(query) {
      set({ query });
      clearTimeout(timer);
      if (!query.trim()) {
        latest++;
        // a new search starts on All
        set({ results: null, loading: false, error: null, tab: "all" });
        return;
      }
      set({ loading: !fresh(cache, query.trim().toLowerCase()) });
      timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    },
    submit(query) {
      const q = query ?? get().query;
      if (query !== undefined) set({ query });
      clearTimeout(timer);
      remember(q);
      void run(q);
    },
    refresh() {
      const { results, query, tab } = get();
      const q = results?.query ?? query;
      if (!q.trim()) return;
      clearTimeout(timer);
      cache.delete(q.trim().toLowerCase());
      if (isKind(tab)) kindCache.delete(`${tab}:${(results?.showingFor ?? q).trim().toLowerCase()}`);
      void run(q);
    },
    setTab(tab) {
      set({ tab });
      void loadKind();
    },
    forgetRecent(query) {
      const recent = get().recent.filter((r) => r !== query);
      set({ recent });
      saveRecent(recent);
    },
    clearRecent() {
      set({ recent: [] });
      saveRecent([]);
    },
    async loadMore(what = "songs") {
      const { results, loadingMore } = get();
      const token = what === "songs" ? results?.moreSongs : results?.moreVideos;
      if (!results || !token || loadingMore) return;
      set({ loadingMore: true });
      try {
        const page = await window.encore.catalog.searchMore(token);
        const current = get().results;
        // a different search was made meanwhile
        if (!current || current.query !== results.query) return;
        const list = what === "songs" ? current.tracks : current.videos;
        const seen = new Set(list.map((t) => t.id));
        const added = [...list, ...page.tracks.filter((t) => !seen.has(t.id))];
        const next = what === "songs" ? { ...current, tracks: added, moreSongs: page.more } : { ...current, videos: added, moreVideos: page.more };
        const entry = cache.get(next.query.toLowerCase());
        if (entry) entry.results = next;
        set({ results: next });
      } catch {
        toast(`Couldn't load more ${what}. Try the search again.`, { kind: "error" });
      } finally {
        set({ loadingMore: false });
      }
    },
  };
});
