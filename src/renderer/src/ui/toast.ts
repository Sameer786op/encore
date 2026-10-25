import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

interface ToastStore {
  toasts: Toast[];
  push(message: string, options?: { kind?: Toast["kind"]; action?: Toast["action"]; durationMs?: number }): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push(message, options = {}) {
    const id = nextId++;
    const toast: Toast = { id, message, kind: options.kind ?? "info", action: options.action };
    // keep at most three on screen
    set({ toasts: [...get().toasts.slice(-2), toast] });
    setTimeout(() => get().dismiss(id), options.durationMs ?? 3500);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (message: string, options?: Parameters<ToastStore["push"]>[1]) => useToasts.getState().push(message, options);
