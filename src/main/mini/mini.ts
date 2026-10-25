import { readFileSync, writeFileSync } from "node:fs";
import { BrowserWindow, screen, type WebContents } from "electron";

// The floating mini player: a small, frameless, always-on-top window that
// shows what's playing. It holds no audio itself; it mirrors the main window
// and sends button presses back to it.

const WIDTH = 380;
const HEIGHT = 120;
const MARGIN = 24;

interface MiniOptions {
  preload: string;
  icon: string;
  stateFile: string;
  load(win: BrowserWindow): void;
  onVisible(visible: boolean): void;
  onReady(win: BrowserWindow): void;
}

export class MiniPlayer {
  private win: BrowserWindow | null = null;
  private autoShown = false;
  showOnMinimize = false;
  /** whether a song is loaded; no point floating an empty player */
  hasTrack = false;

  constructor(private readonly options: MiniOptions) {}

  owns(sender: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === sender;
  }

  get visible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  send(channel: string, value: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, value);
  }

  private savedPosition(): { x: number; y: number } | null {
    try {
      const saved = JSON.parse(readFileSync(this.options.stateFile, "utf8")) as { x?: number; y?: number };
      if (typeof saved.x !== "number" || typeof saved.y !== "number") return null;
      // only reuse it if that spot is still on a connected screen
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return saved.x! >= a.x - 40 && saved.y! >= a.y - 40 && saved.x! + 80 <= a.x + a.width && saved.y! + 40 <= a.y + a.height;
      });
      return onScreen ? { x: saved.x, y: saved.y } : null;
    } catch {
      return null;
    }
  }

  private create(): BrowserWindow {
    const area = screen.getPrimaryDisplay().workArea;
    const position = this.savedPosition() ?? { x: area.x + area.width - WIDTH - MARGIN, y: area.y + area.height - HEIGHT - MARGIN };
    const win = new BrowserWindow({
      ...position,
      width: WIDTH,
      height: HEIGHT,
      title: "Encore mini player",
      icon: this.options.icon,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, "floating");
    win.on("moved", () => {
      const [x, y] = win.getPosition();
      try {
        writeFileSync(this.options.stateFile, JSON.stringify({ x, y }));
      } catch {
        // the position just won't be remembered
      }
    });
    win.on("show", () => this.options.onVisible(true));
    win.on("hide", () => this.options.onVisible(false));
    win.on("closed", () => {
      this.win = null;
      this.options.onVisible(false);
    });
    win.webContents.on("did-finish-load", () => this.options.onReady(win));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    this.options.load(win);
    return win;
  }

  open(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create();
      this.win.once("ready-to-show", () => this.win?.showInactive());
    } else this.win.showInactive();
  }

  close(): void {
    this.autoShown = false;
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  /** follow the main window: float when it's minimized, step aside when it's back */
  follow(main: BrowserWindow): void {
    main.on("minimize", () => {
      if (!this.showOnMinimize || !this.hasTrack || this.visible) return;
      this.autoShown = true;
      this.open();
    });
    const back = () => {
      if (this.autoShown) this.close();
    };
    main.on("restore", back);
    main.on("focus", back);
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
