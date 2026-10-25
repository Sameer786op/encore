import { create } from "zustand";

export type Route =
  | { name: "home" }
  | { name: "search" }
  | { name: "library" }
  | { name: "liked" }
  | { name: "history" }
  | { name: "playlist"; id: string }
  | { name: "album"; id: string }
  | { name: "artist"; id: string }
  | { name: "mix"; id: string }
  | { name: "import" }
  | { name: "import-job"; id: string }
  | { name: "listening" }
  | { name: "local" }
  | { name: "settings" };

interface NavStore {
  stack: Route[];
  index: number;
  route: Route;
  navigate(route: Route): void;
  back(): void;
  forward(): void;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

export const useNav = create<NavStore>((set, get) => ({
  stack: [{ name: "home" }],
  index: 0,
  route: { name: "home" },
  navigate(route) {
    const { stack, index } = get();
    if (same(stack[index], route)) return;
    const next = [...stack.slice(0, index + 1), route].slice(-50);
    set({ stack: next, index: next.length - 1, route });
  },
  back() {
    const { stack, index } = get();
    if (index > 0) set({ index: index - 1, route: stack[index - 1] });
  },
  forward() {
    const { stack, index } = get();
    if (index < stack.length - 1) set({ index: index + 1, route: stack[index + 1] });
  },
}));

export const navigate = (route: Route) => useNav.getState().navigate(route);
