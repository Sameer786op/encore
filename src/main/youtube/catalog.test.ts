import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ getYouTube: () => Promise.reject(new Error("offline in tests")) }));

const { homeRank, homeSections, playlistByline } = await import("./catalog");
const { mapTrack } = await import("./mappers");

const song = (id: string) => ({ item_type: "song", id, title: `Song ${id}`, artists: [{ name: "Someone" }] });
const album = (id: string) => ({ item_type: "album", id, title: `Album ${id}` });
const playlist = (id: string) => ({ item_type: "playlist", id, title: `Playlist ${id}`, subtitle: "YouTube Music" });
const shelf = (title: string, contents: object[]) => ({ type: "MusicCarouselShelf", header: { title }, contents });

describe("homeRank", () => {
  it("puts what's new and popular first", () => {
    expect(homeRank("Quick picks")).toBe(0);
    expect(homeRank("New releases")).toBe(1);
    expect(homeRank("New albums & singles")).toBe(1);
    expect(homeRank("Trending")).toBe(2);
    expect(homeRank("Today's biggest hits")).toBe(3);
    expect(homeRank("New music videos")).toBe(4);
    expect(homeRank("Mixed for you")).toBe(5);
  });
});

describe("homeSections", () => {
  it("orders shelves newest and most popular first, keeping the rest in place", () => {
    const sections = homeSections([
      shelf("Mixed for you", [song("a")]),
      shelf("Trending", [song("b")]),
      shelf("Long drive", [song("c")]),
      shelf("Quick picks", [song("d")]),
    ]);
    expect(sections.map((s) => s.title)).toEqual(["Quick picks", "Trending", "Mixed for you", "Long drive"]);
  });

  it("joins the two lists of new releases and shelves that repeat on page two", () => {
    const sections = homeSections([
      shelf("New releases", [album("x"), song("a")]),
      shelf("Quick picks", [song("b")]),
      shelf("Quick picks", [song("b"), song("c")]),
      shelf("New albums & singles", [album("x"), album("y")]),
    ]);
    expect(sections.map((s) => s.title)).toEqual(["Quick picks", "New releases"]);
    expect(sections[0].tracks.map((t) => t.sourceId)).toEqual(["b", "c"]);
    expect(sections[1].albums.map((a) => a.id)).toEqual(["x", "y"]);
    expect(sections[1].tracks).toHaveLength(1);
  });

  it("keeps charts as playlists, without the VL prefix", () => {
    const [charts] = homeSections([shelf("Top charts", [playlist("VLPL123"), playlist("PL456")])]);
    expect(charts.playlists).toEqual([
      { id: "PL123", title: "Playlist VLPL123", subtitle: "YouTube Music", artwork: undefined },
      { id: "PL456", title: "Playlist PL456", subtitle: "YouTube Music", artwork: undefined },
    ]);
  });

  it("leaves out community playlists, empty shelves and anything that isn't a carousel", () => {
    const sections = homeSections([
      shelf("From the community", [playlist("PL1")]),
      shelf("Nothing here", []),
      { type: "MusicTastebuilderShelf", header: { title: "Moods" }, contents: [song("a")] },
      shelf("", [song("b")]),
    ]);
    expect(sections).toEqual([]);
  });
});

describe("playlistByline", () => {
  it("keeps who made it and drops what the page already shows", () => {
    expect(playlistByline("Playlist • 2026 • 100 songs • 5 hours, 27 minutes")).toBeUndefined();
    expect(playlistByline("Playlist • YouTube Music • 2026 • 50 songs • 2 hr 10 min")).toBe("YouTube Music");
    expect(playlistByline("Chart • 1.2M views")).toBe("Chart");
  });
});

describe("mapTrack", () => {
  const column = (value: string, browseId?: string) => ({ title: { text: value, runs: [{ text: value, endpoint: browseId ? { payload: { browseId } } : undefined }] } });

  it("finds the artist in the second column of uploads that aren't marked as music", () => {
    const track = mapTrack({ item_type: "non_music_track", id: "abc", title: "Guzaara", flex_columns: [column("Guzaara"), column("Josh Brar", "UCjosh"), column("Aug 18, 2025")] });
    expect(track?.artists).toEqual([{ id: "UCjosh", name: "Josh Brar" }]);
  });

  it("reads the length from the last column when it isn't given otherwise", () => {
    const row = (length: string) => mapTrack({ id: "abc", title: "Song", fixed_columns: [{ title: { text: length } }] })?.durationMs;
    expect(row("3:16")).toBe(196_000);
    expect(row("1:02:45")).toBe(3_765_000);
    expect(row("Live")).toBe(0);
    expect(mapTrack({ id: "abc", title: "Song", duration: { seconds: 200 }, fixed_columns: [{ title: { text: "3:16" } }] })?.durationMs).toBe(200_000);
  });

  it("doesn't take a play count for an artist, and prefers the artists it was given", () => {
    expect(mapTrack({ id: "abc", title: "Song", flex_columns: [column("Song"), column("1.2M plays")] })?.artists).toEqual([]);
    expect(mapTrack({ id: "abc", title: "Song", flex_columns: [column("Song"), column("Someone else")] }, { artists: [{ name: "The band" }] })?.artists).toEqual([{ name: "The band" }]);
  });
});
