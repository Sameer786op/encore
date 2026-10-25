import type { MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { create } from "zustand";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  submenu?: MenuEntry[];
  danger?: boolean;
  disabled?: boolean;
}

export type MenuEntry = MenuItem | "divider";

interface MenuStore {
  menu: { x: number; y: number; entries: MenuEntry[] } | null;
  close(): void;
}

export const useMenu = create<MenuStore>((set) => ({
  menu: null,
  close: () => set({ menu: null }),
}));

/** open a menu at the pointer (right-click) or under the clicked button */
export function openMenu(event: MouseEvent, entries: MenuEntry[]): void {
  event.preventDefault();
  event.stopPropagation();
  let { clientX: x, clientY: y } = event;
  if (event.type === "click" && event.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect();
    x = rect.right;
    y = rect.bottom + 4;
  }
  useMenu.setState({ menu: { x, y, entries: tidy(entries) } });
}

/** no leading, trailing or doubled dividers */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry === "divider" && (out.length === 0 || out[out.length - 1] === "divider")) continue;
    out.push(entry);
  }
  while (out[out.length - 1] === "divider") out.pop();
  return out;
}
