import { describe, expect, it, vi } from "vitest";

// what a Premium account gets for each song, and how its fetch is going
const audios: Record<string, { failed: boolean; spent: boolean }> = {};

vi.mock("./premium", () => ({
  resolvePremium: async (videoId: string) => ({
    audio: (audios[videoId] ??= { failed: false, spent: false }),
    mimeType: "audio/webm",
    contentLength: 100,
    expiresAt: Date.now() + 3_600_000,
    codec: "opus",
    bitrate: 261_000,
    sampleRate: 48_000,
  }),
}));

vi.mock("./client", () => ({
  getYouTube: async () => ({
    session: { player: {} },
    getBasicInfo: async () => ({
      playability_status: { status: "OK" },
      streaming_data: {
        expires: new Date(Date.now() + 3_600_000),
        adaptive_formats: [
          { itag: 251, mime_type: 'audio/webm; codecs="opus"', bitrate: 133_000, audio_sample_rate: 48_000, content_length: 50, has_audio: true, has_video: false, decipher: async () => "https://example.test/251" },
        ],
      },
    }),
  }),
  resetYouTube: () => undefined,
}));

vi.stubGlobal("fetch", async () => new Response(null, { status: 206 }));

const { resolveAudio } = await import("./streams");

describe("resolveAudio with a Premium account", () => {
  it("takes the Premium audio", async () => {
    const stream = await resolveAudio("premium0001");
    expect(stream.premium).toBe(audios.premium0001);
    expect(stream.bitrate).toBe(261_000);
  });

  it("plays a song the usual way once its Premium audio broke off, and keeps doing so", async () => {
    await resolveAudio("premium0002");
    audios.premium0002.failed = audios.premium0002.spent = true;
    const again = await resolveAudio("premium0002");
    expect(again.premium).toBeUndefined();
    expect(again.url).toBe("https://example.test/251");
    expect((await resolveAudio("premium0002", { fresh: true })).premium).toBeUndefined();
  });

  it("plays a song the usual way when the player asks afresh after it failed", async () => {
    await resolveAudio("premium0003");
    const retry = await resolveAudio("premium0003", { fresh: true });
    expect(retry.premium).toBeUndefined();
    expect(retry.bitrate).toBe(133_000);
  });

  it("fetches Premium audio again after its memory was given back", async () => {
    const first = await resolveAudio("premium0004");
    audios.premium0004.spent = true;
    delete audios.premium0004;
    const again = await resolveAudio("premium0004");
    expect(again.premium).toBeDefined();
    expect(again.premium).not.toBe(first.premium);
  });
});
