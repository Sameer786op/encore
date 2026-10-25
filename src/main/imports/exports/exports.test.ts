import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeZip } from "../../testing/zip";
import { readExport, UnrecognizedExportError } from "./analyze";
import { csvObjects, parseCsv } from "./csv";
import { parseTakeoutDate, videoIdsFromCsv } from "./takeout";

const dir = mkdtempSync(join(tmpdir(), "encore-exports-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function write(name: string, content: string | Buffer): string {
  const path = join(dir, `${n++}-${name}`);
  writeFileSync(path, content);
  return path;
}

describe("csv", () => {
  it("handles quotes, commas, newlines and a byte order mark", () => {
    const rows = parseCsv('﻿Track Name,Artist Name(s)\r\n"Hello, World","A ""quoted"" artist"\n"Two\nlines",B\n');
    expect(rows).toEqual([
      ["Track Name", "Artist Name(s)"],
      ["Hello, World", 'A "quoted" artist'],
      ["Two\nlines", "B"],
    ]);
    expect(csvObjects(rows)[0]).toEqual({ "track name": "Hello, World", "artist name(s)": 'A "quoted" artist' });
  });
});

describe("Spotify export", () => {
  const library = {
    tracks: [
      { artist: "Daft Punk", album: "Discovery", track: "One More Time", uri: "spotify:track:0DiWol3AO6WpXZgp0goxAV" },
      { artist: "Tame Impala", album: "Currents", track: "The Less I Know The Better", uri: "spotify:track:6K4t31amVTZDgR3sKmwUJJ" },
    ],
    albums: [],
    shows: [],
  };
  const playlists = {
    playlists: [
      {
        name: "Road Trip",
        lastModifiedDate: "2025-06-01",
        items: [
          { track: { trackName: "Mr. Brightside", artistName: "The Killers", albumName: "Hot Fuss", trackUri: "spotify:track:003vvx7Niy0yvhvHt4a68B" }, episode: null },
          { track: null, episode: { episodeName: "A podcast" } },
        ],
      },
      { name: "Empty", items: [] },
    ],
  };
  const basic = [
    { endTime: "2025-01-03 18:22", artistName: "Daft Punk", trackName: "One More Time", msPlayed: 320000 },
    { endTime: "2025-01-03 18:23", artistName: "Daft Punk", trackName: "Aerodynamic", msPlayed: 4000 },
  ];

  it("reads history, liked songs and playlists from the account data zip", async () => {
    const zip = write(
      "my_spotify_data.zip",
      makeZip({
        "Spotify Account Data/StreamingHistory_music_0.json": JSON.stringify(basic),
        "Spotify Account Data/YourLibrary.json": JSON.stringify(library),
        "Spotify Account Data/Playlist1.json": JSON.stringify(playlists),
        "Spotify Account Data/Read Me First.pdf": "not read",
      }),
    );
    const parsed = await readExport(zip);
    expect(parsed.origin).toBe("spotify");
    // the 4-second skip is not a listen
    expect(parsed.plays).toEqual([
      { playedAt: new Date(Date.parse("2025-01-03T18:22:00Z") - 320000).toISOString(), playedMs: 320000, playCount: 1, title: "One More Time", artist: "Daft Punk" },
    ]);
    const liked = parsed.collections.find((c) => c.destination.kind === "liked");
    expect(liked?.tracks.map((t) => t.title)).toEqual(["One More Time", "The Less I Know The Better"]);
    const roadTrip = parsed.collections.find((c) => c.name === "Road Trip");
    expect(roadTrip?.tracks).toEqual([{ title: "Mr. Brightside", artists: ["The Killers"], album: "Hot Fuss", externalId: "spotify:track:003vvx7Niy0yvhvHt4a68B" }]);
    expect(parsed.collections.some((c) => c.name === "Empty")).toBe(false);
  });

  it("prefers the extended history and skips podcasts", async () => {
    const extended = [
      {
        ts: "2021-05-01T10:05:00Z",
        ms_played: 200000,
        master_metadata_track_name: "Yellow",
        master_metadata_album_artist_name: "Coldplay",
        master_metadata_album_album_name: "Parachutes",
        spotify_track_uri: "spotify:track:3AJwUDP919kvQ9QcozQPxg",
        ip_addr: "192.0.2.1",
      },
      { ts: "2021-05-01T11:00:00Z", ms_played: 900000, master_metadata_track_name: null, episode_name: "Some podcast" },
    ];
    const zip = write(
      "my_spotify_data.zip",
      makeZip({
        "Spotify Extended Streaming History/Streaming_History_Audio_2021_0.json": JSON.stringify(extended),
        "Spotify Account Data/StreamingHistory_music_0.json": JSON.stringify(basic),
      }),
    );
    const parsed = await readExport(zip);
    expect(parsed.plays).toHaveLength(1);
    expect(parsed.plays[0]).toMatchObject({ title: "Yellow", artist: "Coldplay", album: "Parachutes", playedMs: 200000, playedAt: "2021-05-01T10:01:40.000Z" });
    // nothing sensitive is carried over
    expect(JSON.stringify(parsed)).not.toContain("192.0.2.1");
  });
});

describe("Google Takeout", () => {
  const history = [
    {
      header: "YouTube Music",
      title: "Watched Blinding Lights",
      titleUrl: "https://music.youtube.com/watch?v=J7p4bzqLvCw",
      subtitles: [{ name: "The Weeknd - Topic", url: "https://www.youtube.com/channel/UC0WP5P-ufpRfjbNrmOWwLBQ" }],
      time: "2025-10-01T16:30:00.000Z",
      products: ["YouTube"],
    },
    { header: "YouTube", title: "Watched How to fix a bike", titleUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", time: "2025-10-01T17:00:00.000Z" },
    { header: "YouTube Music", title: "Watched a video that has been removed", time: "2025-10-01T18:00:00.000Z" },
  ];

  it("keeps only YouTube Music plays from the JSON history", async () => {
    const zip = write("takeout.zip", makeZip({ "Takeout/YouTube and YouTube Music/history/watch-history.json": JSON.stringify(history) }));
    const parsed = await readExport(zip);
    expect(parsed.origin).toBe("youtube");
    expect(parsed.hasListeningTime).toBe(false);
    expect(parsed.plays).toEqual([{ playedAt: "2025-10-01T16:30:00.000Z", playedMs: 0, playCount: 1, title: "Blinding Lights", artist: "The Weeknd", videoId: "J7p4bzqLvCw" }]);
    expect(parsed.warnings.join(" ")).toContain("1 YouTube Music history entries");
  });

  it("reads the HTML history Takeout makes by default", async () => {
    const cell = (header: string, inner: string) =>
      `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">${header}<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${inner}</div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div></div></div>`;
    const html = `<html><body><div class="mdl-grid">${cell(
      "YouTube Music",
      'Watched&nbsp;<a href="https://music.youtube.com/watch?v=fJ9rUzIMcZQ">Bohemian Rhapsody</a><br><a href="https://www.youtube.com/channel/UCiMhD4jzUqG-IgPzUmmytRQ">Queen - Topic</a><br>Oct 1, 2025, 10:00:00 PM IST<br>',
    )}${cell("YouTube", 'Watched&nbsp;<a href="https://www.youtube.com/watch?v=bbbbbbbbbbb">Cooking video</a><br>Oct 1, 2025, 9:00:00 PM IST<br>')}</div></body></html>`;
    const zip = write("takeout.zip", makeZip({ "Takeout/YouTube and YouTube Music/history/watch-history.html": html }));
    const parsed = await readExport(zip);
    expect(parsed.plays).toHaveLength(1);
    expect(parsed.plays[0]).toMatchObject({ title: "Bohemian Rhapsody", artist: "Queen", videoId: "fJ9rUzIMcZQ" });
    expect(new Date(parsed.plays[0].playedAt).getTime()).toBe(new Date(2025, 9, 1, 22, 0, 0).getTime());
  });

  it("parses Takeout dates with time zone abbreviations", () => {
    expect(parseTakeoutDate("Jan 2, 2024, 7:05:09 AM PST")).toBe(new Date(2024, 0, 2, 7, 5, 9).getTime());
    expect(parseTakeoutDate("Jan 2, 2024, 7:05:09 AM GMT+05:30")).toBe(new Date(2024, 0, 2, 7, 5, 9).getTime());
  });

  it("reads playlist files in the new and the old layout", async () => {
    expect(videoIdsFromCsv("Video ID,Playlist Video Creation Timestamp\nJ7p4bzqLvCw,2024-01-01T00:00:00+00:00\nfJ9rUzIMcZQ,2024-01-02T00:00:00+00:00\n")).toEqual(["J7p4bzqLvCw", "fJ9rUzIMcZQ"]);
    expect(videoIdsFromCsv("Playlist Id,Channel Id,Title\nPLxxxx,UCxxxx,Gym\n\nVideo Id,Time Added\nJ7p4bzqLvCw,2024-01-01 00:00:00 UTC\n")).toEqual(["J7p4bzqLvCw"]);

    const zip = write(
      "takeout.zip",
      makeZip({
        "Takeout/YouTube and YouTube Music/playlists/playlists.csv": "Playlist ID,Playlist Title (Original)\nPLx,Gym\n",
        "Takeout/YouTube and YouTube Music/playlists/Gym-videos.csv": "Video ID,Playlist Video Creation Timestamp\nJ7p4bzqLvCw,2024\n",
        "Takeout/YouTube and YouTube Music/playlists/Liked music-videos.csv": "Video ID,Playlist Video Creation Timestamp\nfJ9rUzIMcZQ,2024\n",
      }),
    );
    const parsed = await readExport(zip);
    expect(parsed.collections.map((c) => [c.name, c.destination.kind, c.tracks.map((t) => t.videoId)])).toEqual([
      ["Gym", "playlist", ["J7p4bzqLvCw"]],
      ["Liked music", "liked", ["fJ9rUzIMcZQ"]],
    ]);
  });
});

describe("Apple Music export", () => {
  const daily = [
    "Country,Track Identifier,Media type,Date Played,Hours,Play Duration Milliseconds,Source Type,Play Count,Skip Count,Track Description",
    "US,1499378617,AUDIO,20240131,20,401500,ORIGINATING_DEVICE,2,0,The Weeknd - Blinding Lights",
    "US,1,AUDIO,20240131,21,9000,ORIGINATING_DEVICE,1,1,Someone - A skip",
    'US,2,AUDIO,20240201,9,250000,ORIGINATING_DEVICE,1,0,"Simon & Garfunkel - The Sound of Silence - Acoustic"',
  ].join("\n");
  const libraryTracks = [
    { Title: "Blinding Lights", Artist: "The Weeknd", Album: "After Hours", "Track Duration": 200040, "Track Identifier": 111, "Track Like Rating": "LOVE" },
    { Title: "Halo", Artist: "Beyoncé", Album: "I Am... Sasha Fierce", "Track Duration": 261640, "Track Identifier": 222 },
  ];
  const libraryPlaylists = [{ Title: "Late night", "Playlist Item Identifiers": [222, 111, 999] }];

  it("reads zips inside zips, daily history, loved songs and playlists", async () => {
    const inner = makeZip({
      "Apple Media Services/Apple Music Activity/Apple Music - Play History Daily Tracks.csv": daily,
      "Apple Media Services/Apple Music Activity/Apple Music Library Tracks.json.zip": makeZip({ "Apple Music Library Tracks.json": JSON.stringify(libraryTracks) }),
      "Apple Media Services/Apple Music Activity/Apple Music Library Playlists.json.zip": makeZip({ "Apple Music Library Playlists.json": JSON.stringify(libraryPlaylists) }),
    });
    const zip = write("apple.zip", makeZip({ "Apple_Media_Services.zip": inner }));
    const parsed = await readExport(zip);
    expect(parsed.origin).toBe("apple");
    expect(parsed.plays).toEqual([
      { playedAt: "2024-01-31T12:00:00.000Z", playedMs: 401500, playCount: 2, title: "Blinding Lights", artist: "The Weeknd", externalId: "1499378617" },
      { playedAt: "2024-02-01T12:00:00.000Z", playedMs: 250000, playCount: 1, title: "The Sound of Silence - Acoustic", artist: "Simon & Garfunkel", externalId: "2" },
    ]);
    expect(parsed.collections.map((c) => [c.name, c.destination.kind, c.tracks.map((t) => t.title)])).toEqual([
      ["Loved songs", "liked", ["Blinding Lights"]],
      ["Apple Music library", "playlist", ["Blinding Lights", "Halo"]],
      ["Late night", "playlist", ["Halo", "Blinding Lights"]],
    ]);
  });

  it("fills in missing artists in play activity from the library", async () => {
    const activity = [
      "Album Name,Song Name,Event Start Timestamp,Event Type,Play Duration Milliseconds,Media Duration In Milliseconds",
      "After Hours,Blinding Lights,2023-03-01T20:00:00.000Z,PLAY_END,200000,200040",
      "Unknown Album,Mystery Song,2023-03-01T21:00:00.000Z,PLAY_END,100000,100000",
      "After Hours,Blinding Lights,2023-03-01T22:00:00.000Z,PLAY_START,0,200040",
    ].join("\n");
    const folder = join(dir, "apple-folder");
    mkdirSync(join(folder, "Apple Music Activity"), { recursive: true });
    writeFileSync(join(folder, "Apple Music Activity", "Apple Music Play Activity.csv"), activity);
    writeFileSync(join(folder, "Apple Music Activity", "Apple Music Library Tracks.json"), JSON.stringify(libraryTracks));
    const parsed = await readExport(folder);
    expect(parsed.plays.map((p) => [p.title, p.artist])).toEqual([
      ["Blinding Lights", "The Weeknd"],
      ["Mystery Song", "Unknown artist"],
    ]);
    expect(parsed.warnings.join(" ")).toContain("Unknown artist");
  });
});

describe("playlist CSVs", () => {
  it("reads an Exportify file", async () => {
    const csv = [
      '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album Name","Track Duration (ms)"',
      '"spotify:track:1","Levitating (feat. DaBaby)","spotify:artist:a,spotify:artist:b","Dua Lipa,DaBaby","Future Nostalgia","203064"',
    ].join("\n");
    const parsed = await readExport(write("Workout.csv", csv));
    expect(parsed.origin).toBe("spotify");
    expect(parsed.collections[0].name).toMatch(/Workout$/);
    expect(parsed.collections[0].tracks[0]).toEqual({ title: "Levitating (feat. DaBaby)", artists: ["Dua Lipa", "DaBaby"], album: "Future Nostalgia", durationMs: 203064, externalId: "spotify:track:1" });
  });

  it("splits a TuneMyMusic file by playlist name", async () => {
    const csv = ["Track name,Artist name,Album,Playlist name,Type", "Halo,Beyoncé,I Am,Liked Songs,Favorite", "Yellow,Coldplay,Parachutes,Chill,Playlist"].join("\n");
    const parsed = await readExport(write("tunemymusic.csv", csv));
    expect(parsed.origin).toBe("csv");
    expect(parsed.collections.map((c) => [c.name, c.destination.kind])).toEqual([
      ["Liked Songs", "liked"],
      ["Chill", "playlist"],
    ]);
  });

  it("says so when a file isn't an export it knows", async () => {
    await expect(readExport(write("notes.csv", "a,b\n1,2\n"))).rejects.toBeInstanceOf(UnrecognizedExportError);
    await expect(readExport(write("random.zip", makeZip({ "photo.json": "{}" })))).rejects.toBeInstanceOf(UnrecognizedExportError);
  });
});
