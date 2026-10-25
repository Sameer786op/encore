import { Menu, Tray, nativeImage, type NativeImage } from "electron";
import type { NowPlaying, PlayerCommand } from "@shared/types";

// While Encore plays with its window closed, it lives in the system tray:
// a click brings the window back, and the menu has the basic controls and Quit.

interface BackgroundTrayOptions {
  icon: string;
  show(): void;
  command(command: PlayerCommand): void;
  quit(): void;
}

function trayImage(path: string): NativeImage {
  const source = nativeImage.createFromPath(path);
  const image = source.resize({ width: 16, height: 16, quality: "best" });
  // sharper on high-DPI screens
  image.addRepresentation({ scaleFactor: 2, buffer: source.resize({ width: 32, height: 32, quality: "best" }).toPNG() });
  return image;
}

export class BackgroundTray {
  private tray: Tray | null = null;
  private now: NowPlaying | null = null;
  private menuKey = "";

  private icon: string;

  constructor(private readonly options: BackgroundTrayOptions) {
    this.icon = options.icon;
  }

  /** the icon follows the accent colour */
  setIcon(path: string): void {
    this.icon = path;
    this.tray?.setImage(trayImage(path));
  }

  get visible(): boolean {
    return !!this.tray;
  }

  show(): void {
    if (this.tray) return;
    this.tray = new Tray(trayImage(this.icon));
    this.tray.on("click", () => this.options.show());
    this.menuKey = "";
    this.refresh();
  }

  hide(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  /** keeps the tooltip and menu in step with what's playing */
  update(now: NowPlaying | null): void {
    this.now = now;
    this.refresh();
  }

  private refresh(): void {
    if (!this.tray) return;
    const track = this.now?.track;
    const playing = !!this.now?.playing;
    const key = `${track?.id ?? ""}|${playing}`;
    if (key === this.menuKey) return;
    this.menuKey = key;
    const artists = track?.artists.map((a) => a.name).join(", ");
    // Windows cuts tooltips off at 127 characters
    this.tray.setToolTip((track ? `Encore: ${track.title} · ${artists}` : "Encore").slice(0, 127));
    const send = (kind: "toggle" | "next" | "previous") => () => this.options.command({ kind });
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(track ? [{ label: `${track.title} · ${artists}`.slice(0, 60), enabled: false }, { type: "separator" as const }] : []),
        { label: playing ? "Pause" : "Play", enabled: !!track, click: send("toggle") },
        { label: "Next", enabled: !!track, click: send("next") },
        { label: "Previous", enabled: !!track, click: send("previous") },
        { type: "separator" },
        { label: "Open Encore", click: () => this.options.show() },
        { label: "Quit Encore", click: () => this.options.quit() },
      ]),
    );
  }
}
