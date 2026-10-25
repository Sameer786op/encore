import { nativeImage, type BrowserWindow, type NativeImage, type ThumbarButton } from "electron";
import type { NowPlaying, PlayerCommand } from "@shared/types";
import { drawGlyph, encodePng, type Glyph } from "./glyphs";

// Previous, play/pause and next buttons under Vyse Music's preview when you hover
// its taskbar button.

/** the glyph at every common display scale, so it stays sharp */
function glyphImage(glyph: Glyph): NativeImage {
  const image = nativeImage.createFromBuffer(encodePng(drawGlyph(glyph, 16), 16), { scaleFactor: 1 });
  for (const scaleFactor of [1.25, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor);
    image.addRepresentation({ scaleFactor, buffer: encodePng(drawGlyph(glyph, size), size) });
  }
  return image;
}

export class Thumbar {
  private icons: Record<Glyph, NativeImage> | null = null;
  private state = { hasTrack: false, playing: false };
  private shown = "";

  constructor(
    private readonly win: BrowserWindow,
    private readonly command: (command: PlayerCommand) => void,
  ) {
    // Windows forgets the buttons whenever the window is hidden, as it is in the tray
    win.on("show", () => this.apply(true));
  }

  /** keeps the play button in step with what's playing */
  update(now: NowPlaying | null): void {
    this.state = { hasTrack: !!now?.track, playing: !!now?.playing };
    this.apply();
  }

  private apply(force = false): void {
    if (process.platform !== "win32" || this.win.isDestroyed()) return;
    const { hasTrack, playing } = this.state;
    const key = `${hasTrack}|${playing}`;
    if (!force && key === this.shown) return;
    this.shown = key;
    this.icons ??= { previous: glyphImage("previous"), play: glyphImage("play"), pause: glyphImage("pause"), next: glyphImage("next") };
    const flags: ThumbarButton["flags"] = hasTrack ? ["enabled"] : ["disabled"];
    this.win.setThumbarButtons([
      { tooltip: "Previous", icon: this.icons.previous, flags, click: () => this.command({ kind: "previous" }) },
      { tooltip: playing ? "Pause" : "Play", icon: playing ? this.icons.pause : this.icons.play, flags, click: () => this.command({ kind: "toggle" }) },
      { tooltip: "Next", icon: this.icons.next, flags, click: () => this.command({ kind: "next" }) },
    ]);
  }
}
