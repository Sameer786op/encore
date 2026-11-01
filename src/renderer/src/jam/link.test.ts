import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanEnvelope, Ordering, relayKey, relayTopic, seal, unseal, type Envelope } from "./link";

const msg = (s: number, f = "alex", l = "one"): Envelope => ({ f, l, s, c: "clock", d: { n: s } });

describe("relayed messages, back in order", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function collect() {
    const got: string[] = [];
    const ordering = new Ordering((e) => got.push(`${e.f}${e.s}`), 800);
    return { got, ordering };
  }

  it("waits a moment for a new player's first message, then starts from the earliest", () => {
    const { got, ordering } = collect();
    ordering.add(msg(3));
    ordering.add(msg(2));
    expect(got).toEqual([]);
    vi.advanceTimersByTime(800);
    expect(got).toEqual(["alex2", "alex3"]);
    ordering.add(msg(4));
    expect(got).toEqual(["alex2", "alex3", "alex4"]);
  });

  it("puts a late message back in its place", () => {
    const { got, ordering } = collect();
    ordering.add(msg(0));
    vi.advanceTimersByTime(800);
    ordering.add(msg(2));
    ordering.add(msg(1));
    expect(got).toEqual(["alex0", "alex1", "alex2"]);
  });

  it("delivers each message once, though every relay passes it on", () => {
    const { got, ordering } = collect();
    for (let relay = 0; relay < 4; relay++) [0, 1, 2].forEach((s) => ordering.add(msg(s)));
    vi.advanceTimersByTime(800);
    for (let relay = 0; relay < 4; relay++) [0, 1, 2, 3].forEach((s) => ordering.add(msg(s)));
    expect(got).toEqual(["alex0", "alex1", "alex2", "alex3"]);
  });

  it("stops waiting for a message that never comes", () => {
    const { got, ordering } = collect();
    ordering.add(msg(0));
    vi.advanceTimersByTime(800);
    ordering.add(msg(2));
    ordering.add(msg(3));
    expect(got).toEqual(["alex0"]);
    vi.advanceTimersByTime(800);
    expect(got).toEqual(["alex0", "alex2", "alex3"]);
    // and the lost one, turning up after all, is out of date
    ordering.add(msg(1));
    expect(got).toEqual(["alex0", "alex2", "alex3"]);
  });

  it("keeps each player, and each time they join, apart", () => {
    const { got, ordering } = collect();
    ordering.add(msg(5, "alex"));
    ordering.add(msg(0, "kai"));
    vi.advanceTimersByTime(800);
    // Alex left and came back: counting starts again
    ordering.add(msg(0, "alex", "two"));
    vi.advanceTimersByTime(800);
    ordering.add(msg(6, "alex"));
    ordering.add(msg(1, "alex", "two"));
    expect(got).toEqual(["alex5", "kai0", "alex0", "alex6", "alex1"]);
  });
});

describe("sealing relayed messages", () => {
  it("opens with the same Jam's key", async () => {
    const key = await relayKey("ABCD-EFGH");
    const envelope: Envelope = { f: "sam", l: "x1", s: 4, c: "queue", d: { items: Array.from({ length: 40 }, (_, i) => ({ title: `Song ${i}` })) }, t: ["alex"] };
    const sealed = await seal(key, envelope);
    expect(sealed).not.toContain("Song");
    expect(await unseal(key, sealed)).toEqual(envelope);
  });

  it("doesn't open with another Jam's key, or anything not sealed", async () => {
    const sealed = await seal(await relayKey("ABCD-EFGH"), msg(1));
    expect(await unseal(await relayKey("ABCD-EFGJ"), sealed)).toBeNull();
    expect(await unseal(await relayKey("ABCD-EFGH"), "not sealed")).toBeNull();
    expect(await unseal(await relayKey("ABCD-EFGH"), JSON.stringify(msg(1)))).toBeNull();
  });

  it("meets at a place that gives nothing away about the code", async () => {
    const topic = await relayTopic("ABCD-EFGH");
    expect(topic).toMatch(/^[0-9a-f]{40}$/);
    expect(topic).toBe(await relayTopic("ABCD-EFGH"));
    expect(topic).not.toBe(await relayTopic("ABCD-EFGJ"));
  });
});

describe("relayed envelopes from other players", () => {
  it("takes messages and presence", () => {
    expect(cleanEnvelope(msg(2))).toEqual(msg(2));
    expect(cleanEnvelope({ f: "a", l: "b", s: 0, p: "here" })).toEqual({ f: "a", l: "b", s: 0, p: "here" });
    expect(cleanEnvelope({ f: "a", l: "b", s: 0, c: "do", d: 1, t: ["x", "y"] })).toEqual({ f: "a", l: "b", s: 0, c: "do", d: 1, t: ["x", "y"] });
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "text",
      [],
      { f: "a", l: "b", s: 0 },
      { f: "a", l: "b", s: -1, p: "here" },
      { f: "a", l: "b", s: 1.5, p: "here" },
      { f: "", l: "b", s: 0, p: "here" },
      { f: "a b", l: "b", s: 0, p: "here" },
      { f: "a", l: "b", s: 0, p: "away" },
      { f: "a", l: "b", s: 0, c: "Not A Channel" },
      { f: "a", l: "b", s: 0, c: "clock", t: "x" },
      { f: "a", l: "b", s: 0, c: "clock", t: [1] },
    ])
      expect(cleanEnvelope(bad)).toBeNull();
  });
});
