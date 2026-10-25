import { globalShortcut } from "electron";
import { GLOBAL_COMMANDS, globalKeysFor, isGlobalCommand, toAccelerator, type GlobalCommand, type GlobalKeysConfig, type GlobalKeyState } from "@shared/shortcuts";

// Shortcuts that work while another app has focus or Vyse Music sits in the tray.
// Windows gives each combination to whichever app asks first, so one may
// already be taken; the Settings page says which.

export class GlobalKeys {
  private config: GlobalKeysConfig = { enabled: false, keys: {} };
  private paused = false;
  private states: Partial<Record<GlobalCommand, GlobalKeyState>> = {};

  constructor(private readonly run: (command: GlobalCommand) => void) {}

  /** check what the renderer sent, keep it, and register the keys */
  configure(value: unknown): Partial<Record<GlobalCommand, GlobalKeyState>> {
    const raw = value as Partial<GlobalKeysConfig> | null;
    const keys: GlobalKeysConfig["keys"] = {};
    if (raw?.keys && typeof raw.keys === "object") {
      for (const [id, combo] of Object.entries(raw.keys)) {
        if (isGlobalCommand(id) && typeof combo === "string") keys[id] = combo.slice(0, 60);
      }
    }
    this.config = { enabled: raw?.enabled === true, keys };
    this.apply();
    return this.states;
  }

  /** let the Settings page record a combination without setting off the current shortcut */
  pause(paused: boolean): Partial<Record<GlobalCommand, GlobalKeyState>> {
    this.paused = paused;
    this.apply();
    return this.states;
  }

  private apply(): void {
    globalShortcut.unregisterAll();
    this.states = {};
    if (!this.config.enabled) return;
    const combos = globalKeysFor(this.config);
    for (const { id } of GLOBAL_COMMANDS) {
      if (!combos[id]) continue;
      const accelerator = toAccelerator(combos[id]);
      if (!accelerator) {
        this.states[id] = "invalid";
        continue;
      }
      if (this.paused) {
        this.states[id] = "ok";
        continue;
      }
      try {
        this.states[id] = globalShortcut.register(accelerator, () => this.run(id)) ? "ok" : "taken";
      } catch {
        this.states[id] = "invalid";
      }
    }
  }

  dispose(): void {
    globalShortcut.unregisterAll();
  }
}
