import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { AccountService, MatchCandidate, SourceTrack, Track } from "@shared/types";
import { openDatabase } from "../db";
import { Library } from "../library/library";
import { SignedOutError, type AccountAuth, type AccountProvider, type RemoteArtist, type RemoteSong } from "./provider";
import { AccountSync } from "./sync";

function track(n: number): Track {
  return { id: `youtube:v${n}`, source: "youtube", sourceId: `v${n}`, title: `Song ${n}`, artists: [{ name: `Artist ${n}` }], durationMs: 180_000 };
}

/** a song on another service; song 999 doesn't exist on YouTube Music */
function song(n: number): RemoteSong {
  return { title: `Song ${n}`, artists: [`Artist ${n}`], durationMs: 180_000 };
}

interface FakeList {
  id: string;
  name: string;
  liked?: boolean;
  version?: string;
  songs: RemoteSong[];
}

class FakeAccount implements AccountProvider {
  lists: FakeList[] = [];
  artistList: RemoteArtist[] = [];
  signedOut = false;
  songReads: string[] = [];
  playlistReads = 0;
  async whoAmI() {
    if (this.signedOut) throw new SignedOutError("gone");
    return { name: "Sam" };
  }
  async playlists() {
    this.playlistReads++;
    if (this.signedOut) throw new SignedOutError("gone");
    return this.lists.map((l) => ({ remoteId: l.id, name: l.name, liked: l.liked, version: l.version }));
  }
  async songs(p: { remoteId: string }) {
    this.songReads.push(p.remoteId);
    return this.lists.find((l) => l.id === p.remoteId)?.songs ?? [];
  }
  async artists() {
    return this.artistList;
  }
}

class FakeMatcher {
  searches = 0;
  offline = false;
  private cache = new Map<string, MatchCandidate[]>();
  cachedCandidates(source: SourceTrack): MatchCandidate[] | null {
    return this.cache.get(source.title) ?? null;
  }
  async candidates(source: SourceTrack): Promise<MatchCandidate[]> {
    if (this.offline) throw new Error("offline");
    this.searches++;
    const n = Number(source.title.replace("Song ", ""));
    const found = n === 999 ? [] : [{ track: track(n), score: 1 }];
    this.cache.set(source.title, found);
    return found;
  }
}

describe("AccountSync", () => {
  let db: DatabaseSync;
  let library: Library;
  let spotify: FakeAccount;
  let matcher: FakeMatcher;
  let sync: AccountSync;
  let signIn: boolean;
  const followed: string[] = [];

  const auth = (): AccountAuth => ({ signIn: async () => signIn, signOut: async () => undefined });
  const names = () => library.snapshot().playlists.map((p) => p.name).sort();
  const songsOf = (name: string) => library.snapshot().playlists.find((p) => p.name === name)?.items.map((i) => i.track.title);

  beforeEach(() => {
    db = openDatabase(":memory:");
    library = new Library(db);
    spotify = new FakeAccount();
    matcher = new FakeMatcher();
    signIn = true;
    followed.length = 0;
    const idle = new FakeAccount();
    sync = new AccountSync({
      db,
      library,
      matcher,
      providers: { spotify, youtube: idle, apple: idle } as Record<AccountService, AccountProvider>,
      auth: { spotify: auth(), youtube: auth(), apple: auth() },
      follow: async (artists) => {
        followed.push(...artists.map((a) => a.name));
        return artists.map((a) => a.name);
      },
    });
    spotify.lists = [
      { id: "liked", name: "Liked Songs", liked: true, version: "2", songs: [song(1), song(2)] },
      { id: "p1", name: "Road trip", version: "a", songs: [song(3), song(999), song(4)] },
    ];
  });

  afterEach(() => {
    sync.dispose();
    db.close();
  });

  it("does nothing until an account is connected", async () => {
    await sync.sync("spotify");
    expect(library.snapshot().playlists).toEqual([]);
    expect(sync.list().every((a) => !a.connected && a.state === "idle")).toBe(true);
  });

  it("brings every playlist over on connecting, liked songs under their own name", async () => {
    expect(await sync.connect("spotify")).toBe(true);
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
    expect(songsOf("Road trip")).toEqual(["Song 3", "Song 4"]);
    const status = sync.list().find((a) => a.service === "spotify")!;
    expect(status).toMatchObject({ connected: true, name: "Sam", state: "idle" });
    expect(status.playlists.map((p) => [p.name, p.songs, p.missing])).toEqual([
      ["Liked on Spotify", 2, 0],
      ["Road trip", 2, 1],
    ]);
    expect(library.snapshot().playlists.every((p) => p.synced?.service === "spotify")).toBe(true);
  });

  it("never shows a synced playlist as an ordinary one, even for a moment", async () => {
    const unmarked: string[] = [];
    library.onChange((snapshot) => unmarked.push(...snapshot.playlists.filter((p) => !p.synced).map((p) => p.name)));
    await sync.connect("spotify");
    await sync.sync("spotify");
    sync.setPlaylistEnabled("spotify", "p1", false);
    sync.setPlaylistEnabled("spotify", "p1", true);
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
    expect(unmarked).toEqual([]);
  });

  it("stays disconnected when the sign-in window is closed", async () => {
    signIn = false;
    expect(await sync.connect("spotify")).toBe(false);
    expect(sync.list()[0]).toMatchObject({ connected: false, state: "idle" });
  });

  it("shows the code of a sign-in done in the browser, and stops waiting on Cancel", async () => {
    let stop = () => undefined as void;
    const browser: AccountAuth = {
      signIn: (showCode) =>
        new Promise((resolve) => {
          showCode?.({ code: "ABC-DEF-GHIJ", url: "https://www.google.com/device" });
          stop = () => resolve(false);
        }),
      signOut: async () => undefined,
      cancel: () => stop(),
    };
    sync.dispose();
    sync = new AccountSync({ db, library, matcher, providers: { spotify, youtube: spotify, apple: spotify }, auth: { spotify: browser, youtube: auth(), apple: auth() } });
    const connecting = sync.connect("spotify");
    await new Promise((r) => setTimeout(r, 0));
    expect(sync.list()[0]).toMatchObject({ state: "connecting", signIn: { code: "ABC-DEF-GHIJ", url: "https://www.google.com/device" } });
    sync.cancelConnect("spotify");
    expect(await connecting).toBe(false);
    expect(sync.list()[0]).toMatchObject({ connected: false, state: "idle" });
    expect(sync.list()[0].signIn).toBeUndefined();
  });

  it("picks up new songs and new playlists, and only searches for what's new", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    const searched = matcher.searches;
    spotify.lists[1].songs = [song(5), ...spotify.lists[1].songs];
    spotify.lists[1].version = "b";
    spotify.lists.push({ id: "p2", name: "Gym", version: "x", songs: [song(6)] });
    await sync.sync("spotify");
    expect(songsOf("Road trip")).toEqual(["Song 5", "Song 3", "Song 4"]);
    expect(songsOf("Gym")).toEqual(["Song 6"]);
    // song 5 and song 6 are new; the rest (and the one that isn't on YouTube Music) were looked up before
    expect(matcher.searches - searched).toBe(2);
  });

  it("skips reading a playlist whose version hasn't changed", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    spotify.songReads = [];
    await sync.sync("spotify");
    expect(spotify.songReads).toEqual([]);
  });

  it("removes songs and playlists removed on the service", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    spotify.lists[0].songs = [song(2)];
    spotify.lists[0].version = "3";
    spotify.lists.splice(1, 1);
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify"]);
    expect(songsOf("Liked on Spotify")).toEqual(["Song 2"]);
  });

  it("keeps everything when the service answers with no playlists at all", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    spotify.lists = [];
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
  });

  it("switching a playlist off removes its copy and keeps it away", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    sync.setPlaylistEnabled("spotify", "p1", false);
    expect(names()).toEqual(["Liked on Spotify"]);
    spotify.lists[1].version = "b";
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify"]);
    sync.setPlaylistEnabled("spotify", "p1", true);
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
  });

  it("deleting a synced playlist switches its sync off", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    const road = library.snapshot().playlists.find((p) => p.name === "Road trip")!;
    library.deletePlaylist(road.id);
    spotify.lists[1].version = "b";
    await sync.sync("spotify");
    expect(names()).toEqual(["Liked on Spotify"]);
    expect(sync.list()[0].playlists.find((p) => p.remoteId === "p1")?.enabled).toBe(false);
  });

  it("refuses edits to a synced playlist", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    const road = library.snapshot().playlists.find((p) => p.name === "Road trip")!;
    expect(() => library.addToPlaylist(road.id, [track(7)])).toThrow(/comes from Spotify/);
    expect(() => library.renamePlaylist(road.id, "Mine")).toThrow(/comes from Spotify/);
    expect(() => library.removeFromPlaylist(road.id, road.items[0].itemId)).toThrow(/comes from Spotify/);
  });

  it("disconnecting removes the playlists, or keeps them as ordinary ones", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    await sync.disconnect("spotify", true);
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
    expect(library.snapshot().playlists.every((p) => !p.synced)).toBe(true);
    const road = library.snapshot().playlists.find((p) => p.name === "Road trip")!;
    library.addToPlaylist(road.id, [track(7)]);

    await sync.connect("spotify");
    await sync.sync("spotify");
    await sync.disconnect("spotify", false);
    // the two kept from before stay; the two synced again go
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
    expect(sync.list()[0]).toMatchObject({ connected: false, playlists: [] });
  });

  it("says when the sign-in has ended, keeps the playlists, and stops syncing on its own", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    spotify.signedOut = true;
    await sync.sync("spotify");
    expect(sync.list()[0]).toMatchObject({ state: "signed-out", connected: true });
    expect(sync.list()[0].error).toMatch(/sign-in has ended/);
    expect(names()).toEqual(["Liked on Spotify", "Road trip"]);
    // the timer leaves it alone; Sync now still tries, and clears the message once it works
    spotify.signedOut = false;
    const reads = spotify.playlistReads;
    sync.syncAll();
    await new Promise((r) => setTimeout(r, 20));
    expect(spotify.playlistReads).toBe(reads);
    await sync.sync("spotify");
    expect(spotify.playlistReads).toBe(reads + 1);
    expect(sync.list()[0]).toMatchObject({ state: "idle" });
  });

  it("changes nothing when YouTube Music can't be reached to find songs", async () => {
    await sync.connect("spotify");
    await sync.sync("spotify");
    matcher.offline = true;
    spotify.lists[1].songs = [song(8), ...spotify.lists[1].songs];
    spotify.lists[1].version = "b";
    await sync.sync("spotify");
    expect(songsOf("Road trip")).toEqual(["Song 3", "Song 4"]);
    expect(sync.list()[0]).toMatchObject({ state: "error" });
    matcher.offline = false;
    await sync.sync("spotify");
    expect(songsOf("Road trip")).toEqual(["Song 8", "Song 3", "Song 4"]);
    expect(sync.list()[0]).toMatchObject({ state: "idle" });
  });

  it("follows the account's artists once, so unfollowing here sticks", async () => {
    spotify.artistList = [{ name: "Arijit Singh" }, { name: "Anuv Jain" }];
    await sync.connect("spotify");
    await sync.sync("spotify");
    expect(followed).toEqual(["Arijit Singh", "Anuv Jain"]);
    spotify.artistList.push({ name: "Prateek Kuhad" });
    spotify.lists[0].version = "9";
    await sync.sync("spotify");
    expect(followed).toEqual(["Arijit Singh", "Anuv Jain", "Prateek Kuhad"]);
  });

  it("keeps the date a song was added and its place when the order changes", async () => {
    spotify.lists[1].songs = [{ ...song(3), addedAt: "2025-05-01T00:00:00.000Z" }, song(4)];
    await sync.connect("spotify");
    await sync.sync("spotify");
    const before = library.snapshot().playlists.find((p) => p.name === "Road trip")!.items;
    spotify.lists[1].songs = [song(4), song(3)];
    spotify.lists[1].version = "b";
    await sync.sync("spotify");
    const after = library.snapshot().playlists.find((p) => p.name === "Road trip")!.items;
    expect(after.map((i) => i.track.title)).toEqual(["Song 4", "Song 3"]);
    expect(after.find((i) => i.track.title === "Song 3")).toMatchObject({ itemId: before[0].itemId, addedAt: "2025-05-01T00:00:00.000Z" });
  });
});
