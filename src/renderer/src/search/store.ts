import { create } from "zustand";
import type { SearchResults } from "@shared/types";

const RECENT_KEY = "encore.recentSearches";
const DEBOUNCE_MS = 300;

interface SearchStore {
  query: string;
  results: SearchResults | null;
  loading: boolean;
  error: string | null;
  recent: string[];
  setQuery(query: string): void;
  /** search right away, e.g. on Enter */
  submit(query?: string): void;
  forgetRecent(query: string): void;
  clearRecent(): void;
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

const cache = new Map<string, SearchResults>();
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

export const useSearch = create<SearchStore>((set, get) => {
  async function run(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return set({ results: null, loading: false, error: null });
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit) return set({ results: hit, loading: false, error: null });
    const ticket = ++latest;
    set({ loading: true, error: null });
    try {
      const results = await window.encore.catalog.search(q);
      cache.set(key, results);
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
      set({ loading: !cache.has(query.trim().toLowerCase()) });
      timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    },
    submit(query) {
      const q = query ?? get().query;
      if (query !== undefined) set({ query });
      clearTimeout(timer);
      remember(q);
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
  };
});
