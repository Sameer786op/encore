// End-to-end smoke test against the real YouTube Music catalog.
// Run `npm run build` first. Uses a throwaway profile, never your real library.
// Usage: npm run smoke        (set SMOKE_EXE to test a packaged Encore.exe)
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const profile = mkdtempSync(join(tmpdir(), "encore-smoke-"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const running = new Set();
let lastWindow = null;

async function launch() {
  // SMOKE_EXE=release/win-unpacked/Encore.exe tests the packaged app instead of the dev build
  const target = process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: ["."], cwd: process.cwd() };
  const app = await electron.launch({ ...target, env: { ...process.env, ENCORE_USER_DATA: profile } });
  running.add(app);
  app.on("close", () => running.delete(app));
  const win = await app.firstWindow();
  lastWindow = win;
  const errors = [];
  win.on("pageerror", (e) => errors.push(e.message));
  win.on("console", (m) => m.type() === "error" && console.log(`  [renderer] ${m.text()}`));
  await win.waitForSelector("footer");
  await win.waitForSelector("h1");
  await win.waitForTimeout(500);
  return { app, win, errors };
}

/** player state as the UI shows it */
const state = (win) =>
  win.evaluate(() => {
    const footer = document.querySelector("footer");
    const seek = footer?.querySelector('[role="slider"][aria-label="Seek"]');
    return {
      playing: !!footer?.querySelector('button[aria-label="Pause"]'),
      title: navigator.mediaSession.metadata?.title ?? "",
      position: Number(seek?.getAttribute("aria-valuenow") ?? 0),
      duration: Number(seek?.getAttribute("aria-valuemax") ?? 0),
    };
  });

const savedQueue = (win) => win.evaluate(() => JSON.parse(localStorage.getItem("encore.player.v1") ?? "{}").queue ?? { items: [], index: -1 });
const rowTitle = (win, n) => win.locator('[role="row"]').nth(n).locator(".truncate").first().innerText();
const toastText = (win) => win.evaluate(() => [...document.querySelectorAll('[aria-live="polite"] span')].map((s) => s.textContent).join(" | "));

async function seekToEnd(win) {
  await win.evaluate(() => {
    const slider = document.querySelector('footer [role="slider"][aria-label="Seek"]');
    slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  });
}

try {
  let { app, win, errors } = await launch();

  // 1. search and play through the UI
  await win.keyboard.press("Control+k");
  await win.waitForFunction(() => document.activeElement?.id === "encore-search");
  await win.keyboard.type("coldplay yellow");
  await win.keyboard.press("Enter");
  await win.waitForSelector('[role="row"]', { timeout: 45000 });
  const rows = await win.locator('[role="row"]').count();
  check("search shows songs", rows >= 5, `${rows} rows`);

  const firstTitle = await rowTitle(win, 0);
  await win.locator('[role="row"]').first().dblclick();
  await win.waitForTimeout(5000);
  let s = await state(win);
  check("double-click plays the song", s.playing && s.position > 0 && s.title === firstTitle, `"${s.title}" at ${s.position}s`);
  check("Windows media controls know the song", s.title.length > 0);

  // 2. play next from the row menu
  const thirdTitle = await rowTitle(win, 2);
  await win.locator('[role="row"]').nth(2).click({ button: "right" });
  await win.locator('[role="menuitem"]', { hasText: "Play next" }).click();
  await win.waitForTimeout(1200);
  let q = await savedQueue(win);
  check("Play next queues the song right after the current one", q.items[q.index + 1]?.track.title === thirdTitle, q.items[q.index + 1]?.track.title);

  // 3. listen past 30 seconds, then skip: the song lands in history
  await win.waitForTimeout(27000);
  await win.locator('footer button[aria-label="Next"]').click();
  await win.waitForTimeout(4000);
  const history = await win.evaluate(() => window.encore.library.get().then((l) => l.history));
  check("a song heard for 30s+ is saved to history", history[0]?.track.title === firstTitle && history[0].playedMs >= 30000, `${history.length} entries, ${Math.round((history[0]?.playedMs ?? 0) / 1000)}s`);
  s = await state(win);
  check("Next plays the queued song", s.playing && s.title === thirdTitle, `"${s.title}"`);

  // 4. shuffle and repeat shortcuts
  await win.locator("main").click({ position: { x: 5, y: 300 } });
  await win.keyboard.press("Control+s");
  await win.keyboard.press("Control+r");
  await win.keyboard.press("Control+r");
  const modes = await win.evaluate(() => ({
    shuffle: document.querySelector('footer button[title^="Shuffle"]')?.getAttribute("aria-pressed"),
    repeat: document.querySelector('footer button[title^="Repeat"]')?.getAttribute("aria-label"),
  }));
  check("shuffle and repeat toggle from the keyboard", modes.shuffle === "true" && modes.repeat === "Repeat: one", JSON.stringify(modes));
  await win.keyboard.press("Control+r");
  await win.keyboard.press("Control+s");

  // 5. at the end of the queue, autoplay continues with similar songs
  await win.keyboard.press("q");
  await win.waitForTimeout(600);
  await win.getByRole("button", { name: "Clear", exact: true }).click();
  await win.keyboard.press("q");
  const lengthBefore = (await savedQueue(win)).items.length;
  const titleBefore = (await state(win)).title;
  await seekToEnd(win);
  await win.waitForTimeout(10000);
  q = await savedQueue(win);
  s = await state(win);
  check("autoplay adds similar songs when the queue runs out", s.playing && q.items.length > lengthBefore && s.title !== titleBefore, `queue ${lengthBefore} -> ${q.items.length}, now "${s.title}"`);

  // 6. a song that can't load is skipped
  const good = (await win.evaluate(() => window.encore.catalog.search("adele hello"))).tracks[0];
  const broken = { id: "youtube:zzzzzzzzzzz", source: "youtube", sourceId: "zzzzzzzzzzz", title: "Broken song", artists: [{ name: "Nobody" }], durationMs: 0 };
  const playlist = await win.evaluate(([b, g]) => window.encore.library.createPlaylist("Smoke test", [b, g]), [broken, good]);
  await win.locator("aside button", { hasText: "Smoke test" }).click();
  await win.waitForSelector('[role="row"]');
  await win.locator('[role="row"]').first().dblclick();
  await win.waitForTimeout(9000);
  s = await state(win);
  check("a broken song is skipped with a message", s.playing && s.title === good.title, `now "${s.title}"; toast: ${await toastText(win)}`);

  // 7. like + playlist survive a restart, and so does the queue
  await win.evaluate((t) => window.encore.library.setLiked(t, true), good);
  await win.waitForTimeout(1500);
  const titleBeforeRestart = (await state(win)).title;
  check("no uncaught errors in the window", errors.length === 0, errors.slice(0, 2).join(" | "));
  await app.close();

  ({ app, win, errors } = await launch());
  await win.waitForTimeout(2500);
  const lib = await win.evaluate(() => window.encore.library.get());
  check("liked songs and playlists survive a restart", lib.liked.length === 1 && lib.playlists.some((p) => p.id === playlist.id), `${lib.liked.length} liked, ${lib.playlists.length} playlists`);
  for (let i = 0; i < 20 && !(await state(win)).playing; i++) await win.waitForTimeout(500);
  s = await state(win);
  check("the song that was playing carries on after a restart", s.title === titleBeforeRestart && s.playing, `"${s.title}" at ${s.position}s`);
  await win.locator('footer button[aria-label="Pause"]').click();
  await win.waitForTimeout(1000);
  await app.close();

  // paused when the app closed: it opens on that song, still paused, and Play carries on
  ({ app, win, errors } = await launch());
  await win.waitForTimeout(3500);
  s = await state(win);
  check("a paused song opens paused", s.title === titleBeforeRestart && !s.playing, `"${s.title}"`);
  await win.locator('footer button[aria-label="Play"]').click();
  await win.waitForTimeout(5000);
  s = await state(win);
  check("pressing play resumes it", s.playing, `at ${s.position}s`);
  await app.close();
} catch (error) {
  console.error(error);
  results.push({ name: "script finished", ok: false });
  if (process.env.SMOKE_SHOTS && lastWindow) await lastWindow.screenshot({ path: join(process.env.SMOKE_SHOTS, "smoke-failure.png") }).catch(() => undefined);
} finally {
  for (const app of running) await app.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
