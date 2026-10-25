import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BrowserWindow, dialog, nativeTheme } from "electron";
import { MEDIA_SCHEME, type ThemeSetting } from "@shared/types";
import { getSetting, setSetting } from "./settings";

// The parts of Settings → Appearance that live outside the page: the light or
// dark window frame and the wallpaper file.

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

interface AppearanceOptions {
  db: DatabaseSync;
  userData: string;
  /** light or dark changed; the window frame should follow */
  onTheme(): void;
}

export class Appearance {
  readonly wallpaperDir: string;

  constructor(private readonly options: AppearanceOptions) {
    // older versions kept an icon recoloured to the accent here; the logo keeps its own colours now
    rmSync(join(options.userData, "app-icon.png"), { force: true });
    this.wallpaperDir = join(options.userData, "wallpaper");
    // start in the theme picked last time, so the window doesn't flash the other one
    const saved = getSetting(options.db, "appearance.theme") as ThemeSetting | null;
    nativeTheme.themeSource = saved && THEMES.includes(saved) ? saved : "dark";
    nativeTheme.on("updated", () => options.onTheme());
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
