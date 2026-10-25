import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BrowserWindow, dialog, nativeImage, nativeTheme, type NativeImage } from "electron";
import { MEDIA_SCHEME, type ThemeSetting } from "@shared/types";
import { getSetting, setSetting } from "./settings";

// The parts of Settings → Appearance that live outside the page: the light or
// dark window frame, the app icon in the accent colour, and the wallpaper file.

const THEMES: ThemeSetting[] = ["dark", "light", "system"];
export const WALLPAPER_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};
const MAX_WALLPAPER_BYTES = 40 * 1024 * 1024;
const MAX_ICON_BYTES = 2 * 1024 * 1024;

interface AppearanceOptions {
  db: DatabaseSync;
  userData: string;
  /** the icon the app ships with */
  stockIcon: string;
  /** the icon changed; windows, tray and notifications should use it */
  onIcon(image: NativeImage, path: string): void;
  /** light or dark changed; the window frame should follow */
  onTheme(): void;
}

export class Appearance {
  private readonly customIconPath: string;
  readonly wallpaperDir: string;

  constructor(private readonly options: AppearanceOptions) {
    this.customIconPath = join(options.userData, "app-icon.png");
    this.wallpaperDir = join(options.userData, "wallpaper");
    // start in the theme picked last time, so the window doesn't flash the other one
    const saved = getSetting(options.db, "appearance.theme") as ThemeSetting | null;
    nativeTheme.themeSource = saved && THEMES.includes(saved) ? saved : "dark";
    nativeTheme.on("updated", () => options.onTheme());
  }

  /** the custom icon if the accent has one, else the stock icon */
  get iconPath(): string {
    return existsSync(this.customIconPath) ? this.customIconPath : this.options.stockIcon;
  }

  get dark(): boolean {
    return nativeTheme.shouldUseDarkColors;
  }

  /** what shows while the page is still loading or the window is resized */
  get backgroundColor(): string {
    return this.dark ? "#07070a" : "#f2f2f7";
  }

  /** the minimise, maximise and close buttons Windows draws over the page */
  get titleBarOverlay(): { color: string; symbolColor: string; height: number } {
    return { color: "#00000000", symbolColor: this.dark ? "#d4d4d8" : "#3c3c43", height: 48 };
  }

  setTheme(theme: unknown): void {
    if (!THEMES.includes(theme as ThemeSetting)) throw new Error("Unknown theme");
    setSetting(this.options.db, "appearance.theme", theme as string);
    nativeTheme.themeSource = theme as ThemeSetting;
  }

  /** a PNG data URL of the recoloured icon, or null for the stock one */
  setIcon(dataUrl: unknown): void {
    if (dataUrl === null) {
      rmSync(this.customIconPath, { force: true });
      this.options.onIcon(nativeImage.createFromPath(this.options.stockIcon), this.options.stockIcon);
      return;
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) throw new Error("Expected a PNG");
    const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    if (png.length === 0 || png.length > MAX_ICON_BYTES) throw new Error("That icon is too big");
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) throw new Error("That icon couldn't be read");
    writeFileSync(this.customIconPath, png);
    this.options.onIcon(image, this.customIconPath);
  }

  /** ask for a picture and keep a copy of it; returns the address the page loads it from */
  async pickWallpaper(win: BrowserWindow): Promise<string | null> {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose a wallpaper",
      properties: ["openFile"],
      filters: [{ name: "Pictures and GIFs", extensions: Object.keys(WALLPAPER_TYPES).map((e) => e.slice(1)) }],
    });
    const source = result.canceled ? null : result.filePaths[0];
    if (!source) return null;
    const ext = extname(source).toLowerCase();
    if (!WALLPAPER_TYPES[ext]) throw new Error("Pick a PNG, JPEG, WebP, AVIF or GIF picture");
    if (statSync(source).size > MAX_WALLPAPER_BYTES) throw new Error("That picture is over 40 MB");
    const bytes = readFileSync(source);
    const name = `${createHash("sha1").update(bytes).digest("hex")}${ext === ".jpeg" ? ".jpg" : ext}`;
    mkdirSync(this.wallpaperDir, { recursive: true });
    // only one wallpaper is kept
    for (const old of readdirSync(this.wallpaperDir)) if (old !== name) unlinkSync(join(this.wallpaperDir, old));
    writeFileSync(join(this.wallpaperDir, name), bytes);
    return `${MEDIA_SCHEME}://wallpaper/${name}`;
  }

  clearWallpaper(): void {
    rmSync(this.wallpaperDir, { recursive: true, force: true });
  }
}
