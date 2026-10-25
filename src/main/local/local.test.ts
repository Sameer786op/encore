import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db";
import { makeWav } from "../testing/wav";
import { LocalLibrary, localId } from "./local";

describe("LocalLibrary", () => {
  let root: string;
  let music: string;
  let db: DatabaseSync;
  let local: LocalLibrary;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "encore-local-"));
    music = join(root, "Music");
    mkdirSync(join(music, "Daft Punk", "Discovery"), { recursive: true });
    writeFileSync(join(music, "Daft Punk", "Discovery", "01 One More Time.wav"), makeWav({ title: "One More Time", artist: "Daft Punk", album: "Discovery" }, 2));
    writeFileSync(join(music, "Daft Punk", "Discovery", "cover.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    writeFileSync(join(music, "untagged.wav"), makeWav({}, 1));
    writeFileSync(join(music, "old.wma"), "not really a wma");
    writeFileSync(join(music, "notes.txt"), "ignore me");
    db = openDatabase(":memory:");
    local = new LocalLibrary(db, join(root, "artwork"));
  });

  afterEach(() => {
    local.dispose();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("reads tags, length and folder cover art", async () => {
    await local.addFolder(music);
    const tracks = local.tracks().sort((a, b) => a.title.localeCompare(b.title));
    expect(tracks.map((t) => [t.title, t.artists[0].name, t.album?.title])).toEqual([
      ["One More Time", "Daft Punk", "Discovery"],
      ["untagged", "Unknown artist", undefined],
    ]);
    expect(tracks[0].durationMs).toBeGreaterThan(1900);
    expect(tracks[0].durationMs).toBeLessThan(2100);
    expect(tracks[0].artwork).toMatch(/^encore-media:\/\/art\/[a-f0-9]{40}\.jpg$/);
    expect(tracks[0].id).toBe(`local:${tracks[0].sourceId}`);
    expect(local.getState()).toMatchObject({ scanning: false, tracks: 2, unsupported: 1, folders: [music] });
  });

  it("only serves files it indexed", async () => {
    await local.addFolder(music);
    const path = join(music, "untagged.wav");
    expect(local.pathOf(localId(path))).toBe(path);
    expect(local.pathOf(localId(join(music, "notes.txt")))).toBeNull();
  });

  it("picks up deleted files on the next scan", async () => {
    await local.addFolder(music);
    unlinkSync(join(music, "untagged.wav"));
    await local.rescan();
    expect(local.tracks().map((t) => t.title)).toEqual(["One More Time"]);
  });

  it("ignores a folder inside one it already has, and forgets removed folders", async () => {
    await local.addFolder(music);
    await local.addFolder(join(music, "Daft Punk"));
    expect(local.folders()).toEqual([music]);
    local.removeFolder(music);
    expect(local.tracks()).toEqual([]);
    expect(local.folders()).toEqual([]);
  });

  it("a parent folder replaces the folders inside it", async () => {
    await local.addFolder(join(music, "Daft Punk"));
    await local.addFolder(music);
    expect(local.folders()).toEqual([music]);
    expect(local.tracks()).toHaveLength(2);
  });
});
