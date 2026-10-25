import { create } from "zustand";
import type { Playlist, Track } from "@shared/types";

export type ModalState =
  | { kind: "create-playlist"; tracks?: Track[]; onCreated?: (playlist: Playlist) => void }
  | { kind: "rename-playlist"; id: string; name: string }
  | { kind: "confirm"; title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void }
  | { kind: "pick-song"; query: string; onPick: (track: Track) => void };

interface ModalStore {
  modal: ModalState | null;
  open(modal: ModalState): void;
  close(): void;
}

export const useModal = create<ModalStore>((set) => ({
  modal: null,
  open: (modal) => set({ modal }),
  close: () => set({ modal: null }),
}));

export const openModal = (modal: ModalState) => useModal.getState().open(modal);
