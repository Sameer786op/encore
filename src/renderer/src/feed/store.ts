import { create } from "zustand";
import type { DailyMix, FeedStatus, HomeFeed } from "@shared/types";
import type { MoodId } from "@shared/moods";

interface FeedStore {
  feed: HomeFeed | null;
  /** the first answer from the main process has arrived */
  loaded: boolean;
  status: FeedStatus;
  /** mood mixes started today, newest first; kept here too, as the home feed may not be built yet */
  moodMixes: DailyMix[];
  /** the mood whose mix is being made right now */
  moodBuilding: MoodId | null;
  init(): void;
  refresh(): Promise<void>;
  moodMix(mood: MoodId, fresh?: boolean): Promise<DailyMix>;
}

let started = false;

/** the personal home page, built in the main process and kept in sync */
export const useFeed = create<FeedStore>((set) => ({
  feed: null,
  loaded: false,
  status: { building: false },
  moodMixes: [],
  moodBuilding: null,
  init() {
    if (started) return;
    started = true;
    window.encore.feed.onChange((feed) => set((s) => ({ feed, loaded: true, moodMixes: feed.moodMixes ?? s.moodMixes })));
    window.encore.feed.onStatus((status) => set({ status }));
    // a rebuild may already have pushed a newer feed by the time this answers
    void window.encore.feed.get().then((feed) => set((s) => ({ feed: s.feed ?? feed, loaded: true, moodMixes: s.feed ? s.moodMixes : (feed?.moodMixes ?? s.moodMixes) })));
    void window.encore.feed.status().then((status) => set({ status }));
  },
  refresh: () => window.encore.feed.refresh(),
  async moodMix(mood, fresh = false) {
    set({ moodBuilding: mood });
    try {
      const mix = await window.encore.feed.moodMix(mood, fresh);
      set((s) => ({ moodMixes: [mix, ...s.moodMixes.filter((m) => m.id !== mix.id)] }));
      return mix;
    } finally {
      set((s) => (s.moodBuilding === mood ? { moodBuilding: null } : {}));
    }
  },
}));
