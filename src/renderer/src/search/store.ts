import { create } from "zustand";
import type { SearchResults } from "@shared/types";
import { toast } from "@/ui/toast";

const RECENT_KEY = "encore.recentSearches";
const DEBOUNCE_MS = 300;

interface SearchStore {
  query: string;
  results: SearchResults | null;
  loading: boolean;
  /** the next page of songs is on its way */
  loadingMore: boolean;
  error: string | null;
  recent: string[];
  setQuery(query: string): void;
  /** search right away, e.g. on Enter */
  submit(query?: string): void;
  /** ask YouTube Music again for the search on screen, skipping what was kept from earlier */
  refresh(): void;
  forgetRecent(query: string): void;
  clearRecent(): void;
  /** add the next page of songs to the results */
  loadMore(): Promise<void>;
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
const cached = (key: string) => {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < FRESH_MS ? hit.results : undefined;
};
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

export const useSearch = create<SearchStore>((set, get) => {
  async function run(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return set({ results: null, loading: false, error: null });
    const key = q.toLowerCase();
    const hit = cached(key);
    if (hit) return set({ results: hit, loading: false, error: null });
    const ticket = ++latest;
    set({ loading: true, error: null });
    try {
      const results = await window.encore.catalog.search(q);
      cache.delete(key);
      cache.set(key, { results, at: Date.now() });
      if (cache.size > 40) cache.delete(cache.keys().next().value!);
      if (ticket === latest) set({ results, loading: false });
    } catch {
      if (ticket === latest) set({ loading: false, error: "Search isn't working right now. Check your connection and try again." });
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
    setQuery(query) {
      set({ query });
      clearTimeout(timer);
      if (!query.trim()) {
        latest++;
        set({ results: null, loading: false, error: null });
        return;
      }
      set({ loading: !cached(query.trim().toLowerCase()) });
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
      const q = get().results?.query ?? get().query;
      if (!q.trim()) return;
      clearTimeout(timer);
      cache.delete(q.trim().toLowerCase());
      void run(q);
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
    async loadMore() {
      const { results, loadingMore } = get();
      if (!results?.moreSongs || loadingMore) return;
      set({ loadingMore: true });
      try {
        const page = await window.encore.catalog.searchMore(results.moreSongs);
        const current = get().results;
        // a different search was made meanwhile
        if (!current || current.query !== results.query) return;
        const seen = new Set(current.tracks.map((t) => t.id));
        const next = { ...current, tracks: [...current.tracks, ...page.tracks.filter((t) => !seen.has(t.id))], moreSongs: page.more };
        const entry = cache.get(next.query.toLowerCase());
        if (entry) entry.results = next;
        set({ results: next });
      } catch {
        toast("Couldn't load more songs. Try the search again.", { kind: "error" });
      } finally {
        set({ loadingMore: false });
      }
    },
  };
});
