import { describe, expect, it } from "vitest";
import { aboutTheSong, matchesQuery, normalize, offTarget, queryWords } from "./ranking";

describe("normalize", () => {
  it("drops accents, case and punctuation", () => {
    expect(normalize("Àrjit  Singh - (Live)")).toBe("arjit singh live");
    expect(normalize("A$AP Rocky")).toBe("asap rocky");
  });

  it("keeps the vowel signs of Hindi and other scripts", () => {
    expect(normalize("बेखयाली!")).toBe("बेखयाली");
  });
});

describe("queryWords", () => {
  it("leaves out words that don't pick a song", () => {
    expect(queryWords("Tum Hi Ho official video song")).toEqual(["tum", "hi", "ho"]);
    expect(queryWords("the lyrics")).toEqual([]);
  });
});

describe("matchesQuery", () => {
  it("needs both words of a two-word search, in the title or the artists", () => {
    expect(matchesQuery("arijit singh", "Tera Fitoor", ["Arijit Singh"])).toBe(true);
    expect(matchesQuery("o maahi", "O Maahi", ["Arijit Singh"])).toBe(true);
    expect(matchesQuery("o maahi", "Maahi Ve", ["Neha Kakkar"])).toBe(false);
  });

  it("matches words at their start, so half-typed words count", () => {
    expect(matchesQuery("kesar", "Kesariya", ["Arijit Singh"])).toBe(true);
    expect(matchesQuery("tum hi ho", "Tum Hi Ho", ["Arijit Singh"])).toBe(true);
    expect(matchesQuery("tum hi ho", "Tum Hi Who", [])).toBe(false);
  });

  it("lets a long search miss a word", () => {
    expect(matchesQuery("ek tarfa darshan raval live", "Ek Tarfa", ["Darshan Raval"])).toBe(true);
    expect(matchesQuery("ek tarfa darshan raval live", "Ek Din", ["Someone"])).toBe(false);
  });

  it("takes anything when only filler words were typed", () => {
    expect(matchesQuery("official video", "Anything", [])).toBe(true);
  });
});

describe("offTarget", () => {
  it("skips videos about a song", () => {
    expect(offTarget("Blinding Lights | REACTION", "blinding lights")).toBe(true);
    expect(offTarget("Tum Hi Ho - Karaoke - Aashiqui 2", "tum hi ho")).toBe(true);
    expect(offTarget("Blinding Lights (Official Video)", "blinding lights")).toBe(false);
  });

  it("skips edits unless they were asked for", () => {
    expect(offTarget("worry (ultra slowed)", "worry")).toBe(true);
    expect(offTarget("worry (ultra slowed)", "worry slowed")).toBe(false);
    expect(offTarget("Kesariya - Lofi Flip", "kesariya lofi")).toBe(false);
  });

  it("skips countdowns and shorts", () => {
    expect(offTarget("TOP 8 BEST PHONK SONGS OF 2026 #short", "brazilian phonk")).toBe(true);
    expect(offTarget("Top 8 phonk", "top 8 phonk")).toBe(false);
  });

  it("lets songs be edits, since the popular version of a song can be one", () => {
    expect(aboutTheSong("worry (ultra slowed)", "worry")).toBe(false);
    expect(aboutTheSong("Blinding Lights | REACTION", "blinding lights")).toBe(true);
  });

  it("matches whole words, so a title that only contains one isn't skipped", () => {
    expect(offTarget("Statusphere", "statusphere")).toBe(false);
    expect(offTarget("Reactions in Time", "time")).toBe(false);
  });
});
