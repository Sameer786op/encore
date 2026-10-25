import { create } from "zustand";

interface ViewStore {
  /** the full-screen player is open */
  fullscreen: boolean;
  /** show lyrics next to the cover in the full-screen player */
  lyrics: boolean;
  miniOpen: boolean;
  openFullscreen(withLyrics?: boolean): void;
  closeFullscreen(): void;
  setLyrics(on: boolean): void;
}

export const useView = create<ViewStore>((set) => ({
  fullscreen: false,
  lyrics: true,
  miniOpen: false,
  openFullscreen: (withLyrics) => set((s) => ({ fullscreen: true, lyrics: withLyrics ?? s.lyrics })),
  closeFullscreen: () => set({ fullscreen: false }),
  setLyrics: (lyrics) => set({ lyrics }),
}));
