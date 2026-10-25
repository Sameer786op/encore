import { describe, expect, it } from "vitest";
import type { Innertube } from "youtubei.js";
import { SignedOutError } from "./provider";
import { badgeMs, splitArtists, YouTubeProvider } from "./youtube";

// Pages shaped like the answers YouTube's TV app gets (made up, trimmed to what's read).

const say = (text: string) => ({ simpleText: text });
const lines = (...texts: string[]) => texts.map((t) => ({ lineRenderer: { items: [{ lineItemRenderer: { text: say(t) } }] } }));
const badge = (text: string) => ({ thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: say(text) } }] });

function video(id: string, title: string, byline: string, details: string, length: string) {
  return {
    tileRenderer: {
      contentId: id,
      contentType: "TILE_CONTENT_TYPE_VIDEO",
      header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/default.jpg` }, { url: `https://i.ytimg.com/vi/${id}/hq720.jpg` }] }, ...badge(length) } },
      metadata: { tileMetadataRenderer: { title: say(title), lines: lines(byline, details) } },
      onSelectCommand: { watchEndpoint: { videoId: id } },
    },
  };
}

function playlistTile(id: string, title: string, count: string, ...small: string[]) {
  return {
    tileRenderer: {
      contentId: id,
      contentType: "TILE_CONTENT_TYPE_PLAYLIST",
      header: { tileHeaderRenderer: badge(count) },
      metadata: { tileMetadataRenderer: { title: say(title), lines: lines(...small) } },
    },
  };
}

const channel = (id: string, name: string) => ({ tileRenderer: { contentId: id, contentType: "TILE_CONTENT_TYPE_CHANNEL", metadata: { tileMetadataRenderer: { title: say(name) } } } });
const next = (token?: string) => (token ? { continuations: [{ nextContinuationData: { continuation: token } }] } : {});
const page = (tiles: unknown[], token?: string) => ({ contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items: tiles, ...next(token) } } } } } } });
const more = (tiles: unknown[], token?: string) => ({ continuationContents: { playlistVideoListContinuation: { contents: tiles, ...next(token) } } });

/** answers by browse id ("cont:<token>" for later pages); anything else fails like YouTube does */
function fakeYouTube(pages: Record<string, unknown>, fail?: Error) {
  const calls: string[] = [];
  const yt = {
    actions: {
      execute: async (endpoint: string, args: Record<string, unknown>) => {
        const key = endpoint === "/browse" ? String(args.browseId ?? `cont:${args.continuation}`) : endpoint;
        calls.push(key);
        if (args.client !== "TV") throw new Error("Request failed with status code 400");
        if (fail) throw fail;
        if (pages[key] === undefined) throw new Error("Request failed with status code 400");
        return { success: true, status_code: 200, data: pages[key] };
      },
    },
  };
  return { client: async () => yt as unknown as Innertube, calls };
}

const HOUR = 60 * 60_000;

describe("YouTubeProvider (read like the TV app)", () => {
  const liked = page([video("kesariya000", "Kesariya", "Arijit Singh", "Song • 1M views", "4:28"), video("shapeofyou0", "Shape of You", "Ed Sheeran", "Song • 2M views", "3:54")]);
  const lists = page([
    playlistTile("LL", "Liked videos", "5,000 videos", "Private"),
    playlistTile("WL", "Watch later", "117 videos", "Private"),
    playlistTile("YS", "Saved Shorts", "2 videos", "Private"),
    playlistTile("SS", "Sounds", "6 videos", "Private"),
    playlistTile("RDabc", "Mix - Something", "Mix", "Lots of artists"),
    playlistTile("PLmine", "Road trip", "3 videos", "Private", "Updated today"),
    playlistTile("PLsaved", "Phonk 2024", "50 videos", "Someone"),
  ]);

  it("lists Liked Music first, then the playlists, leaving out YouTube's own lists and saved mixes", async () => {
    const { client } = fakeYouTube({ VLLM: liked, FEplaylist_aggregation: lists });
    const found = await new YouTubeProvider(client, () => 10 * HOUR).playlists();
    expect(found.map((p) => [p.remoteId, p.name, !!p.liked])).toEqual([
      ["LM", "Liked Music", true],
      ["PLmine", "Road trip", false],
      ["PLsaved", "Phonk 2024", false],
    ]);
    // a new like at the top, a song added, or a few hours passing all count as a change
    expect(found[0].version).toBe("kesariya000,shapeofyou0|3");
    expect(found[1].version).toBe("3 videos|Private|Updated today|3");
  });

  it("stops when a page hands back the same playlists again", async () => {
    const { client, calls } = fakeYouTube({ VLLM: liked, FEplaylist_aggregation: page([playlistTile("PLmine", "Road trip", "3 videos")], "again"), "cont:again": more([playlistTile("PLmine", "Road trip", "3 videos")], "again") });
    const found = await new YouTubeProvider(client).playlists();
    expect(found.map((p) => p.remoteId)).toEqual(["LM", "PLmine"]);
    expect(calls.filter((c) => c === "cont:again")).toHaveLength(1);
  });

  it("reads every page of a playlist as songs ready to play", async () => {
    const { client } = fakeYouTube({
      VLPLmine: page(
        [
          video("kesariya000", "Kesariya", "Arijit Singh - Topic", "Song • 1M views", "4:28"),
          video("montagem000", "MONTAGEM LADRAO (Sped Up)", "ATLXS, MXZI, & Itamar Mc", "Song • 66M views", "1:26"),
          playlistTile("PLother", "Not a song", "4 videos"),
        ],
        "p2",
      ),
      "cont:p2": more([video("lecture1000", "Lecture 1 - How to Start a Startup", "Y Combinator", "1M views • 10y ago", "1:02:03")]),
    });
    const songs = await new YouTubeProvider(client).songs({ remoteId: "PLmine", name: "Road trip" });
    expect(songs.map((s) => [s.title, s.artists, s.durationMs, s.videoId])).toEqual([
      ["Kesariya", ["Arijit Singh"], 268_000, "kesariya000"],
      ["MONTAGEM LADRAO (Sped Up)", ["ATLXS", "MXZI", "Itamar Mc"], 86_000, "montagem000"],
      // outside Liked Music a dash in the title isn't taken to name the artist
      ["Lecture 1 - How to Start a Startup", ["Y Combinator"], 3_723_000, "lecture1000"],
    ]);
    expect(songs[0].track).toEqual({
      id: "youtube:kesariya000",
      source: "youtube",
      sourceId: "kesariya000",
      title: "Kesariya",
      artists: [{ name: "Arijit Singh" }],
      durationMs: 268_000,
      artwork: "https://i.ytimg.com/vi/kesariya000/hq720.jpg",
    });
  });

  it('in Liked Music, takes an upload called "Artist - Title" to name its artist', async () => {
    const { client } = fakeYouTube({ VLLM: page([video("megalomania", "KMFDM - Megalomaniac", "UnrealCinema", "5.4M views • 17y ago", "6:08")]) });
    const songs = await new YouTubeProvider(client).songs({ remoteId: "LM", name: "Liked Music", liked: true });
    expect(songs.map((s) => [s.title, s.artists])).toEqual([["Megalomaniac", ["KMFDM"]]]);
  });

  it("doesn't read Liked Music's first page twice in one sync", async () => {
    const { client, calls } = fakeYouTube({ VLLM: liked, FEplaylist_aggregation: lists });
    const youtube = new YouTubeProvider(client);
    const [likedList] = await youtube.playlists();
    expect((await youtube.songs(likedList)).map((s) => s.title)).toEqual(["Kesariya", "Shape of You"]);
    expect(calls.filter((c) => c === "VLLM")).toHaveLength(1);
  });

  it("follows only subscribed channels whose songs are in Liked Music", async () => {
    const { client } = fakeYouTube({ VLLM: liked, FEplaylist_aggregation: lists, FEchannels: page([channel("UC1", "Arijit Singh - Topic"), channel("UC2", "Study With Me"), channel("UC3", "Ed Sheeran")]) });
    const youtube = new YouTubeProvider(client);
    const [likedList] = await youtube.playlists();
    await youtube.songs(likedList);
    expect(await youtube.artists()).toEqual([{ name: "Arijit Singh" }, { name: "Ed Sheeran" }]);
  });

  it("doesn't take artists from other playlists, which can hold anything", async () => {
    const { client } = fakeYouTube({ VLPLcourse: page([video("trading0000", "Candlesticks Course", "Trade with Purab", "1M views", "50:00")]), FEchannels: page([channel("UC4", "Trade with Purab")]) });
    const youtube = new YouTubeProvider(client);
    await youtube.songs({ remoteId: "PLcourse", name: "Learning trading" });
    expect(await youtube.artists()).toEqual([]);
  });

  it("says who is signed in", async () => {
    const accounts = { contents: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [{ accountItem: { accountName: say("Sam"), isSelected: true } }] } }] } }] };
    const { client } = fakeYouTube({ "/account/accounts_list": accounts });
    expect(await new YouTubeProvider(client).whoAmI()).toEqual({ name: "Sam" });
  });

  it("is signed out once Google no longer takes the sign-in", async () => {
    const { client } = fakeYouTube({}, new Error("Failed to refresh access token: 400"));
    await expect(new YouTubeProvider(client).playlists()).rejects.toBeInstanceOf(SignedOutError);
    await expect(new YouTubeProvider(client).whoAmI()).rejects.toBeInstanceOf(SignedOutError);
  });

  it("reads lengths and lists of artists", () => {
    expect([badgeMs("3:05"), badgeMs("1:02:03"), badgeMs("LIVE"), badgeMs("")]).toEqual([185_000, 3_723_000, 0, 0]);
    expect(splitArtists("A, B, & C")).toEqual(["A", "B", "C"]);
    expect(splitArtists("RJ Pasin & Marcin")).toEqual(["RJ Pasin", "Marcin"]);
  });
});
