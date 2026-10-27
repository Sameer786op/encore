import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./youtube/client", () => ({ getYouTube: () => Promise.reject(new Error("offline in tests")), resetYouTube: () => undefined }));

const { piecewise } = await import("./media-protocol");

const FILE = Uint8Array.from({ length: 20 }, (_, i) => i);
const asked: string[] = [];

/** a stream server that answers ranges of FILE, at most `cap` bytes each */
function serve(cap = Infinity, refuseFrom = Infinity) {
  vi.stubGlobal("fetch", async (_url: string, init: { headers: { range: string } }) => {
    asked.push(init.headers.range);
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.range)!.map(Number);
    if (a >= refuseFrom) return new Response(null, { status: 403 });
    return new Response(FILE.slice(a, Math.min(b + 1, a + cap)), { status: 206 });
  });
}

const body = (bytes: Uint8Array) => new Response(bytes).body!;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(...value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  asked.length = 0;
});

describe("piecewise", () => {
  it("answers the whole range, fetching the rest a piece at a time after the first", async () => {
    serve();
    const stream = piecewise(body(FILE.slice(2, 6)), "https://example.test/a", 2, 13, new AbortController().signal, 4);
    expect(await readAll(stream)).toEqual([...FILE.slice(2, 14)]);
    expect(asked).toEqual(["bytes=6-9", "bytes=10-13"]);
  });

  it("carries on from where a short piece stopped", async () => {
    serve(3);
    const stream = piecewise(body(FILE.slice(0, 4)), "https://example.test/a", 0, 11, new AbortController().signal, 4);
    expect(await readAll(stream)).toEqual([...FILE.slice(0, 12)]);
    expect(asked).toEqual(["bytes=4-7", "bytes=7-10", "bytes=10-11"]);
  });

  it("fails when YouTube refuses a later piece, so the player asks again", async () => {
    serve(Infinity, 8);
    const stream = piecewise(body(FILE.slice(0, 4)), "https://example.test/a", 0, 15, new AbortController().signal, 4);
    await expect(readAll(stream)).rejects.toThrow(/403 part-way/);
  });
});
