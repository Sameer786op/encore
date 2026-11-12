import { create } from "zustand";

interface ViewStore {
  /** the full-screen player is open */
  fullscreen: boolean;
  /** it has finished sliding up and covers the whole window, so the app under it can stop drawing */
  covered: boolean;
  /** show lyrics next to the cover in the full-screen player */
  lyrics: boolean;
  miniOpen: boolean;
  openFullscreen(withLyrics?: boolean): void;
  closeFullscreen(): void;
  /** the full-screen player finished an animation; it covers the window if it is still open */
  settled(): void;
  setLyrics(on: boolean): void;
}

export const useView = create<ViewStore>((set) => ({
  fullscreen: false,
  covered: false,
  lyrics: true,
  miniOpen: false,
  openFullscreen: (withLyrics) => set((s) => ({ fullscreen: true, lyrics: withLyrics ?? s.lyrics })),
  // the app shows again the moment the player starts to slide away
  closeFullscreen: () => set({ fullscreen: false, covered: false }),
  settled: () => set((s) => (s.fullscreen && !s.covered ? { covered: true } : s)),
  setLyrics: (lyrics) => set({ lyrics }),
}));
