import { describe, expect, it } from "vitest";
import { appleFromPage, parseLink, spotifyFromEmbed } from "./links";

describe("parseLink", () => {
  it("understands Spotify links and URIs", () => {
    expect(parseLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc")).toEqual({ service: "spotify", kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M" });
    expect(parseLink("open.spotify.com/intl-de/album/4yP0hdKOZPNshxUOjY0cZj")).toEqual({ service: "spotify", kind: "album", id: "4yP0hdKOZPNshxUOjY0cZj" });
    expect(parseLink("spotify:track:0DiWol3AO6WpXZgp0goxAV")).toEqual({ service: "spotify", kind: "track", id: "0DiWol3AO6WpXZgp0goxAV" });
    expect(parseLink("https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi")).toBeNull();
  });

  it("understands Apple Music links", () => {
    expect(parseLink("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb")).toMatchObject({ service: "apple", kind: "playlist" });
    expect(parseLink("https://music.apple.com/in/album/after-hours/1499378108?i=1499378617")).toMatchObject({ service: "apple", kind: "album", songId: "1499378617" });
  });

  it("understands YouTube and YouTube Music links", () => {
    expect(parseLink("https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i")).toEqual({ service: "youtube", kind: "playlist", id: "PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i" });
    expect(parseLink("https://www.youtube.com/watch?v=J7p4bzqLvCw&list=PLabc")).toEqual({ service: "youtube", kind: "playlist", id: "PLabc" });
    expect(parseLink("https://www.youtube.com/watch?v=J7p4bzqLvCw&list=RDJ7p4bzqLvCw")).toEqual({ service: "youtube", kind: "video", id: "J7p4bzqLvCw" });
    expect(parseLink("https://music.youtube.com/browse/MPREb_4U7yfKKFZLv")).toEqual({ service: "youtube", kind: "album", id: "MPREb_4U7yfKKFZLv" });
    expect(parseLink("https://youtu.be/J7p4bzqLvCw")).toEqual({ service: "youtube", kind: "video", id: "J7p4bzqLvCw" });
  });

  it("rejects everything else", () => {
    expect(parseLink("hello")).toBeNull();
    expect(parseLink("https://soundcloud.com/someone/sets/mix")).toBeNull();
    expect(parseLink("https://example.com/playlist?list=PL1")).toBeNull();
  });
});

describe("page readers", () => {
  it("reads a Spotify embed page and warns at the 100-song limit", () => {
    const entity = {
      name: "Big playlist",
      trackList: Array.from({ length: 100 }, (_, i) => ({ title: `Song ${i}`, subtitle: "Daft Punk, Pharrell Williams", duration: 200000, uri: `spotify:track:${i}` })),
    };
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></html>`;
    const contents = spotifyFromEmbed(html, "playlist");
    expect(contents.name).toBe("Big playlist");
    expect(contents.tracks[0]).toEqual({ title: "Song 0", artists: ["Daft Punk", "Pharrell Williams"], album: undefined, durationMs: 200000, externalId: "spotify:track:0" });
    expect(contents.note).toContain("first 100 songs");
  });

  it("reads an Apple Music page and notices a cut-off list", () => {
    const sections = [
      { itemKind: "containerDetailHeaderLockup", items: [{ title: "Today's Hits" }] },
      {
        itemKind: "trackLockup",
        items: [{ title: "Housewife", artistName: "Tate McRae", duration: 208810, tertiaryLinks: [{ title: "Housewife - Single" }], contentDescriptor: { identifiers: { storeAdamID: "1" } } }],
      },
      { itemKind: "containerDetailTracklistFooterLockup", items: [{ description: "1,250 songs, 70 hours" }] },
    ];
    const html = `<script type="application/json" id="serialized-server-data">${JSON.stringify({ data: [{ intent: {}, data: { sections } }] })}</script>`;
    const contents = appleFromPage(html, "playlist");
    expect(contents.tracks).toEqual([{ title: "Housewife", artists: ["Tate McRae"], album: "Housewife - Single", durationMs: 208810, externalId: "1" }]);
    expect(contents.note).toContain("1 of 1250");
  });
});
