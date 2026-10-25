// Dev helper: launches the built app, walks through the main screens and saves
// screenshots for a visual check. Usage: node scripts/screenshots.mjs <output folder>
import { _electron as electron } from "playwright-core";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, ENCORE_USER_DATA: `${outDir}/userdata` } });
const logs = [];
app.process().stderr.on("data", (d) => logs.push(String(d)));
app.process().stdout.on("data", (d) => logs.push(String(d)));
const win = await app.firstWindow();
win.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[console.${m.type()}] ${m.text()}\n`));
win.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n`));
const shot = (name) => win.screenshot({ path: `${outDir}/${name}.png` });
const step = (msg) => console.log(`- ${msg}`);
const status = () => win.evaluate(() => (document.querySelector('footer button[aria-label="Pause"]') ? "playing" : "not playing"));
const position = () => win.evaluate(() => document.querySelector('footer [role="slider"][aria-label="Seek"]')?.getAttribute("aria-valuenow"));

await win.waitForTimeout(4000);
await shot("01-home");

step("search");
await win.keyboard.press("Control+k");
await win.keyboard.type("daft punk", { delay: 30 });
await win.keyboard.press("Enter");
await win.waitForSelector('[role="row"]', { timeout: 30000 });
await win.waitForTimeout(1500);
await shot("02-search");

step("play first song");
await win.locator('[role="row"]').first().dblclick();
await win.waitForTimeout(4000);
console.log("  status:", await status(), "position:", await position());
await shot("03-playing");

step("seek to the middle");
const slider = win.locator('footer [role="slider"][aria-label="Seek"]');
const box = await slider.boundingBox();
await win.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
await win.waitForTimeout(3000);
console.log("  after seek position:", await position(), "status:", await status());

step("like it and open the queue");
await win.locator('footer button[aria-label="Add to Liked Songs"]').click();
await win.keyboard.press("q");
await win.waitForTimeout(1500);
await shot("04-queue");
await win.keyboard.press("q");

step("next track");
await win.locator('footer button[aria-label="Next"]').click();
await win.waitForTimeout(3500);
console.log("  status:", await status(), "now:", await win.locator("footer").innerText().then((t) => t.split("\n").slice(0, 2).join(" / ")));

step("open album from top songs");
await win.locator('[role="row"] button', { hasText: /./ }).filter({ hasNotText: /Daft Punk/ }).first().click().catch(() => undefined);
await win.waitForTimeout(500);
await win.locator("text=Daft Punk").first().click();
await win.waitForTimeout(3500);
await shot("05-artist");

step("open an album card");
const albumCard = win.locator("section:has(h2:text('Albums')) [role='button']").first();
if (await albumCard.count()) {
  await albumCard.click();
  await win.waitForTimeout(3500);
  await shot("06-album");
}

step("create a playlist from the row menu");
await win.locator('[role="row"]').first().click({ button: "right" });
await win.waitForTimeout(400);
await shot("07-menu");
await win.locator('[role="menuitem"]', { hasText: "Add to playlist" }).hover();
await win.waitForTimeout(400);
await win.locator('[role="menuitem"]', { hasText: "New playlist" }).click();
await win.waitForTimeout(500);
await win.keyboard.press("Control+a");
await win.keyboard.type("Test mix");
await win.keyboard.press("Enter");
await win.waitForTimeout(1200);
await win.locator("aside button", { hasText: "Test mix" }).click();
await win.waitForTimeout(1500);
await shot("08-playlist");

step("liked songs");
await win.locator("aside button", { hasText: "Liked Songs" }).click();
await win.waitForTimeout(1500);
await shot("09-liked");

step("home again");
await win.locator("aside button", { hasText: "Home" }).click();
await win.waitForTimeout(2000);
await shot("10-home-after");

await app.close();
console.log(logs.join("").slice(-3000));
