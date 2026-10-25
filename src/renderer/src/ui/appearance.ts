import { useSettings, type GlassArea, type Settings } from "@/settings/store";
import { accentShades, DEFAULT_ACCENT, presetFor, type AccentShades } from "./colors";

// Settings that change how the app looks live in CSS variables and one
// attribute on <html>, so every pane picks them up at once without
// re-rendering: the theme, the accent colour and how see-through the glass is.

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
  if (!mini) void window.encore.app.setTheme(useSettings.getState().theme);

  const onSystemChange = () => applyAll();
  reduceTransparency?.addEventListener("change", onSystemChange);
  prefersDark?.addEventListener("change", onSystemChange);
  const stop = useSettings.subscribe((s, prev) => {
    const themeChanged = s.theme !== prev.theme;
    if (themeChanged || s.accent !== prev.accent || s.customAccent !== prev.customAccent || s.glass !== prev.glass || s.glassAreas !== prev.glassAreas) applyAll();
    if (mini) return;
    if (themeChanged) void window.encore.app.setTheme(s.theme);
  });
  return () => {
    stop();
    reduceTransparency?.removeEventListener("change", onSystemChange);
    prefersDark?.removeEventListener("change", onSystemChange);
  };
}
