import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types";
import {
  addToQueue,
  clearUpcoming,
  currentItem,
  cycleRepeat,
  emptyQueue,
  jumpTo,
  loadQueue,
  nextIndex,
  playNext,
  previousIndex,
  removeItem,
  reorderUpcoming,
  setShuffle,
  upcomingItems,
  type QueueState,
} from "./queue";

const t = (n: number): Track => ({
  id: `youtube:${n}`,
  source: "youtube",
  sourceId: String(n),
  title: `T${n}`,
  artists: [],
  durationMs: 0,
});
const titles = (s: QueueState) => s.items.map((i) => i.track.title);
// deterministic "random": always picks the first remaining slot
const firstPick = () => 0;

describe("queue", () => {
  it("loads a list and starts at the chosen song", () => {
    const s = loadQueue(emptyQueue, [t(1), t(2), t(3)], 1, null);
    expect(currentItem(s)?.track.title).toBe("T2");
    expect(upcomingItems(s).map((i) => i.track.title)).toEqual(["T3"]);
  });

  it("loading with shuffle on plays the chosen song first", () => {
    const s = loadQueue({ ...emptyQueue, shuffle: true }, [t(1), t(2), t(3), t(4)], 2, null, firstPick);
    expect(s.index).toBe(0);
    expect(titles(s)[0]).toBe("T3");
    expect([...titles(s)].sort()).toEqual(["T1", "T2", "T3", "T4"]);
  });

  it("stops at the end unless repeat is on", () => {
    let s = loadQueue(emptyQueue, [t(1), t(2)], 1, null);
    expect(nextIndex(s, true)).toBeNull();
    s = { ...s, repeat: "all" };
    expect(nextIndex(s, true)).toBe(0);
    s = { ...s, repeat: "one" };
    expect(nextIndex(s, true)).toBe(1);
    // pressing next while repeating one still moves on
    expect(nextIndex(s, false)).toBe(0);
  });

  it("previous wraps only with repeat all", () => {
    const s = loadQueue(emptyQueue, [t(1), t(2)], 0, null);
    expect(previousIndex(s)).toBe(0);
    expect(previousIndex({ ...s, repeat: "all" })).toBe(1);
  });

  it("play next inserts after the current song, add to queue appends", () => {
    let s = loadQueue(emptyQueue, [t(1), t(2), t(3)], 0, null);
    s = playNext(s, [t(9)]);
    s = addToQueue(s, [t(8)]);
    expect(titles(s)).toEqual(["T1", "T9", "T2", "T3", "T8"]);
    expect(s.index).toBe(0);
  });

  it("adding to an empty queue makes the first song current", () => {
    expect(addToQueue(emptyQueue, [t(1)]).index).toBe(0);
    expect(playNext(emptyQueue, [t(1)]).index).toBe(0);
  });

  it("removing songs keeps the current one in place", () => {
    const s = loadQueue(emptyQueue, [t(1), t(2), t(3), t(4)], 2, null);
    const before = removeItem(s, s.items[0].uid);
    expect(before.removedCurrent).toBe(false);
    expect(currentItem(before.state)?.track.title).toBe("T3");

    const current = removeItem(s, s.items[2].uid);
    expect(current.removedCurrent).toBe(true);
    expect(currentItem(current.state)?.track.title).toBe("T4");

    const last = loadQueue(emptyQueue, [t(1), t(2)], 1, null);
    const removedLast = removeItem(last, last.items[1].uid);
    expect(removedLast.state.index).toBe(0);
  });

  it("reorders upcoming songs without touching history or the current song", () => {
    const s = loadQueue(emptyQueue, [t(1), t(2), t(3), t(4)], 1, null);
    const [, , c, d] = s.items;
    const r = reorderUpcoming(s, [d.uid, c.uid]);
    expect(titles(r)).toEqual(["T1", "T2", "T4", "T3"]);
    expect(currentItem(r)?.track.title).toBe("T2");
  });

  it("clears only what is still to come", () => {
    const s = clearUpcoming(loadQueue(emptyQueue, [t(1), t(2), t(3)], 1, null));
    expect(titles(s)).toEqual(["T1", "T2"]);
  });

  it("shuffle keeps played songs, and turning it off restores the order", () => {
    let s = loadQueue(emptyQueue, [t(1), t(2), t(3), t(4), t(5)], 1, null);
    s = setShuffle(s, true, firstPick);
    expect(titles(s).slice(0, 2)).toEqual(["T1", "T2"]);
    expect(titles(s).slice(2)).not.toEqual(["T3", "T4", "T5"]);
    s = addToQueue(s, [t(6)]);
    s = jumpTo(s, s.items[3].uid);
    const playing = currentItem(s)?.track.title;
    s = setShuffle(s, false);
    expect(titles(s)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    expect(currentItem(s)?.track.title).toBe(playing);
  });

  it("songs added while shuffled keep their relative order when unshuffling", () => {
    let s = setShuffle(loadQueue(emptyQueue, [t(1), t(2)], 0, null), true, firstPick);
    s = { ...s, unshuffled: null };
    s = addToQueue(addToQueue(s, [t(3)]), [t(4)]);
    s = setShuffle(s, false);
    expect(titles(s).slice(-2)).toEqual(["T3", "T4"]);
  });

  it("repeat cycles off, all, one", () => {
    expect([cycleRepeat("off"), cycleRepeat("all"), cycleRepeat("one")]).toEqual(["all", "one", "off"]);
  });
});
