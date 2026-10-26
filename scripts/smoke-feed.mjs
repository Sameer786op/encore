// End-to-end test of Phase 4: the home feed and daily mixes built from
// imported history, following an artist and a new-release alert, and
// scrobbling to stand-ins for Last.fm and ListenBrainz running on this
// computer (nothing is sent to the real services).
// Run `npm run build` first. Uses a throwaway profile.
// Usage: npm run smoke:feed   (SMOKE_SHOTS=<folder> saves screenshots)
import { _electron as electron } from "playwright-core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { crc32 } from "node:zlib";

const shots = process.env.SMOKE_SHOTS;
const work = mkdtempSync(join(tmpdir(), "encore-smoke-feed-"));
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

/** a quiet WAV with title and artist tags, long enough to count as a listen */
function makeWav(tags, seconds, rate = 4000) {
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

// a few weeks of listening: lots of The Weeknd and Dua Lipa lately, some
// Daft Punk and Tame Impala, and Coldplay a long time ago
const stamp = (daysAgo, minute = 0) => new Date(Date.now() - daysAgo * 86_400_000 + minute * 60_000).toISOString().slice(0, 16).replace("T", " ");
const plays = [];
const add = (artistName, trackName, days, msPlayed = 210_000) => days.forEach((d, i) => plays.push({ endTime: stamp(d, i), artistName, trackName, msPlayed }));
add("The Weeknd", "Blinding Lights", [1, 2, 3, 5, 8, 12, 20]);
add("The Weeknd", "Save Your Tears", [2, 4, 9, 15]);
add("Dua Lipa", "Levitating", [1, 3, 6, 10, 18]);
add("Dua Lipa", "Don't Start Now", [4, 11, 25]);
add("Daft Punk", "One More Time", [6, 14, 22, 40]);
add("Daft Punk", "Get Lucky", [7, 30, 50]);
add("Tame Impala", "The Less I Know The Better", [5, 16, 35]);
add("Coldplay", "Yellow", [150, 160, 170, 180, 190]);
plays.sort((a, b) => a.endTime.localeCompare(b.endTime));

const exportZip = join(work, "my_spotify_data.zip");
writeFileSync(exportZip, makeZip({ "Spotify Account Data/StreamingHistory_music_0.json": JSON.stringify(plays) }));

const musicDir = join(work, "My Music");
mkdirSync(musicDir, { recursive: true });
writeFileSync(join(musicDir, "01 Long Song.wav"), makeWav({ title: "Scrobble Test Song", artist: "Encore Test Band", album: "Smoke Sessions" }, 64));

// ---- stand-ins for the two scrobbling services ----

const received = [];
let sessionAsks = 0;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname.startsWith("/lb/")) {
      received.push({ service: "listenbrainz", path: url.pathname, json: body ? JSON.parse(body) : null, auth: req.headers.authorization });
      if (url.pathname === "/lb/1/validate-token") {
        return send(200, req.headers.authorization === "Token smoke-token" ? { valid: true, user_name: "smoke-listener" } : { valid: false, message: "Invalid authorization token." });
      }
      return send(200, { status: "ok" });
    }
    if (url.pathname === "/fm/") {
      const params = Object.fromEntries(new URLSearchParams(req.method === "POST" ? body : url.search));
      received.push({ service: "lastfm", method: params.method, params });
      if (params.method === "auth.getToken") return send(200, { token: "smoke-lastfm-token" });
      if (params.method === "auth.getSession") {
        // the first ask comes before you've approved in the browser
        if (sessionAsks++ < 1) return send(403, { error: 14, message: "Unauthorized Token - This token has not been authorized" });
        return send(200, { session: { name: "smoke-fm-user", key: "smoke-session", subscriber: 0 } });
      }
      return send(200, { ok: true });
    }
    send(404, {});
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- helpers ----

let app;
let win;
const shot = async (name) => shots && (await win.screenshot({ path: join(shots, `${name}.png`) }));
const goTo = async (label) => {
  await win.locator("aside button", { hasText: label }).first().click();
  await win.waitForTimeout(700);
};

async function waitFor(fn, timeoutMs, everyMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await win.waitForTimeout(everyMs);
  }
  return null;
}

try {
  const target = process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: ["."], cwd: process.cwd() };
  app = await electron.launch({
    ...target,
    env: {
      ...process.env,
      ENCORE_USER_DATA: profile,
      ENCORE_LISTENBRAINZ_URL: `${base}/lb`,
      ENCORE_LASTFM_URL: `${base}/fm/`,
      ENCORE_LASTFM_AUTH_URL: `${base}/auth/`,
    },
  });
  win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await win.waitForSelector("h1");
  await app.evaluate(({ dialog, shell, Notification }, music) => {
    // answer the folder picker, and keep links and notifications inside the test
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [music] });
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
    globalThis.shown = [];
    Notification.prototype.show = function () {
      globalThis.shown.push(this);
    };
  }, musicDir);

  // 1. with no history yet, the home page says where mixes will come from
  const empty = await waitFor(() => win.evaluate(() => window.encore.feed.get()), 30000, 1000);
  check("a new profile gets an empty feed", empty && empty.hasHistory === false && empty.mixes.length === 0, JSON.stringify(empty && { hasHistory: empty.hasHistory }));
  // a brand-new profile still gets the welcome banner
  await goTo("Settings");
  await goTo("Home");
  await win.waitForTimeout(1500);
  await shot("p4-00-home-before-history");

  // 2. importing listening history builds the feed
  const summary = await win.evaluate((path) => window.encore.imports.analyzeExport(path), exportZip);
  await win.evaluate((token) => window.encore.imports.applyExport(token, { history: true, collections: [] }), summary.token);
  const built = Date.now();
  const feed = await waitFor(async () => {
    const f = await win.evaluate(() => window.encore.feed.get());
    const status = await win.evaluate(() => window.encore.feed.status());
    return f?.hasHistory && f.mixes.length > 0 && !status.building ? f : null;
  }, 300000, 3000);
  check(
    "imported history turns into daily mixes",
    !!feed && feed.mixes.length >= 2 && feed.mixes.every((m) => m.tracks.length >= 8),
    feed ? `${feed.mixes.length} mixes in ${Math.round((Date.now() - built) / 1000)}s: ${feed.mixes.map((m) => `${m.description} (${m.tracks.length})`).join("; ")}` : "no feed",
  );
  if (!feed) throw new Error("the feed never finished building");
  const top = feed.topArtists.map((a) => a.name);
  check("top artists follow what was played most", /weeknd/i.test(top[0] ?? "") && top.some((n) => /dua lipa/i.test(n)), top.slice(0, 5).join(", "));
  check("songs played again and again are on repeat", feed.onRepeat.some((t) => /blinding lights/i.test(t.title)), feed.onRepeat.map((t) => t.title).slice(0, 4).join(", "));
  check("old favourites come back", feed.rediscover.some((t) => /yellow/i.test(t.title)), feed.rediscover.map((t) => t.title).join(", "));
  const firstMix = feed.mixes[0];
  const repeats = firstMix.tracks.filter((t, i) => i > 0 && t.artists[0]?.name === firstMix.tracks[i - 1].artists[0]?.name).length;
  check("a mix mixes favourites with new songs and avoids back-to-back artists", new Set(firstMix.tracks.map((t) => t.id)).size === firstMix.tracks.length && repeats <= 3, `${repeats} back-to-back`);

  // 3. the home page shows it
  await goTo("Home");
  await win.waitForSelector("text=Made for you", { timeout: 20000 });
  await win.waitForTimeout(2500);
  await shot("p4-01-home");
  const home = await win.locator("main").innerText();
  check("the home page shows mixes, on repeat and top artists", /Daily Mix 1/.test(home) && /On repeat/.test(home) && /Your top artists/.test(home), "");

  // 4. a mix page plays
  await win.locator("main").getByText("Daily Mix 1", { exact: true }).first().click();
  await win.waitForSelector('[role="row"]', { timeout: 15000 });
  await win.waitForTimeout(1800);
  await shot("p4-02-mix");
  const rows = await win.locator('[role="row"]').count();
  check("a mix opens as a list of songs", rows === firstMix.tracks.length, `${rows} songs`);
  await win.locator("main").getByRole("button", { name: "Play Daily Mix 1" }).click();
  const playing = await waitFor(() => win.evaluate(() => (document.querySelector('footer button[aria-label="Pause"]') ? navigator.mediaSession.metadata?.title : null)), 30000, 1000);
  check("the mix starts playing", !!playing, playing ?? "nothing");
  await win.evaluate(() => {
    document.querySelector('footer button[aria-label="Pause"]')?.click();
  });

  // 5. follow an artist; a release that appears later sends a notification
  const artist = feed.topArtists[0];
  await goTo("Home");
  await win.locator("section", { hasText: "Your top artists" }).getByText(artist.name, { exact: true }).first().click();
  await win.getByRole("button", { name: "Follow", exact: true }).waitFor({ timeout: 20000 });
  await win.waitForTimeout(1200);
  await shot("p4-03-artist");
  const related = await win.locator("main").getByText("Fans also like").count();
  check("an artist page shows who fans also like", related === 1, "");
  await win.getByRole("button", { name: "Follow", exact: true }).click();
  await win.getByRole("button", { name: "Following" }).waitFor({ timeout: 5000 });
  check("following an artist sticks", await win.evaluate((id) => window.encore.feed.isFollowing(id), artist.id), artist.name);
  // following looks at what's out right now; that becomes the baseline, no alert
  await win.waitForTimeout(6000);
  const db = new DatabaseSync(join(profile, "library.db"));
  const baseline = db.prepare("SELECT release_id, data FROM releases_seen WHERE artist_id = ? ORDER BY rowid LIMIT 1").get(artist.id);
  const quietSoFar = await app.evaluate(() => globalThis.shown.length);
  check("what's already out doesn't send alerts", !!baseline && quietSoFar === 0, baseline ? JSON.parse(baseline.data).album.title : "nothing seen");
  // pretend we never saw their newest release, then look again
  db.prepare("DELETE FROM releases_seen WHERE release_id = ?").run(baseline.release_id);
  db.close();
  await win.getByRole("button", { name: "Following" }).click();
  await win.getByRole("button", { name: "Follow", exact: true }).click();
  const alert = await waitFor(() => app.evaluate(() => globalThis.shown[0] && { title: globalThis.shown[0].title, body: globalThis.shown[0].body }), 30000, 1000);
  check("a new release sends a desktop notification", !!alert && alert.title.includes(artist.name), alert ? `${alert.title}: ${alert.body}` : "none");
  await app.evaluate(() => globalThis.shown[0]?.emit("click"));
  await win.waitForTimeout(2500);
  const albumTitle = await win.locator("main h1").first().innerText();
  check("clicking the notification opens the release", !!alert && alert.body.startsWith(albumTitle), albumTitle);
  const afterAlert = await win.evaluate(() => window.encore.feed.get());
  check("the new release is on the home page marked new", afterAlert.newReleases[0]?.isNew === true, afterAlert.newReleases[0]?.album.title ?? "none");
  await goTo("Home");
  await win.locator("main").getByText("New releases for you").scrollIntoViewIfNeeded();
  await win.waitForTimeout(1500);
  await shot("p4-05-home-releases");

  // 6. scrobbling: connect both services in Settings
  await goTo("Settings");
  await win.getByText("Scrobbling", { exact: true }).scrollIntoViewIfNeeded();
  await win.waitForTimeout(500);
  await shot("p4-04a-scrobbling-setup");
  await win.getByLabel("ListenBrainz user token").fill("wrong-token");
  await win.locator("main").getByRole("button", { name: "Connect", exact: true }).first().click();
  await win.waitForSelector("text=ListenBrainz: Invalid authorization token.", { timeout: 10000 });
  check("a wrong ListenBrainz token is turned down", true);
  await win.getByLabel("ListenBrainz user token").fill("smoke-token");
  await win.locator("main").getByRole("button", { name: "Connect", exact: true }).first().click();
  await win.waitForSelector("text=smoke-listener", { timeout: 10000 });
  await win.getByLabel("Last.fm API key").fill("smoke-api-key");
  await win.getByLabel("Last.fm shared secret").fill("smoke-secret");
  await win.locator("main").getByRole("button", { name: "Connect", exact: true }).last().click();
  await win.waitForSelector("text=Waiting for approval", { timeout: 10000 });
  const opened = await app.evaluate(() => globalThis.opened);
  check("Last.fm approval opens in the browser", opened.some((u) => u === `${base}/auth/?api_key=smoke-api-key&token=smoke-lastfm-token`), opened.join(", "));
  await win.waitForSelector("text=smoke-fm-user", { timeout: 20000 });
  await win.getByText("Scrobbling", { exact: true }).scrollIntoViewIfNeeded();
  await win.waitForTimeout(500);
  await shot("p4-04-scrobbling");
  check("both services connect", (await win.locator("main").innerText()).includes("smoke-listener"), "");

  // 7. a song heard past the halfway mark is scrobbled to both
  await goTo("Local files");
  await win.getByRole("button", { name: "Choose a folder" }).click();
  await win.waitForSelector('[role="row"]', { timeout: 30000 });
  await win.locator('[role="row"]').first().dblclick();
  const nowPlaying = await waitFor(() => received.some((r) => r.method === "track.updateNowPlaying") && received.some((r) => r.json?.listen_type === "playing_now"), 15000, 1000);
  check("both services hear what's playing now", !!nowPlaying, "");
  const early = received.filter((r) => r.method === "track.scrobble" || r.json?.listen_type === "single").length;
  await win.waitForTimeout(36000);
  const fm = received.find((r) => r.method === "track.scrobble");
  const lb = received.find((r) => r.json?.listen_type === "single");
  check("nothing is scrobbled before half the song", early === 0, `${early} early`);
  check("Last.fm gets the scrobble", fm?.params["track[0]"] === "Scrobble Test Song" && fm?.params["artist[0]"] === "Encore Test Band" && fm?.params.sk === "smoke-session", JSON.stringify(fm?.params ?? {}).slice(0, 160));
  check(
    "ListenBrainz gets the listen",
    lb?.auth === "Token smoke-token" && lb?.json.payload[0].track_metadata.track_name === "Scrobble Test Song",
    JSON.stringify(lb?.json?.payload?.[0]?.track_metadata ?? {}).slice(0, 160),
  );
  const status = await win.evaluate(() => window.encore.scrobble.status());
  check("nothing is left waiting in the queue", status.queued === 0, `${status.queued} queued`);
  check("no uncaught errors in the window", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  console.error(error);
  results.push({ name: "script finished", ok: false });
  if (shots && win) await win.screenshot({ path: join(shots, "p4-failure.png") }).catch(() => undefined);
} finally {
  if (app) await app.close().catch(() => undefined);
  server.close();
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
