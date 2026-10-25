import { create } from "zustand";
import type { FeedStatus, HomeFeed } from "@shared/types";

interface FeedStore {
  feed: HomeFeed | null;
  /** the first answer from the main process has arrived */
  loaded: boolean;
  status: FeedStatus;
  init(): void;
  refresh(): Promise<void>;
}

let started = false;

/** the personal home page, built in the main process and kept in sync */
export const useFeed = create<FeedStore>((set) => ({
  feed: null,
  loaded: false,
  status: { building: false },
  init() {
    if (started) return;
    started = true;
    window.encore.feed.onChange((feed) => set({ feed, loaded: true }));
    window.encore.feed.onStatus((status) => set({ status }));
    // a rebuild may already have pushed a newer feed by the time this answers
    void window.encore.feed.get().then((feed) => set((s) => ({ feed: s.feed ?? feed, loaded: true })));
    void window.encore.feed.status().then((status) => set({ status }));
  },
  refresh: () => window.encore.feed.refresh(),
}));
