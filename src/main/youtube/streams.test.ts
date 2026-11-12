import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ getYouTube: () => Promise.reject(new Error("offline in tests")), resetYouTube: () => undefined }));

const { explainProblem, pickAudioFormat } = await import("./streams");

describe("explainProblem", () => {
  it("puts YouTube's refusals into plain words", () => {
    expect(explainProblem("LOGIN_REQUIRED: This video is private", false)).toBe("it's private on YouTube");
    expect(explainProblem("UNPLAYABLE: This video is not available", true)).toBe("it isn't available on YouTube any more");
    expect(explainProblem("VISIONOS: This video is unavailable", true)).toBe("it isn't available on YouTube any more");
    expect(explainProblem("Asking YouTube (IOS) about the song took more than 10 s", true)).toBe("YouTube didn't answer in time");
  });

  it("tells someone without a connected account how an age-restricted song could play", () => {
    expect(explainProblem("LOGIN_REQUIRED: Sign in to confirm your age", false)).toMatch(/age-restricted; connect your YouTube Music account/);
    expect(explainProblem("LOGIN_REQUIRED: Sign in to confirm your age", true)).toBe("it's age-restricted on YouTube");
  });

  it("has nothing to add for an unknown failure", () => {
    expect(explainProblem("VISIONOS: no usable audio", true)).toBeNull();
  });
});

const format = (itag: number, mime: string, kbps: number, rate: number, extra: object = {}) => ({
  itag,
  mime_type: mime,
  bitrate: kbps * 1000,
  audio_sample_rate: rate,
  has_audio: true,
  has_video: false,
  ...extra,
});

describe("pickAudioFormat", () => {
  it("takes the best audio on offer: Opus 251 over AAC 140 and the low formats", () => {
    // what YouTube offered for "Tum Hi Ho" in October 2026
    const formats = [
      format(139, 'audio/mp4; codecs="mp4a.40.5"', 50, 22050),
      format(140, 'audio/mp4; codecs="mp4a.40.2"', 131, 44100),
      format(249, 'audio/webm; codecs="opus"', 69, 48000),
      format(250, 'audio/webm; codecs="opus"', 88, 48000),
      format(251, 'audio/webm; codecs="opus"', 164, 48000),
    ];
    expect(pickAudioFormat(formats)?.itag).toBe(251);
  });

  it("skips video, dynamic-range-compressed copies and formats without a type", () => {
    const formats = [
      format(18, 'video/mp4; codecs="avc1, mp4a"', 500, 44100, { has_video: true }),
      format(251, 'audio/webm; codecs="opus"', 170, 48000, { is_drc: true }),
      format(999, "", 300, 48000, { mime_type: undefined }),
      format(140, 'audio/mp4; codecs="mp4a.40.2"', 131, 44100),
    ];
    expect(pickAudioFormat(formats)?.itag).toBe(140);
  });
});
