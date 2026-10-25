import { useSettings, type GlassArea, type Settings } from "@/settings/store";
import { accentShades, DEFAULT_ACCENT, presetFor, type AccentShades } from "./colors";

// Settings that change how the app looks live in CSS variables and one
// attribute on <html>, so every pane picks them up at once without
// re-rendering: the theme, the accent colour and how see-through the glass is.
// The main window also hands the main process a recoloured app icon, so the
// taskbar and tray match the accent.

type Theme = "dark" | "light";

const GLASS_OPACITY: Record<Exclude<Settings["glass"], "custom">, number> = { clear: 30, tinted: 64 };
const DEFAULT_BLUR = 22;

// with transparency effects turned off in Windows, the glass is nearly solid
const reduceTransparency = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-transparency: reduce)") : null;
const prefersDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function effectiveTheme(theme: Settings["theme"]): Theme {
  if (theme === "system") return prefersDark?.matches === false ? "light" : "dark";
  return theme;
}

export function accentOf(settings: Pick<Settings, "accent" | "customAccent">): { color: string; logo?: [string, string] } {
  if (settings.accent === "custom") return { color: settings.customAccent };
  return presetFor(settings.accent) ?? DEFAULT_ACCENT;
}

export function currentShades(theme: Theme = effectiveTheme(useSettings.getState().theme)): AccentShades {
  const { color, logo } = accentOf(useSettings.getState());
  return accentShades(color, theme, logo);
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
}

function applyAccent(shades: AccentShades): void {
  const style = document.documentElement.style;
  style.setProperty("--color-accent", shades.accent);
  style.setProperty("--color-accent-2", shades.light);
  style.setProperty("--color-accent-deep", shades.deep);
  style.setProperty("--color-on-accent", shades.onAccent);
  style.setProperty("--accent-rgb", shades.rgb);
  style.setProperty("--logo-1", shades.logo[0]);
  style.setProperty("--logo-2", shades.logo[1]);
  style.setProperty("--logo-3", shades.logo[2]);
}

function applyGlass(settings: Settings): void {
  const style = document.documentElement.style;
  const area = (name: GlassArea) => {
    if (reduceTransparency?.matches) return { alpha: 0.9, blur: DEFAULT_BLUR };
    if (settings.glass === "custom") {
      const a = settings.glassAreas[name];
      return { alpha: Math.min(1, Math.max(0.05, a.opacity / 100)), blur: Math.max(0, a.blur) };
    }
    return { alpha: (GLASS_OPACITY[settings.glass] ?? GLASS_OPACITY.clear) / 100, blur: DEFAULT_BLUR };
  };
  const panels = area("panels");
  const sidebar = area("sidebar");
  const player = area("player");
  style.setProperty("--glass-alpha", String(panels.alpha));
  style.setProperty("--glass-blur", `${panels.blur}px`);
  style.setProperty("--sidebar-alpha", String(sidebar.alpha));
  style.setProperty("--sidebar-blur", `${sidebar.blur}px`);
  style.setProperty("--player-alpha", String(player.alpha));
  style.setProperty("--player-blur", `${player.blur}px`);
}

/** the app icon (resources/icon.svg) in the given gradient */
export function logoSvg([top, middle, bottom]: [string, string, string]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${top}" /><stop offset="0.55" stop-color="${middle}" /><stop offset="1" stop-color="${bottom}" />
    </linearGradient>
    <radialGradient id="shine" cx="0.3" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35" /><stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#bg)" />
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#shine)" />
  <g stroke="#ffffff" stroke-width="38" stroke-linecap="round">
    <line x1="136" y1="222" x2="136" y2="290" /><line x1="196" y1="160" x2="196" y2="352" /><line x1="256" y1="200" x2="256" y2="312" />
    <line x1="316" y1="130" x2="316" y2="382" /><line x1="376" y1="190" x2="376" y2="322" />
  </g>
</svg>`;
}

async function renderIcon(colors: [string, string, string]): Promise<string> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg(colors))}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  canvas.getContext("2d")!.drawImage(image, 0, 0, 256, 256);
  return canvas.toDataURL("image/png");
}

let iconTimer = 0;
let iconKey = "";

/** the taskbar, tray and window icon follow the accent; the stock icon stays for the default */
function syncIcon(settings: Settings): void {
  const isDefault = settings.accent === DEFAULT_ACCENT.id;
  const key = isDefault ? "default" : JSON.stringify(accentShades(accentOf(settings).color, "dark", accentOf(settings).logo).logo);
  if (key === iconKey) return;
  iconKey = key;
  clearTimeout(iconTimer);
  // dragging the custom colour picker sends a stream of colours; only the last one matters
  iconTimer = window.setTimeout(() => {
    if (isDefault) return void window.encore.app.setIcon(null);
    void renderIcon(currentShades("dark").logo)
      .then((png) => window.encore.app.setIcon(png))
      .catch(() => undefined);
  }, 350);
}

/**
 * Run a change that recolours the app, revealing the new look in a circle
 * that spreads from the click, the way Liner switches themes.
 */
export function revealChange(change: () => void, at?: { x: number; y: number }): void {
  const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };
  if (!at || !doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }
  const transition = doc.startViewTransition(change);
  // a window that isn't on screen can't animate; the change still happens without it
  transition.finished.catch(() => undefined);
  void transition.ready.then(() => {
    const radius = Math.hypot(Math.max(at.x, innerWidth - at.x), Math.max(at.y, innerHeight - at.y));
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${at.x}px ${at.y}px)`, `circle(${radius}px at ${at.x}px ${at.y}px)`] },
      { duration: 650, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  }, () => undefined);
}

/**
 * Keep the window's look in step with the settings. The mini player passes
 * `mini`: it always stays dark and only follows the accent.
 */
export function connectAppearance({ mini = false }: { mini?: boolean } = {}): () => void {
  const applyAll = () => {
    const settings = useSettings.getState();
    const theme = mini ? "dark" : effectiveTheme(settings.theme);
    applyTheme(theme);
    applyAccent(currentShades(theme));
    applyGlass(settings);
  };
  applyAll();
  if (!mini) {
    void window.encore.app.setTheme(useSettings.getState().theme);
    syncIcon(useSettings.getState());
  }

  const onSystemChange = () => applyAll();
  reduceTransparency?.addEventListener("change", onSystemChange);
  prefersDark?.addEventListener("change", onSystemChange);
  const stop = useSettings.subscribe((s, prev) => {
    const themeChanged = s.theme !== prev.theme;
    if (themeChanged || s.accent !== prev.accent || s.customAccent !== prev.customAccent || s.glass !== prev.glass || s.glassAreas !== prev.glassAreas) applyAll();
    if (mini) return;
    if (themeChanged) void window.encore.app.setTheme(s.theme);
    if (s.accent !== prev.accent || s.customAccent !== prev.customAccent) syncIcon(s);
  });
  return () => {
    stop();
    clearTimeout(iconTimer);
    reduceTransparency?.removeEventListener("change", onSystemChange);
    prefersDark?.removeEventListener("change", onSystemChange);
  };
}
