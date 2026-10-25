import type { Track } from "@shared/types";

// Pure queue logic. Every function returns a new state and never touches
// audio, so the rules are easy to test.

export type RepeatMode = "off" | "all" | "one";

export interface PlayContext {
  kind: "search" | "album" | "artist" | "playlist" | "liked" | "history" | "radio" | "home" | "track" | "mix";
  label: string;
  id?: string;
}

export interface QueueItem {
  uid: string;
  track: Track;
}

export interface QueueState {
  items: QueueItem[];
  /** position of the current item, -1 when nothing is loaded */
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** the order before shuffling, so turning shuffle off restores it */
  unshuffled: string[] | null;
  context: PlayContext | null;
}

export type Random = () => number;

export const emptyQueue: QueueState = { items: [], index: -1, shuffle: false, repeat: "off", unshuffled: null, context: null };

let uidCounter = 0;
export function makeItems(tracks: Track[]): QueueItem[] {
  return tracks.map((track) => ({ uid: `q${Date.now().toString(36)}${(uidCounter++).toString(36)}`, track }));
}

function shuffled<T>(list: T[], random: Random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function currentItem(state: QueueState): QueueItem | null {
  return state.items[state.index] ?? null;
}

export function upcomingItems(state: QueueState): QueueItem[] {
  return state.index < 0 ? state.items : state.items.slice(state.index + 1);
}

/** replace the queue with a list and start at `startIndex` */
export function loadQueue(state: QueueState, tracks: Track[], startIndex: number, context: PlayContext | null, random: Random = Math.random): QueueState {
  if (tracks.length === 0) return { ...state, items: [], index: -1, unshuffled: null, context };
  const start = Math.min(Math.max(0, startIndex), tracks.length - 1);
  const items = makeItems(tracks);
  if (!state.shuffle) return { ...state, items, index: start, unshuffled: null, context };
  // shuffled: the chosen song plays first, the rest follow in random order
  const first = items[start];
  const rest = shuffled(items.filter((_, i) => i !== start), random);
  return { ...state, items: [first, ...rest], index: 0, unshuffled: items.map((i) => i.uid), context };
}

/** where to go when a song ends (auto) or the user presses next; null = nothing left */
export function nextIndex(state: QueueState, auto: boolean): number | null {
  if (state.items.length === 0) return null;
  if (auto && state.repeat === "one") return state.index;
  if (state.index < state.items.length - 1) return state.index + 1;
  // skipping on while repeating one song wraps around like repeat all
  if (state.repeat !== "off") return 0;
  return null;
}

export function previousIndex(state: QueueState): number {
  if (state.index > 0) return state.index - 1;
  if (state.repeat !== "off" && state.items.length > 0) return state.items.length - 1;
  return Math.max(0, state.index);
}

export function jumpTo(state: QueueState, uid: string): QueueState {
  const index = state.items.findIndex((i) => i.uid === uid);
  return index < 0 ? state : { ...state, index };
}

export function setIndex(state: QueueState, index: number): QueueState {
  return { ...state, index };
}

function insertIntoUnshuffled(state: QueueState, afterUid: string | null, uids: string[]): string[] | null {
  if (!state.unshuffled) return null;
  const order = [...state.unshuffled];
  const at = afterUid ? order.indexOf(afterUid) + 1 : order.length;
  order.splice(at <= 0 ? order.length : at, 0, ...uids);
  return order;
}

/** insert right after the current song */
export function playNext(state: QueueState, tracks: Track[]): QueueState {
  if (state.index < 0) return addToQueue(state, tracks);
  const added = makeItems(tracks);
  const items = [...state.items];
  items.splice(state.index + 1, 0, ...added);
  return { ...state, items, unshuffled: insertIntoUnshuffled(state, items[state.index].uid, added.map((a) => a.uid)) };
}

export function addToQueue(state: QueueState, tracks: Track[]): QueueState {
  const added = makeItems(tracks);
  const items = [...state.items, ...added];
  return {
    ...state,
    items,
    index: state.index < 0 && items.length > 0 ? 0 : state.index,
    unshuffled: insertIntoUnshuffled(state, null, added.map((a) => a.uid)),
  };
}

/** removing the current song leaves `index` on the song that took its place */
export function removeItem(state: QueueState, uid: string): { state: QueueState; removedCurrent: boolean } {
  const at = state.items.findIndex((i) => i.uid === uid);
  if (at < 0) return { state, removedCurrent: false };
  const items = state.items.filter((i) => i.uid !== uid);
  const removedCurrent = at === state.index;
  let index = state.index;
  if (at < state.index) index -= 1;
  if (index >= items.length) index = items.length - 1;
  const unshuffled = state.unshuffled?.filter((u) => u !== uid) ?? null;
  return { state: { ...state, items, index, unshuffled }, removedCurrent };
}

/** set a new order for everything after the current song */
export function reorderUpcoming(state: QueueState, uids: string[]): QueueState {
  const head = state.items.slice(0, state.index + 1);
  const tail = state.items.slice(state.index + 1);
  const byUid = new Map(tail.map((i) => [i.uid, i]));
  const reordered = uids.map((u) => byUid.get(u)).filter((i): i is QueueItem => !!i);
  // keep anything the caller did not mention, in its old order
  const missing = tail.filter((i) => !uids.includes(i.uid));
  return { ...state, items: [...head, ...reordered, ...missing] };
}

export function clearUpcoming(state: QueueState): QueueState {
  const items = state.items.slice(0, state.index + 1);
  const keep = new Set(items.map((i) => i.uid));
  return { ...state, items, unshuffled: state.unshuffled?.filter((u) => keep.has(u)) ?? null };
}

export function setShuffle(state: QueueState, on: boolean, random: Random = Math.random): QueueState {
  if (on === state.shuffle) return state;
  if (on) {
    const head = state.items.slice(0, state.index + 1);
    const tail = shuffled(state.items.slice(state.index + 1), random);
    return { ...state, shuffle: true, items: [...head, ...tail], unshuffled: state.items.map((i) => i.uid) };
  }
  const current = currentItem(state);
  const order = state.unshuffled ?? [];
  const rank = new Map(order.map((uid, i) => [uid, i]));
  // songs added while shuffled have no rank; they go to the end in queue order
  const rankOf = (item: QueueItem, position: number) => rank.get(item.uid) ?? order.length + position;
  const items = state.items
    .map((item, position) => ({ item, key: rankOf(item, position) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item);
  const index = current ? items.findIndex((i) => i.uid === current.uid) : -1;
  return { ...state, shuffle: false, items, index, unshuffled: null };
}

export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}
