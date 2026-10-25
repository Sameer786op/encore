// End-to-end test of Phase 2 against the real services: playlist links,
// a data export, the review screen, "Your listening" and local files.
// Run `npm run build` first. Uses a throwaway profile.
// Usage: npm run smoke:imports   (SMOKE_SHOTS=<folder> saves screenshots)
import { _electron as electron } from "playwright-core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";

const shots = process.env.SMOKE_SHOTS;
const work = mkdtempSync(join(tmpdir(), "encore-smoke-imports-"));
const profile = join(work, "profile");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// ---- fixtures ----

function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const fileName = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    parts.push(local, fileName, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, fileName);
    offset += 30 + fileName.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

function makeWav(tags, seconds = 4, rate = 8000) {
  const data = Buffer.alloc(seconds * rate * 2);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const chunks = Object.entries({ INAM: tags.title, IART: tags.artist, IPRD: tags.album }).map(([id, value]) => {
    let text = Buffer.from(`${value}\0`, "utf8");
    if (text.length % 2) text = Buffer.concat([text, Buffer.from([0])]);
    const head = Buffer.alloc(8);
    head.write(id, 0, "ascii");
    head.writeUInt32LE(text.length, 4);
    return Buffer.concat([head, text]);
  });
  const info = Buffer.concat([Buffer.from("INFO"), ...chunks]);
  const list = Buffer.alloc(8);
  list.write("LIST", 0, "ascii");
  list.writeUInt32LE(info.length, 4);
  const dataHead = Buffer.alloc(8);
  dataHead.write("data", 0, "ascii");
  dataHead.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), fmt, list, info, dataHead, data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

const exportZip = join(work, "my_spotify_data.zip");
writeFileSync(
  exportZip,
  makeZip({
    "Spotify Account Data/StreamingHistory_music_0.json": JSON.stringify([
      { endTime: "2025-03-01 20:00", artistName: "Daft Punk", trackName: "One More Time", msPlayed: 320000 },
      { endTime: "2025-03-01 20:06", artistName: "Daft Punk", trackName: "One More Time", msPlayed: 320000 },
      { endTime: "2025-03-02 09:00", artistName: "Coldplay", trackName: "Yellow", msPlayed: 266000 },
      { endTime: "2025-03-02 09:05", artistName: "Coldplay", trackName: "Fix You", msPlayed: 3000 },
    ]),
    "Spotify Account Data/YourLibrary.json": JSON.stringify({
      tracks: [
        { artist: "Tame Impala", album: "Currents", track: "The Less I Know The Better", uri: "spotify:track:6K4t31amVTZDgR3sKmwUJJ" },
        { artist: "Arctic Monkeys", album: "AM", track: "Do I Wanna Know?", uri: "spotify:track:5FVd6KXrgO9B3JPmC8OPst" },
        { artist: "Glass Animals", album: "Dreamland", track: "Heat Waves", uri: "spotify:track:3USxtqRwSYz57Ewm6wWRMp" },
      ],
    }),
    "Spotify Account Data/Playlist1.json": JSON.stringify({
      playlists: [{ name: "Smoke road trip", items: [{ track: { trackName: "Mr. Brightside", artistName: "The Killers", albumName: "Hot Fuss", trackUri: "spotify:track:003vvx7Niy0yvhvHt4a68B" } }] }],
    }),
  }),
);

const musicDir = join(work, "My Music", "Encore Test Band", "First Album");
mkdirSync(musicDir, { recursive: true });
writeFileSync(join(musicDir, "01 Opening.wav"), makeWav({ title: "Opening Song", artist: "Encore Test Band", album: "First Album" }));
writeFileSync(join(musicDir, "02 Closing.wav"), makeWav({ title: "Closing Song", artist: "Encore Test Band", album: "First Album" }));
const musicRoot = join(work, "My Music");

// ---- helpers ----

let app;
let win;
const shot = async (name) => shots && (await win.screenshot({ path: join(shots, `${name}.png`) }));

async function pasteLink(url) {
  await win.locator("aside button", { hasText: "Import" }).first().click();
  const input = win.locator('input[placeholder^="https://open.spotify.com"]');
  await input.fill(url);
  await win.locator("main form").getByRole("button", { name: "Import", exact: true }).click();
  await win.waitForSelector("text=On YouTube Music", { timeout: 60000 });
}

async function waitForReview(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await win.locator("main").innerText();
    if (!/Matching \d+ of \d+/.test(text)) return text;
    await win.waitForTimeout(1500);
  }
  throw new Error("matching took too long");
}

const counts = () =>
  win.evaluate(() => {
    const read = (label) => Number([...document.querySelectorAll("main button")].find((b) => b.textContent?.trim().startsWith(label))?.textContent?.match(/(\d+)\s*$/)?.[1] ?? 0);
    return { review: read("To check"), found: read("Found"), missing: read("Not found") };
  });

async function finishImport() {
  const finish = win.getByRole("button", { name: /^(Create playlist|Add to Liked Songs)$/ });
  if (await win.getByRole("button", { name: "Accept all suggestions" }).count()) await win.getByRole("button", { name: "Accept all suggestions" }).click();
  await win.waitForTimeout(800);
  await finish.click();
  await win.waitForTimeout(2000);
}

try {
  // SMOKE_EXE=release/win-unpacked/Encore.exe tests the packaged app instead of the dev build
  const target = process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: ["."], cwd: process.cwd() };
  app = await electron.launch({ ...target, env: { ...process.env, ENCORE_USER_DATA: profile } });
  win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await win.waitForSelector("h1");
  // answer the native file pickers without a person clicking
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (_win, options) => ({ canceled: false, filePaths: [options?.properties?.includes("openDirectory") ? paths.music : paths.zip] });
  }, { music: musicRoot, zip: exportZip });

  // 1. a YouTube Music playlist: exact songs, no matching needed
  await pasteLink("https://music.youtube.com/playlist?list=RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs");
  await waitForReview();
  let c = await counts();
  check("a YouTube Music playlist link comes in with every song found", c.found > 20 && c.missing === 0, JSON.stringify(c));
  await finishImport();
  let rows = await win.locator('[role="row"]').count();
  check("finishing it creates the playlist", rows > 20, `${rows} songs`);

  // 2. a Spotify album through the embed page, matched by search
  await pasteLink("https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj");
  await waitForReview();
  c = await counts();
  await shot("p2-01-review-spotify");
  check("a Spotify album link matches most songs", c.found + c.review >= 12, JSON.stringify(c));

  // 3. an Apple Music album
  await pasteLink("https://music.apple.com/us/album/after-hours/1499378108");
  await waitForReview();
  c = await counts();
  check("an Apple Music album link matches most songs", c.found + c.review >= 12, JSON.stringify(c));
  // repeat songs are cached from the Spotify import, so this should be quick
  await finishImport();
  rows = await win.locator('[role="row"]').count();
  check("the Apple album becomes a playlist", rows >= 12, `${rows} songs`);

  // 4. a Spotify data export
  await win.locator("aside button", { hasText: "Import" }).first().click();
  await win.getByRole("button", { name: "Choose file" }).click();
  await win.waitForSelector("text=Here's what's in your export", { timeout: 30000 });
  await win.waitForTimeout(900);
  await shot("p2-02-export-chooser");
  const chooser = await win.locator('[role="dialog"]').innerText();
  check("the export chooser shows history, likes and playlists", /3 plays of 2 songs/.test(chooser) && /Liked Songs/.test(chooser) && /Smoke road trip/.test(chooser), chooser.split("\n").slice(0, 8).join(" | "));
  await win.locator('[role="dialog"]').getByRole("button", { name: "Import", exact: true }).click();
  await win.waitForTimeout(2500);
  const jobs = await win.evaluate(() => window.encore.imports.list());
  const liked = jobs.find((j) => j.destination.kind === "liked");
  check("choosing everything starts matching the liked songs and the playlist", !!liked && jobs.some((j) => j.name === "Smoke road trip"), jobs.map((j) => j.name).join(", "));
  await win.evaluate((id) => window.encore.imports.get(id), liked.id);
  for (let i = 0; i < 60; i++) {
    const job = await win.evaluate((id) => window.encore.imports.get(id), liked.id);
    if (job.status !== "matching") break;
    await win.waitForTimeout(1500);
  }
  await win.evaluate((id) => window.encore.imports.acceptSuggestions(id), liked.id);
  await win.evaluate((id) => window.encore.imports.finish(id), liked.id);
  const library = await win.evaluate(() => window.encore.library.get());
  check("liked songs from the export end up in Liked Songs", library.liked.length >= 2, library.liked.map((l) => l.track.title).join(", "));

  // 5. "Your listening" from the imported history
  await win.locator("aside button", { hasText: "Your listening" }).click();
  await win.waitForSelector("text=Top songs", { timeout: 20000 });
  await win.waitForTimeout(1800);
  await shot("p2-03-listening");
  const insights = await win.evaluate(() => window.encore.history.insights());
  check("imported history shows up in Your listening", insights.totals.plays >= 3 && insights.topSongs[0]?.title === "One More Time", `${insights.totals.plays} plays, top: ${insights.topSongs[0]?.title}`);
  await win.locator("main").getByRole("button", { name: "Play One More Time" }).click();
  await win.waitForTimeout(8000);
  const playingTop = await win.evaluate(() => navigator.mediaSession.metadata?.title);
  check("a top song plays after it is looked up", /one more time/i.test(playingTop ?? ""), playingTop ?? "nothing");

  // 6. local files
  await win.locator("aside button", { hasText: "Local files" }).click();
  await win.getByRole("button", { name: "Choose a folder" }).click();
  await win.waitForSelector('[role="row"]', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await shot("p2-04-local");
  rows = await win.locator('[role="row"]').count();
  check("a music folder is scanned with its tags", rows === 2 && (await win.locator("main").innerText()).includes("Encore Test Band"), `${rows} songs`);
  await win.locator('[role="row"]').first().dblclick();
  await win.waitForTimeout(2500);
  const local = await win.evaluate(() => ({
    title: navigator.mediaSession.metadata?.title,
    playing: !!document.querySelector('footer button[aria-label="Pause"]'),
    position: Number(document.querySelector('footer [role="slider"][aria-label="Seek"]')?.getAttribute("aria-valuenow") ?? 0),
  }));
  check("a local file plays", local.playing && local.title === "Closing Song", JSON.stringify(local));

  await win.locator("aside button", { hasText: "Import" }).first().click();
  await win.waitForTimeout(1500);
  await shot("p2-05-import-page");
  check("no uncaught errors in the window", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  console.error(error);
  results.push({ name: "script finished", ok: false });
  if (shots && win) await win.screenshot({ path: join(shots, "p2-failure.png") }).catch(() => undefined);
} finally {
  if (app) await app.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
