// Key combinations are written like "Ctrl+Alt+ArrowRight" or "Space": the
// modifiers in a fixed order, then one key. Both windows and the main process
// use this format; the main process turns it into an Electron accelerator for
// shortcuts that work while Vyse Music is in the background.

export type GlobalCommand = "playPause" | "next" | "previous" | "volumeUp" | "volumeDown" | "like" | "mini" | "show";

export const GLOBAL_COMMANDS: { id: GlobalCommand; label: string; keys: string }[] = [
  { id: "playPause", label: "Play or pause", keys: "Ctrl+Alt+P" },
  { id: "next", label: "Next song", keys: "Ctrl+Alt+ArrowRight" },
  { id: "previous", label: "Previous song", keys: "Ctrl+Alt+ArrowLeft" },
  { id: "volumeUp", label: "Volume up", keys: "Ctrl+Alt+ArrowUp" },
  { id: "volumeDown", label: "Volume down", keys: "Ctrl+Alt+ArrowDown" },
  { id: "like", label: "Like the song that's playing", keys: "Ctrl+Alt+L" },
  { id: "mini", label: "Show or hide the mini player", keys: "Ctrl+Alt+Shift+M" },
  { id: "show", label: "Bring Vyse Music to the front", keys: "Ctrl+Alt+E" },
];

export const isGlobalCommand = (id: unknown): id is GlobalCommand => GLOBAL_COMMANDS.some((c) => c.id === id);

export interface GlobalKeysConfig {
  enabled: boolean;
  /** only the ones changed from the defaults; "" turns one off */
  keys: Partial<Record<GlobalCommand, string>>;
}

/** registered, already taken by another app, or not a combination Windows accepts */
export type GlobalKeyState = "ok" | "taken" | "invalid";

export function globalKeysFor(config: GlobalKeysConfig): Record<GlobalCommand, string> {
  return Object.fromEntries(GLOBAL_COMMANDS.map((c) => [c.id, config.keys[c.id] ?? c.keys])) as Record<GlobalCommand, string>;
}

const MODIFIERS = ["Ctrl", "Alt", "Shift"] as const;

// keys that Electron spells differently from the browser
const ACCELERATOR_NAMES: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
  "+": "Plus",
};

const NAMED_KEYS = new Set(["Space", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** split a combination into its modifiers and key, or null if it isn't one */
export function parseCombo(combo: string): { modifiers: (typeof MODIFIERS)[number][]; key: string } | null {
  const parts = combo.split("+");
  // "Ctrl++" is Ctrl and the plus key
  const key = combo.endsWith("++") ? "+" : parts.pop();
  if (combo.endsWith("++")) parts.splice(-2);
  if (!key) return null;
  const modifiers = MODIFIERS.filter((m) => parts.includes(m));
  if (modifiers.length !== parts.length) return null;
  const valid = NAMED_KEYS.has(key) || /^F([1-9]|1\d|2[0-4])$/.test(key) || /^[A-Z0-9]$/.test(key) || /^[,.\/;'[\]\\`=+-]$/.test(key);
  return valid ? { modifiers, key } : null;
}

/** an Electron accelerator for a global shortcut; those need Ctrl or Alt so plain typing isn't taken over */
export function toAccelerator(combo: string): string | null {
  const parsed = parseCombo(combo);
  if (!parsed || !(parsed.modifiers.includes("Ctrl") || parsed.modifiers.includes("Alt"))) return null;
  const modifiers = parsed.modifiers.map((m) => (m === "Ctrl" ? "Control" : m));
  return [...modifiers, ACCELERATOR_NAMES[parsed.key] ?? parsed.key].join("+");
}
