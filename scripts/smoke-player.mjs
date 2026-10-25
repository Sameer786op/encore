// End-to-end test of Phase 3 against the real services: the audio graph,
// lyrics, the full-screen player, equalizer, crossfade, gapless playback,
// volume levelling and the mini player. Run `npm run build` first.
// Usage: npm run smoke:player   (SMOKE_SHOTS=<folder> saves screenshots,
// SMOKE_EXE=release/win-unpacked/Encore.exe tests the packaged app)
import { _electron as electron } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shots = process.env.SMOKE_SHOTS;
const profile = mkdtempSync(join(tmpdir(), "encore-smoke-player-"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

let app;
let win;
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = () =>
  win.evaluate(() => {
    const seek = document.querySelector('footer [role="slider"][aria-label="Seek"]');
    const queue = JSON.parse(localStorage.getItem("encore.player.v1") ?? "{}").queue;
    return {
      // songs can share a title, so the queue position tells them apart
      index: queue?.index ?? -1,
      title: navigator.mediaSession.metadata?.title ?? "",
      playing: !!document.querySelector('footer button[aria-label="Pause"]'),
      position: Number(seek?.getAttribute("aria-valuenow") ?? 0),
      duration: Number(seek?.getAttribute("aria-valuemax") ?? 0),
    };
  });

/** click the visible seek bar (the full-screen one when it's open) so this many seconds are left */
async function seekToRemaining(seconds) {
  const { duration } = await state();
  const slider = win.locator('[role="slider"][aria-label="Seek"]').locator("visible=true").last();
  const box = await slider.boundingBox();
  await win.mouse.click(box.x + ((duration - seconds) / duration) * box.width, box.y + box.height / 2);
}

try {
  const target = process.env.SMOKE_EXE ? { executablePath: process.env.SMOKE_EXE, args: [] } : { args: ["."], cwd: process.cwd() };
  app = await electron.launch({ ...target, env: { ...process.env, ENCORE_USER_DATA: profile } });
  win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(e.message));
  // remember every message the app shows, to tell a deliberate skip from a bug
  const toasts = new Set();
  const watchToasts = setInterval(
    () =>
      win
        .evaluate(() => [...document.querySelectorAll("[aria-live=polite] span")].map((x) => x.textContent ?? ""))
        .then((list) => list.forEach((t) => t && toasts.add(t)))
        .catch(() => undefined),
    400,
  );
  /** moved on by one song, or by more only because a song couldn't play */
  const advanced = (before, after) =>
    after.index === before.index + 1 || (after.index > before.index && [...toasts].some((t) => t.startsWith("Couldn't play")));
  await win.waitForSelector("h1");

  // play a well-known song with time-synced lyrics
  await win.keyboard.press("Control+k");
  await win.keyboard.type("blinding lights the weeknd");
  await win.keyboard.press("Enter");
  await win.waitForSelector('[role="row"]', { timeout: 45000 });
  const rowTitles = await win.locator('[role="row"] .truncate').allInnerTexts();
  const index = Math.max(0, rowTitles.findIndex((t) => t.trim() === "Blinding Lights"));
  await win.locator('[role="row"]').nth(Math.floor(index / 2)).dblclick();
  await sleep(6000);
  let s = await state();
  check("the song plays through the new audio engine", s.playing && s.position > 1, `"${s.title}" at ${s.position}s`);

  // full-screen player: sound reaches the analyser, lyrics appear and follow the song
  await win.keyboard.press("l");
  await win.waitForSelector('[aria-label="Now playing"]', { timeout: 10000 });
  await win.waitForFunction(() => document.querySelector('[aria-label="Now playing"]')?.textContent?.includes("Lyrics from"), null, { timeout: 30000 });
  await sleep(2500);
  const energy = await win.evaluate(() => Number(document.querySelector('[data-testid="flow-background"]')?.dataset.energy ?? 0));
  check("real sound flows through the equalizer and visuals", energy > 0.02, `bass energy ${energy}`);
  const lyricInfo = await win.evaluate(() => {
    const view = document.querySelector('[aria-label="Now playing"]');
    return { source: view?.textContent?.match(/Lyrics from ([A-Za-z ]+)/)?.[1], lines: view?.querySelectorAll("button.font-display").length ?? 0 };
  });
  check("time-synced lyrics load", lyricInfo.lines > 10 && /LRCLIB|YouTube/.test(lyricInfo.source ?? ""), JSON.stringify(lyricInfo));
  await seekToRemaining((await state()).duration - 70);
  await sleep(2500);
  const activeAt70 = await win.evaluate(() => [...document.querySelectorAll('[aria-label="Now playing"] button.font-display')].find((b) => b.className.includes("opacity-100"))?.textContent);
  check("the highlighted line follows the song", !!activeAt70 && activeAt70.length > 2, `at ~70s: "${activeAt70}"`);
  await shot(win, "p3-01-fullscreen-lyrics");
  await win.keyboard.press("Escape");
  await sleep(600);

  // equalizer: turning on a preset keeps the music going
  await win.keyboard.press("Control+,");
  await win.waitForSelector("text=Equalizer");
  await win.getByRole("button", { name: "Bass boost" }).click();
  await sleep(2500);
  s = await state();
  const eq = await win.evaluate(() => JSON.parse(localStorage.getItem("encore.settings.v1") ?? "{}").eq);
  check("an equalizer preset applies without interrupting playback", s.playing && eq?.enabled && eq?.preset === "Bass boost", `preset ${eq?.preset}, preamp ${eq?.preamp}`);
  await shot(win, "p3-02-settings");

  // crossfade: set 4 seconds, then let a song run into the next one
  await win.locator('input[aria-label="Crossfade length"]').fill("4");
  await sleep(300);
  const crossfade = await win.evaluate(() => JSON.parse(localStorage.getItem("encore.settings.v1") ?? "{}").crossfadeSeconds);
  const before = await state();
  await seekToRemaining(9);
  await sleep(7500);
  s = await state();
  check(
    "songs crossfade into the next one",
    crossfade === 4 && advanced(before, s) && s.playing && s.position < 6,
    `${crossfade}s fade; #${before.index} "${before.title}" -> #${s.index} "${s.title}" at ${s.position}s`,
  );

  // gapless: no fade, the next song is ready and starts right as this one ends
  await win.locator('input[aria-label="Crossfade length"]').fill("0");
  await sleep(300);
  const beforeGapless = await state();
  await seekToRemaining(4);
  await sleep(6500);
  s = await state();
  check(
    "with crossfade off the next song follows straight on",
    advanced(beforeGapless, s) && s.playing && s.position < 5,
    `#${beforeGapless.index} -> #${s.index} "${s.title}" at ${s.position}s`,
  );

  // volume levelling: the main process reports this song's loudness
  const db = await win.evaluate(async () => {
    const id = await new Promise((resolve) => {
      const item = JSON.parse(localStorage.getItem("encore.player.v1") ?? "{}").queue;
      resolve(item?.items?.[item.index]?.track?.id);
    });
    return id ? window.encore.catalog.loudness(id) : null;
  });
  check("volume levelling knows how loud the song is", typeof db === "number", `${db} dB`);

  // mini player
  const windowsBefore = app.windows().length;
  await win.locator("footer").getByRole("button", { name: "Mini player" }).click();
  let mini = null;
  for (let i = 0; i < 20 && !mini; i++) {
    await sleep(500);
    mini = app.windows().find((w) => w.url().includes("#mini")) ?? null;
  }
  check("the mini player opens in its own window", !!mini && app.windows().length > windowsBefore);
  if (mini) {
    await mini.waitForFunction(() => document.body.textContent && !document.body.textContent.includes("Nothing playing"), null, { timeout: 15000 });
    const miniTitle = await mini.evaluate(() => document.querySelector(".truncate")?.textContent);
    s = await state();
    check("the mini player shows the current song", miniTitle === s.title, `"${miniTitle}"`);
    await shot(mini, "p3-03-mini");
    await mini.getByRole("button", { name: "Pause", exact: true }).click();
    await sleep(1500);
    const paused = !(await state()).playing;
    await mini.getByRole("button", { name: "Play", exact: true }).click();
    await sleep(2500);
    const resumed = (await state()).playing;
    check("its buttons control the main player", paused && resumed, `paused ${paused}, resumed ${resumed}`);
    await mini.getByRole("button", { name: "Close mini player" }).click({ force: true });
    await sleep(800);
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length);
    check("closing it leaves just the main window", visible === 1, `${visible} visible`);
  }

  // Discord without an application id stays quiet and says why
  const discord = await win.evaluate(() => window.encore.discord.status());
  check("Discord stays off until it's set up", discord.state === "off", discord.state);

  check("no uncaught errors in the window", errors.length === 0, errors.slice(0, 2).join(" | "));
  clearInterval(watchToasts);
  if (toasts.size) console.log(`  messages shown: ${[...toasts].join(" | ")}`);
} catch (error) {
  console.error(error);
  results.push({ name: "script finished", ok: false });
  if (shots && win) await win.screenshot({ path: join(shots, "p3-failure.png") }).catch(() => undefined);
} finally {
  if (app) await app.close().catch(() => undefined);
  await sleep(1000);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
