import { describe, expect, it } from "vitest";
import { AppleProvider } from "./apple";
import type { ApiAuth, Fetch } from "./http";
import { AccountRefusedError, SignedOutError } from "./provider";
import { SpotifyProvider } from "./spotify";

/** answers by URL; a function can answer differently each time */
function fakeFetch(routes: Record<string, unknown | ((headers: Record<string, string>) => unknown)>): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push(url);
    const route = routes[url];
    const value = typeof route === "function" ? (route as (h: Record<string, string>) => unknown)(init.headers) : route;
    if (value === undefined) return new Response("{}", { status: 404 });
    if (typeof value === "number") return new Response("{}", { status: value });
    return new Response(JSON.stringify(value), { status: 200 });
  }) as Fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

function tokens(): ApiAuth & { fresh: number } {
  const auth = {
    fresh: 0,
    async headers(fresh?: boolean) {
      if (fresh) auth.fresh++;
      return { authorization: `Bearer t${auth.fresh}` };
    },
  };
  return auth;
}

const API = "https://api.spotify.com/v1";
const spotifyTrack = (n: number) => ({ type: "track", name: `Song ${n}`, uri: `spotify:track:${n}`, duration_ms: 200_000, artists: [{ name: `Artist ${n}` }], album: { name: `Album ${n}` } });

describe("SpotifyProvider", () => {
  const noEmbed = async () => ({ name: "", tracks: [] });

  it("lists liked songs first, then every playlist across pages", async () => {
    const fetch = fakeFetch({
      [`${API}/me/tracks?limit=1`]: { total: 12, items: [{ added_at: "2026-10-01T00:00:00Z", track: spotifyTrack(1) }] },
      [`${API}/me/playlists?limit=50`]: { items: [{ id: "a", name: "One", snapshot_id: "s1" }], next: `${API}/me/playlists?offset=50&limit=50` },
      [`${API}/me/playlists?offset=50&limit=50`]: { items: [{ id: "b", name: "Two", snapshot_id: "s2" }], next: null },
    });
    const lists = await new SpotifyProvider(tokens(), noEmbed, fetch).playlists();
    expect(lists).toEqual([
      { remoteId: "liked", name: "Liked Songs", liked: true, version: "12:2026-10-01T00:00:00Z" },
      { remoteId: "a", name: "One", version: "s1" },
      { remoteId: "b", name: "Two", version: "s2" },
    ]);
  });

  it("reads songs from the 2026 items endpoint, skipping podcasts", async () => {
    const fetch = fakeFetch({
      [`${API}/playlists/a/items?limit=100`]: {
        items: [{ added_at: "2026-01-02T00:00:00Z", item: spotifyTrack(1) }, { item: { type: "episode", name: "A podcast" } }, { item: null }],
        next: null,
      },
    });
    const songs = await new SpotifyProvider(tokens(), noEmbed, fetch).songs({ remoteId: "a", name: "One" });
    expect(songs).toEqual([{ title: "Song 1", artists: ["Artist 1"], album: "Album 1", durationMs: 200_000, externalId: "spotify:track:1", addedAt: "2026-01-02T00:00:00Z" }]);
  });

  it("falls back to the older tracks endpoint", async () => {
    const fetch = fakeFetch({ [`${API}/playlists/a/tracks?limit=100`]: { items: [{ track: spotifyTrack(2) }], next: null } });
    const songs = await new SpotifyProvider(tokens(), noEmbed, fetch).songs({ remoteId: "a", name: "One" });
    expect(songs.map((s) => s.title)).toEqual(["Song 2"]);
  });

  it("reads a followed playlist it isn't allowed to list from the embed page", async () => {
    const fetch = fakeFetch({ [`${API}/playlists/x/items?limit=100`]: 403, [`${API}/playlists/x/tracks?limit=100`]: 403 });
    const embed = async (id: string) => ({ name: id, tracks: [{ title: "From embed", artists: ["Someone"] }] });
    const songs = await new SpotifyProvider(tokens(), embed, fetch).songs({ remoteId: "x", name: "Theirs" });
    expect(songs.map((s) => s.title)).toEqual(["From embed"]);
  });

  it("gets a fresh token once when one runs out, then gives up as signed out", async () => {
    const auth = tokens();
    const fetch = fakeFetch({ [`${API}/me`]: (h: Record<string, string>) => (h.authorization === "Bearer t1" ? { id: "sam", display_name: "Sam" } : 401) });
    expect(await new SpotifyProvider(auth, noEmbed, fetch).whoAmI()).toEqual({ name: "Sam" });
    expect(auth.fresh).toBe(1);

    const refused = fakeFetch({ [`${API}/me`]: 401 });
    await expect(new SpotifyProvider(tokens(), noEmbed, refused).whoAmI()).rejects.toBeInstanceOf(SignedOutError);
  });

  it("says why when Spotify turns the account away", async () => {
    const answer = (message: string) => (async () => new Response(JSON.stringify({ error: { status: 403, message } }), { status: 403 })) as unknown as Fetch;
    const notListed = new SpotifyProvider(tokens(), noEmbed, answer("Check settings on developer.spotify.com/dashboard, the user may not be registered."));
    await expect(notListed.whoAmI()).rejects.toThrow(/added by email in its Spotify developer dashboard/);
    await expect(notListed.whoAmI()).rejects.toBeInstanceOf(AccountRefusedError);
    const noPremium = new SpotifyProvider(tokens(), noEmbed, answer("Active premium subscription required for the owner of the app."));
    await expect(noPremium.whoAmI()).rejects.toThrow(/owner needs Spotify Premium/);
  });

  it("lists followed artists across cursor pages", async () => {
    const fetch = fakeFetch({
      [`${API}/me/following?type=artist&limit=50`]: { artists: { items: [{ name: "A" }], next: `${API}/me/following?type=artist&after=x&limit=50` } },
      [`${API}/me/following?type=artist&after=x&limit=50`]: { artists: { items: [{ name: "B" }], next: null } },
    });
    expect(await new SpotifyProvider(tokens(), noEmbed, fetch).artists()).toEqual([{ name: "A" }, { name: "B" }]);
  });
});

const AMP = "https://amp-api.music.apple.com";

describe("AppleProvider", () => {
  it("lists library playlists across pages, with their last change as the version", async () => {
    const fetch = fakeFetch({
      [`${AMP}/v1/me/library/playlists?limit=100`]: { data: [{ id: "p.1", attributes: { name: "Chill", lastModifiedDate: "2026-09-01" } }], next: "/v1/me/library/playlists?offset=100" },
      [`${AMP}/v1/me/library/playlists?offset=100&limit=100`]: { data: [{ id: "p.2", attributes: { name: "Favourite Songs" } }] },
    });
    expect(await new AppleProvider(tokens(), fetch).playlists()).toEqual([
      { remoteId: "p.1", name: "Chill", version: "2026-09-01" },
      { remoteId: "p.2", name: "Favourite Songs", version: undefined },
    ]);
  });

  it("reads a playlist's songs; an empty one answers 404", async () => {
    const fetch = fakeFetch({
      [`${AMP}/v1/me/library/playlists/p.1/tracks?limit=100`]: {
        data: [{ type: "library-songs", attributes: { name: "Song 1", artistName: "Artist 1", albumName: "Album 1", durationInMillis: 1000, playParams: { catalogId: "42" } } }],
      },
    });
    const apple = new AppleProvider(tokens(), fetch);
    expect(await apple.songs({ remoteId: "p.1", name: "Chill" })).toEqual([{ title: "Song 1", artists: ["Artist 1"], album: "Album 1", durationMs: 1000, externalId: "apple:42" }]);
    expect(await apple.songs({ remoteId: "p.2", name: "Empty" })).toEqual([]);
  });

  it("is signed out when the storefront can't be read", async () => {
    await expect(new AppleProvider(tokens(), fakeFetch({ [`${AMP}/v1/me/storefront`]: 403 })).whoAmI()).rejects.toBeInstanceOf(SignedOutError);
    expect(await new AppleProvider(tokens(), fakeFetch({ [`${AMP}/v1/me/storefront`]: { data: [{ id: "in" }] } })).whoAmI()).toEqual({});
  });
});
