import { describe, expect, it, vi } from "vitest";
import { Pool, PremiumAudio } from "./premium";

/** a source the test feeds by hand, like SABR handing over segments */
function feed() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const source = {
    stream,
    aborted: false,
    abort() {
      source.aborted = true;
      controller.error(new Error("aborted"));
    },
  };
  return { source, push: (...bytes: number[]) => controller.enqueue(Uint8Array.from(bytes)), end: () => controller.close() };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(...value);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PremiumAudio", () => {
  it("doesn't fetch anything until the song is read", () => {
    const open = vi.fn(() => feed().source);
    new PremiumAudio(4, open, new Pool());
    expect(open).not.toHaveBeenCalled();
  });

  it("hands over a range as its bytes arrive, waiting for the ones still to come", async () => {
    const { source, push, end } = feed();
    const audio = new PremiumAudio(6, () => source, new Pool());
    const middle = readAll(audio.read(2, 4));
    push(10, 11, 12);
    await tick();
    push(13, 14, 15);
    end();
    expect(await middle).toEqual([12, 13, 14]);
    expect(await readAll(audio.read(0, 5))).toEqual([10, 11, 12, 13, 14, 15]);
    expect(audio.spent).toBe(false);
  });

  it("fails when the audio stops short, so the song can be played the usual way", async () => {
    const { source, push, end } = feed();
    const audio = new PremiumAudio(6, () => source, new Pool());
    const tail = readAll(audio.read(4, 5));
    push(1, 2, 3);
    end();
    await expect(tail).rejects.toThrow(/stopped at 3 of 6/);
    expect(audio.failed).toBe(true);
    expect(audio.spent).toBe(true);
    // what did arrive can still be read
    expect(await readAll(audio.read(0, 2))).toEqual([1, 2, 3]);
  });

  it("fails when more arrives than YouTube said there would be", async () => {
    const { source, push } = feed();
    const audio = new PremiumAudio(2, () => source, new Pool());
    const all = readAll(audio.read(0, 1));
    push(1, 2, 3);
    await expect(all).rejects.toThrow(/More audio/);
    expect(audio.failed).toBe(true);
  });

  it("lets go of the oldest song once memory runs past the limit, but keeps the two most recent", async () => {
    const pool = new Pool(10, 2);
    const feeds = [feed(), feed(), feed()];
    const songs = feeds.map((f) => new PremiumAudio(6, () => f.source, pool));
    const first = readAll(songs[0].read(0, 5));
    songs[1].read(0, 0);
    expect(songs[0].spent).toBe(false);
    songs[2].read(0, 0);
    expect(songs[0].spent).toBe(true);
    expect(feeds[0].source.aborted).toBe(true);
    await expect(first).rejects.toThrow();
    expect(songs[1].spent).toBe(false);
    expect(songs[2].spent).toBe(false);
  });

  it("counts a song read again as the most recent", () => {
    const pool = new Pool(10, 2);
    const feeds = [feed(), feed(), feed()];
    const songs = feeds.map((f) => new PremiumAudio(6, () => f.source, pool));
    songs[0].read(0, 0);
    songs[1].read(0, 0);
    songs[0].read(0, 0);
    songs[2].read(0, 0);
    expect(songs[0].spent).toBe(false);
    expect(songs[1].spent).toBe(true);
  });
});
