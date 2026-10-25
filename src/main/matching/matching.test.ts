import { describe, expect, it } from "vitest";
import type { SourceTrack, Track } from "@shared/types";
import { classify, rankCandidates, scoreCandidate, searchQueries } from "./score";
import { cleanArtistName, coreTitle, fold, songKey, splitArtists, stripFeatures, versionTags } from "./text";

let n = 0;
function yt(title: string, artists: string[], seconds: number): Track {
  n++;
  return { id: `youtube:vid${n}`, source: "youtube", sourceId: `vid${n}`, title, artists: artists.map((name) => ({ name })), durationMs: seconds * 1000 };
}
const src = (title: string, artists: string[], seconds?: number): SourceTrack => ({ title, artists, durationMs: seconds ? seconds * 1000 : undefined });

describe("text helpers", () => {
  it("folds accents, case and punctuation", () => {
    expect(fold("Beyoncé — HALO!")).toBe("beyonce halo");
    expect(fold("Don’t Stop Me Now")).toBe("dont stop me now");
    expect(fold("Rock & Roll")).toBe("rock and roll");
  });

  it("keeps non-Latin scripts", () => {
    expect(fold("केसरिया")).toBe("केसरिया".normalize("NFKD").replace(/\p{M}+/gu, ""));
    expect(fold("夜に駆ける")).toBe("夜に駆ける".normalize("NFKD").replace(/\p{M}+/gu, ""));
  });

  it("strips featured artists", () => {
    expect(stripFeatures("Stay (with Justin Bieber)")).toBe("Stay");
    expect(stripFeatures("Levitating (feat. DaBaby)")).toBe("Levitating");
    expect(stripFeatures("Sicko Mode ft. Drake")).toBe("Sicko Mode");
  });

  it("finds the core title", () => {
    expect(coreTitle("Bohemian Rhapsody - Remastered 2011")).toBe("bohemian rhapsody");
    expect(coreTitle("Kesariya (From \"Brahmastra\")")).toBe("kesariya");
  });

  it("spots version tags and ignores neutral ones", () => {
    expect([...versionTags("Yellow (Live in Buenos Aires)")]).toEqual(["live"]);
    expect([...versionTags("Heat Waves (Sped Up)")]).toEqual(["sped up"]);
    expect([...versionTags("Bohemian Rhapsody - Remastered 2011")]).toEqual([]);
  });

  it("cleans YouTube channel names and splits credits", () => {
    expect(cleanArtistName("Arctic Monkeys - Topic")).toBe("Arctic Monkeys");
    expect(cleanArtistName("TaylorSwiftVEVO")).toBe("TaylorSwift");
    expect(splitArtists("Daft Punk, Pharrell Williams & Nile Rodgers")).toEqual(["Daft Punk", "Pharrell Williams", "Nile Rodgers"]);
  });

  it("gives the same key to the same song from different services", () => {
    expect(songKey("The Weeknd", "Save Your Tears")).toBe(songKey("The Weeknd - Topic", "Save Your Tears"));
    expect(songKey("The Kid LAROI, Justin Bieber", "STAY (with Justin Bieber)")).toBe(songKey("The Kid LAROI", "Stay"));
    expect(songKey("Coldplay", "Yellow")).not.toBe(songKey("Coldplay", "Yellow (Live)"));
  });
});

describe("matching", () => {
  it("takes an exact match without asking", () => {
    const source = src("Blinding Lights", ["The Weeknd"], 200);
    const [best] = rankCandidates(source, [yt("Blinding Lights", ["The Weeknd"], 202)]);
    expect(classify(source, best)).toBe("matched");
  });

  it("matches across featured-artist styles", () => {
    const source = src("STAY (with Justin Bieber)", ["The Kid LAROI", "Justin Bieber"], 141);
    const [best] = rankCandidates(source, [yt("Stay", ["The Kid LAROI", "Justin Bieber"], 142)]);
    expect(classify(source, best)).toBe("matched");
  });

  it("prefers the studio version over a live one", () => {
    const source = src("Yellow", ["Coldplay"], 266);
    const live = yt("Yellow (Live in Buenos Aires)", ["Coldplay"], 290);
    const studio = yt("Yellow", ["Coldplay"], 267);
    expect(rankCandidates(source, [live, studio])[0].track).toBe(studio);
  });

  it("prefers the right artist when titles collide", () => {
    const source = src("Hello", ["Adele"], 295);
    const richie = yt("Hello", ["Lionel Richie"], 249);
    const adele = yt("Hello", ["Adele"], 296);
    const ranked = rankCandidates(source, [richie, adele]);
    expect(ranked[0].track).toBe(adele);
    expect(classify(source, { track: richie, score: 0 })).not.toBe("matched");
  });

  it("does not auto-accept a sped up version", () => {
    const source = src("Heat Waves", ["Glass Animals"], 238);
    const [best] = rankCandidates(source, [yt("Heat Waves (Sped Up)", ["Glass Animals"], 190)]);
    expect(classify(source, best)).not.toBe("matched");
  });

  it("asks when the length is far off", () => {
    const source = src("Strobe", ["deadmau5"], 637);
    const radio = yt("Strobe (Radio Edit)", ["deadmau5"], 213);
    expect(classify(source, rankCandidates(source, [radio])[0])).not.toBe("matched");
    const unlabeled = yt("Strobe", ["deadmau5"], 213);
    expect(classify(source, rankCandidates(source, [unlabeled])[0])).not.toBe("matched");
  });

  it("prefers the full version over a radio edit when the length says so", () => {
    const source = src("Strobe", ["deadmau5"], 637);
    const radio = yt("Strobe (Radio Edit)", ["deadmau5"], 213);
    const full = yt("Strobe", ["deadmau5"], 636);
    expect(rankCandidates(source, [radio, full])[0].track).toBe(full);
  });

  it("handles accents and Topic channels", () => {
    const source = src("Crazy In Love (feat. Jay-Z)", ["Beyoncé", "JAY-Z"], 236);
    const [best] = rankCandidates(source, [yt("Crazy In Love (feat. JAY Z)", ["Beyonce - Topic"], 236)]);
    expect(classify(source, best)).toBe("matched");
  });

  it("matches non-English titles", () => {
    const source = src("Kesariya (From \"Brahmastra\")", ["Arijit Singh", "Pritam"], 268);
    const [best] = rankCandidates(source, [yt("Kesariya", ["Pritam", "Arijit Singh", "Amitabh Bhattacharya"], 269)]);
    expect(["matched", "review"]).toContain(classify(source, best));
    expect(best.score).toBeGreaterThan(0.7);
  });

  it("says not found when nothing is close", () => {
    const source = src("Some Obscure Demo", ["Unknown Band"], 200);
    const ranked = rankCandidates(source, [yt("Completely Different", ["Someone Else"], 180)]);
    expect(classify(source, ranked[0])).toBe("missing");
    expect(classify(source, undefined)).toBe("missing");
  });

  it("keeps the requested version when the source asks for it", () => {
    const source = src("Yellow - Live", ["Coldplay"], 290);
    const live = yt("Yellow (Live in Buenos Aires)", ["Coldplay"], 290);
    const studio = yt("Yellow", ["Coldplay"], 267);
    expect(rankCandidates(source, [studio, live])[0].track).toBe(live);
  });

  it("scores stay within 0..1", () => {
    const parts = scoreCandidate(src("A", []), yt("B", [], 0));
    expect(parts.total).toBeGreaterThanOrEqual(0);
    expect(parts.total).toBeLessThanOrEqual(1);
  });

  it("builds a precise query and a looser fallback", () => {
    expect(searchQueries(src("Levitating (feat. DaBaby)", ["Dua Lipa"]))).toEqual(["Levitating Dua Lipa", "Levitating"]);
    expect(searchQueries(src("Untitled", []))).toEqual(["Untitled"]);
  });
});
