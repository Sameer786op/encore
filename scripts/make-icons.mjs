// Makes every icon from the Vyse Music logo (resources/logo-source.webp): the V
// mark on its own without the name under it, the app icon, the logo inside the
// app, and the Microsoft Store logos.
// Run with Electron so we get a real canvas: npm run icons
import { app, BrowserWindow } from "electron";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const source = `data:image/webp;base64,${readFileSync(join(root, "resources/logo-source.webp")).toString("base64")}`;

// [file name, width, height, how much of the height the app icon fills]
const store = [];
const scaled = (name, w, h, fill, scales) => scales.forEach((s) => store.push([`${name}.scale-${s}.png`, Math.round((w * s) / 100), Math.round((h * s) / 100), fill]));
scaled("StoreLogo", 50, 50, 1, [100, 125, 150, 200, 400]);
scaled("Square44x44Logo", 44, 44, 1, [100, 125, 150, 200, 400]);
scaled("Square150x150Logo", 150, 150, 0.6, [100, 125, 150, 200, 400]);
scaled("Wide310x150Logo", 310, 150, 0.6, [100, 125, 150, 200, 400]);
scaled("SmallTile", 71, 71, 0.6, [100, 125, 150, 200, 400]);
scaled("LargeTile", 310, 310, 0.6, [100, 125, 150, 200, 400]);
// the taskbar and Start list, drawn without a coloured plate behind
for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]) {
  for (const kind of ["", "_altform-unplated", "_altform-lightunplated"]) store.push([`Square44x44Logo.targetsize-${size}${kind}.png`, size, size, 1]);
}

// runs in the page
async function draw(src, store) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const full = canvas(W, H).getContext("2d", { willReadFrequently: true });
  full.drawImage(img, 0, 0);
  const px = full.getImageData(0, 0, W, H).data;

  // the background is near black; take it from the corners
  const bg = [0, 0, 0];
  let n = 0;
  for (const [x0, y0] of [[0, 0], [W - 32, 0], [0, H - 32], [W - 32, H - 32]]) {
    for (let y = y0; y < y0 + 32; y++) for (let x = x0; x < x0 + 32; x++, n++) for (let c = 0; c < 3; c++) bg[c] += px[(y * W + x) * 4 + c];
  }
  for (let c = 0; c < 3; c++) bg[c] /= n;
  // the glow fills the gap between the mark and the name, so only the bright cores count
  const lit = (x, y) => {
    const i = (y * W + x) * 4;
    return Math.max(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]) > 150;
  };

  // the mark is the first lit band from the top; the name sits below a darker gap
  const litRow = (y) => {
    let count = 0;
    for (let x = 0; x < W; x += 2) if (lit(x, y) && ++count >= 3) return true;
    return false;
  };
  let top = 0;
  while (top < H && !litRow(top)) top++;
  let bottom = top;
  let dark = 0;
  for (let y = top; y < H && dark < 12; y++) {
    if (litRow(y)) {
      bottom = y;
      dark = 0;
    } else dark++;
  }
  let nameTop = bottom + 1;
  while (nameTop < H && !litRow(nameTop)) nameTop++;
  let left = W;
  let right = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < W; x++) {
      if (lit(x, y)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  // room for the glow, without reaching the name
  const pad = 70;
  const cx = Math.max(0, left - pad);
  const cy = Math.max(0, top - pad);
  const cw = Math.min(W, right + pad) - cx;
  const ch = Math.min(H, bottom + Math.min(pad, Math.floor((nameTop - bottom) / 2))) - cy;
  // and the glow fades out towards the edges instead of stopping
  const FEATHER = 28;
  const fade = (d) => Math.min(1, d / FEATHER) ** 2;

  // the glow rising from the name reaches up past the V's tip, so keep only light near the mark's own cores
  const cores = canvas(cw, ch).getContext("2d");
  const coreData = cores.createImageData(cw, ch);
  for (let y = 0; cy + y <= bottom; y++) {
    for (let x = 0; x < cw; x++) if (lit(cx + x, cy + y)) coreData.data[(y * cw + x) * 4 + 3] = 255;
  }
  cores.putImageData(coreData, 0, 0);
  const spread = canvas(cw, ch).getContext("2d", { willReadFrequently: true });
  spread.filter = "blur(30px)";
  spread.drawImage(cores.canvas, 0, 0);
  const reach = spread.getImageData(0, 0, cw, ch).data;

  // light on black: whatever is brighter than the background becomes colour with that much opacity
  const mark = canvas(cw, ch).getContext("2d");
  const out = mark.createImageData(cw, ch);
  const ceiling = 255 - Math.max(...bg);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = ((cy + y) * W + cx + x) * 4;
      const o = (y * cw + x) * 4;
      const c = [0, 1, 2].map((k) => Math.max(0, px[i + k] - bg[k]));
      const m = Math.max(...c);
      const near = Math.min(1, (reach[o + 3] / 255) * 20);
      const a = m < 5 ? 0 : Math.min(1, m / ceiling) * near * fade(Math.min(x, y, cw - 1 - x, ch - 1 - y));
      for (let k = 0; k < 3; k++) out.data[o + k] = a ? Math.min(255, c[k] / a) : 0;
      out.data[o + 3] = Math.round(a * 255);
    }
  }
  mark.putImageData(out, 0, 0);

  // the app icon: the mark on a deep navy tile with rounded corners
  const tile = (size) => {
    const ctx = canvas(size, size).getContext("2d");
    const r = size * 0.225;
    const inset = size * 0.03;
    const s = size - inset * 2;
    ctx.beginPath();
    ctx.roundRect(inset, inset, s, s, r);
    const fill = ctx.createLinearGradient(0, inset, 0, size - inset);
    fill.addColorStop(0, "#15163a");
    fill.addColorStop(1, "#05050f");
    ctx.fillStyle = fill;
    ctx.fill();
    const shine = ctx.createRadialGradient(size * 0.5, size * 0.38, 0, size * 0.5, size * 0.38, size * 0.55);
    shine.addColorStop(0, "rgba(120, 90, 255, 0.22)");
    shine.addColorStop(1, "rgba(120, 90, 255, 0)");
    ctx.fillStyle = shine;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size / 256);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.stroke();
    const w = s * 0.86;
    const h = (w * ch) / cw;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mark.canvas, (size - w) / 2, (size - h) / 2, w, h);
    return ctx.canvas;
  };
  const png = (c) => c.toDataURL("image/png").split(",")[1];

  const big = tile(1024);
  const result = { mark: png(mark.canvas), icon: png(big), small: png(tile(256)), store: [] };
  for (const [name, w, h, fill] of store) {
    const ctx = canvas(w, h).getContext("2d");
    const size = Math.round(h * fill);
    ctx.imageSmoothingQuality = "high";
    // small sizes are drawn from their own tile so the edges stay crisp
    ctx.drawImage(size <= 256 ? tile(size) : big, Math.round((w - size) / 2), Math.round((h - size) / 2), size, size);
    result.store.push([name, png(ctx.canvas)]);
  }
  return { ...result, crop: [cx, cy, cw, ch], nameTop };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html;charset=utf-8,<html><body></body></html>");
  const r = await win.webContents.executeJavaScript(`(${draw.toString()})(${JSON.stringify(source)}, ${JSON.stringify(store)})`);
  const write = (path, data) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), Buffer.from(data, "base64"));
  };
  write("resources/logo-mark.png", r.mark);
  write("resources/icon.png", r.icon);
  write("build/icon.png", r.icon);
  write("src/renderer/src/assets/logo.png", r.small);
  rmSync(join(root, "build/appx"), { recursive: true, force: true });
  for (const [name, data] of r.store) write(`build/appx/${name}`, data);
  console.log(`mark cut from ${r.crop.join(",")} (name starts at y=${r.nameTop}); wrote the app icon, the in-app logo and ${r.store.length} Store logos`);
  app.quit();
});
