import { create } from "zustand";
import type { ImportJob, LocalScanState, Track } from "@shared/types";

interface ImportsStore {
  jobs: ImportJob[];
  init(): void;
}

let importsStarted = false;

/** every import, kept in sync with the main process */
export const useImports = create<ImportsStore>((set) => ({
  jobs: [],
  init() {
    if (importsStarted) return;
    importsStarted = true;
    window.encore.imports.onChange((jobs) => set({ jobs }));
    void window.encore.imports.list().then((jobs) => set({ jobs }));
  },
}));

export const isWaiting = (job: ImportJob) => job.status === "matching" || job.status === "review";

interface LocalStore {
  state: LocalScanState;
  tracks: Track[];
  init(): void;
  refresh(): Promise<void>;
}

let localStarted = false;

export const useLocal = create<LocalStore>((set, get) => ({
  state: { folders: [], scanning: false, found: 0, processed: 0, tracks: 0, unsupported: 0 },
  tracks: [],
  init() {
    if (localStarted) return;
    localStarted = true;
    window.encore.local.onState((state) => {
      const before = get().state;
      set({ state });
      // reload the list when a scan ends or the number of songs changes
      if ((before.scanning && !state.scanning) || before.tracks !== state.tracks || before.folders.length !== state.folders.length) void get().refresh();
    });
    void window.encore.local.state().then((state) => set({ state }));
    void get().refresh();
  },
  async refresh() {
    set({ tracks: await window.encore.local.tracks() });
  },
}));
