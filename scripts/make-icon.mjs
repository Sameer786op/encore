// Renders resources/icon.svg to the PNG files the app and installer use.
// Run with Electron so we get a real renderer: npx electron scripts/make-icon.mjs
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const svg = readFileSync(join(root, "resources/icon.svg"), "utf8");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="512" height="512" ')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const png = image.resize({ width: 512, height: 512, quality: "best" }).toPNG();
  writeFileSync(join(root, "resources/icon.png"), png);
  writeFileSync(join(root, "build/icon.png"), png);
  console.log(`wrote icon.png (${png.length} bytes)`);
  app.quit();
});
