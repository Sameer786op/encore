import { create } from "zustand";
import { GLOBAL_COMMANDS, globalKeysFor, parseCombo, type GlobalCommand, type GlobalKeyState } from "@shared/shortcuts";
import { SEARCH_INPUT_ID } from "@/components/TopBar";
import { useLibrary } from "@/library/store";
import { navigate, useNav } from "@/nav/store";
import { currentItem } from "@/player/queue";
import { usePlayer } from "@/player/store";
import { useSettings } from "@/settings/store";
import { isTyping } from "@/lib/cn";
import { openModal } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { useView } from "@/ui/view";

// Every keyboard shortcut in the app, with the keys it starts on. People can
// change any of them in Settings; their changes are kept in settings.shortcuts.

export type ShortcutGroup = "Playback" | "Volume" | "View" | "Go to";

export interface ShortcutCommand {
  id: string;
  label: string;
  group: ShortcutGroup;
  keys: string[];
  run(): void;
  /** also works while typing in a text box */
  whileTyping?: boolean;
  /** plain arrow keys belong to a focused slider */
  notOnSliders?: boolean;
}

const player = () => usePlayer.getState();

function toggleLikeCurrent(): void {
  const track = currentItem(player().queue)?.track;
  if (!track) return;
  const liked = !useLibrary.getState().likedIds.has(track.id);
  void useLibrary.getState().setLiked(track, liked);
  toast(liked ? `Added "${track.title}" to Liked Songs` : `Removed "${track.title}" from Liked Songs`);
}

export const COMMANDS: ShortcutCommand[] = [
  { id: "playPause", label: "Play or pause", group: "Playback", keys: ["Space"], run: () => player().togglePlay() },
  { id: "next", label: "Next song", group: "Playback", keys: ["Ctrl+ArrowRight"], run: () => player().next() },
  { id: "previous", label: "Previous song", group: "Playback", keys: ["Ctrl+ArrowLeft"], run: () => player().previous() },
  { id: "seekForward", label: "Skip ahead 5 seconds", group: "Playback", keys: ["ArrowRight"], notOnSliders: true, run: () => player().seek(player().position + 5) },
  { id: "seekBack", label: "Go back 5 seconds", group: "Playback", keys: ["ArrowLeft"], notOnSliders: true, run: () => player().seek(player().position - 5) },
  { id: "shuffle", label: "Shuffle on or off", group: "Playback", keys: ["Ctrl+S"], run: () => player().toggleShuffle() },
  { id: "repeat", label: "Repeat", group: "Playback", keys: ["Ctrl+R"], run: () => player().cycleRepeat() },
  { id: "like", label: "Like the song that's playing", group: "Playback", keys: ["Ctrl+Shift+L"], run: toggleLikeCurrent },
  { id: "volumeUp", label: "Volume up", group: "Volume", keys: ["Ctrl+ArrowUp"], run: () => player().setVolume(player().volume + 0.05) },
  { id: "volumeDown", label: "Volume down", group: "Volume", keys: ["Ctrl+ArrowDown"], run: () => player().setVolume(player().volume - 0.05) },
  { id: "mute", label: "Mute", group: "Volume", keys: ["M"], run: () => player().toggleMute() },
  { id: "queue", label: "Show the queue", group: "View", keys: ["Q"], run: () => player().setQueueOpen(!player().queueOpen) },
  {
    id: "lyrics",
    label: "Show lyrics",
    group: "View",
    keys: ["L"],
    run: () => {
      const view = useView.getState();
      if (view.fullscreen && view.lyrics) view.closeFullscreen();
      else view.openFullscreen(true);
    },
  },
  {
    id: "nowPlaying",
    label: "Full-screen player",
    group: "View",
    keys: ["F"],
    run: () => {
      const view = useView.getState();
      if (view.fullscreen) view.closeFullscreen();
      else view.openFullscreen();
    },
  },
  { id: "mini", label: "Mini player", group: "View", keys: [], run: () => void (useView.getState().miniOpen ? window.encore.mini.close() : window.encore.mini.open()) },
  { id: "fullScreen", label: "Full-screen window", group: "View", keys: ["F11"], whileTyping: true, run: () => void window.encore.app.toggleFullScreen() },
  {
    id: "search",
    label: "Search",
    group: "Go to",
    keys: ["Ctrl+K", "Ctrl+L"],
    whileTyping: true,
    run: () => {
      // the search box lives in the top bar, so it is always there to focus
      const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
      input?.focus();
      input?.select();
      navigate({ name: "search" });
    },
  },
  {
    id: "settings",
    label: "Settings",
    group: "Go to",
    keys: ["Ctrl+,"],
    whileTyping: true,
    run: () => {
      useView.getState().closeFullscreen();
      navigate({ name: "settings" });
    },
  },
  { id: "back", label: "Back", group: "Go to", keys: ["Alt+ArrowLeft"], whileTyping: true, run: () => useNav.getState().back() },
  { id: "forward", label: "Forward", group: "Go to", keys: ["Alt+ArrowRight"], whileTyping: true, run: () => useNav.getState().forward() },
  { id: "newPlaylist", label: "New playlist", group: "Go to", keys: ["Ctrl+N"], run: () => openModal({ kind: "create-playlist" }) },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = ["Playback", "Volume", "View", "Go to"];

/** the keys each command answers to, after the changes made in Settings */
export function keysFor(overrides: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(COMMANDS.map((c) => [c.id, overrides[c.id] ?? c.keys]));
}

// physical keys, so a shortcut means the same key whatever Shift does to it
const CODE_KEYS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: "Space",
};
const NAMED = new Set(["Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** the combination a key press makes, like "Ctrl+Shift+L"; null for a lone modifier or an unknown key */
export function comboOf(event: KeyboardEvent): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (CODE_KEYS[event.code]) key = CODE_KEYS[event.code];
  else if (NAMED.has(event.key) || /^F([1-9]|1\d|2[0-4])$/.test(event.key)) key = event.key;
  if (!key) return null;
  const modifiers = [event.ctrlKey || event.metaKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  return [...modifiers, key].join("+");
}

const KEY_LABELS: Record<string, string> = { ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down" };

/** the keys of a combination, ready to show: ["Ctrl", "→"] */
export function comboParts(combo: string): string[] {
  const parsed = parseCombo(combo);
  if (!parsed) return [combo];
  return [...parsed.modifiers, KEY_LABELS[parsed.key] ?? parsed.key];
}

/** tooltips that show each command's current keys, like "Shuffle (Ctrl+S)" */
export function useHints(): (id: string, name: string) => string {
  const keys = keysFor(useSettings((s) => s.shortcuts));
  return (id, name) => (keys[id]?.[0] ? `${name} (${comboParts(keys[id][0]).join("+")})` : name);
}

/** the label of the command a combination already belongs to, if any */
export function commandUsing(combo: string, overrides: Record<string, string[]>, except?: string): ShortcutCommand | undefined {
  const keys = keysFor(overrides);
  return COMMANDS.find((c) => c.id !== except && keys[c.id].includes(combo));
}

const REPEATABLE = new Set(["volumeUp", "volumeDown", "seekForward", "seekBack"]);

export function connectShortcuts(): () => void {
  let byCombo = new Map<string, ShortcutCommand>();
  const rebuild = (overrides: Record<string, string[]>) => {
    const keys = keysFor(overrides);
    byCombo = new Map();
    for (const command of COMMANDS) for (const combo of keys[command.id]) if (!byCombo.has(combo)) byCombo.set(combo, command);
  };
  rebuild(useSettings.getState().shortcuts);
  const stopSettings = useSettings.subscribe((s, before) => s.shortcuts !== before.shortcuts && rebuild(s.shortcuts));

  const onKey = (event: KeyboardEvent) => {
    const combo = comboOf(event);
    const command = combo ? byCombo.get(combo) : undefined;
    if (!command) return;
    // in a text box only Ctrl, Alt and F-key shortcuts get through, so a plain letter still types
    if (isTyping(event.target) && !(command.whileTyping && (event.ctrlKey || event.metaKey || event.altKey || /^F\d/.test(event.key)))) return;
    if (command.notOnSliders && (event.target as HTMLElement | null)?.getAttribute?.("role") === "slider") return;
    event.preventDefault();
    // holding a key down only repeats the steps that make sense to repeat
    if (event.repeat && !REPEATABLE.has(command.id)) return;
    command.run();
  };
  // mouse back / forward buttons
  const onMouse = (event: MouseEvent) => {
    if (event.button === 3) useNav.getState().back();
    if (event.button === 4) useNav.getState().forward();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("mouseup", onMouse);
  return () => {
    stopSettings();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("mouseup", onMouse);
  };
}

// ---- shortcuts that work anywhere in Windows ----

export const useGlobalKeyStates = create<{ states: Partial<Record<GlobalCommand, GlobalKeyState>> }>(() => ({ states: {} }));

const GLOBAL_RUN: Record<Exclude<GlobalCommand, "mini" | "show">, () => void> = {
  playPause: () => player().togglePlay(),
  next: () => player().next(),
  previous: () => player().previous(),
  volumeUp: () => player().setVolume(player().volume + 0.05),
  volumeDown: () => player().setVolume(player().volume - 0.05),
  like: toggleLikeCurrent,
};

/** let Settings record a combination that Encore itself has registered, then put the shortcuts back */
export function pauseGlobalKeys(paused: boolean): void {
  void window.encore.app.pauseGlobalKeys(paused).then((states) => useGlobalKeyStates.setState({ states }));
}

/** register the global shortcuts with the main process, and carry them out when pressed */
export function connectGlobalKeys(): () => void {
  const push = () => {
    const { globalKeys } = useSettings.getState();
    void window.encore.app.setGlobalKeys(globalKeys).then((states) => useGlobalKeyStates.setState({ states }));
  };
  push();
  // settings reloaded from storage are new objects even when nothing changed
  const stopSettings = useSettings.subscribe((s, before) => JSON.stringify(s.globalKeys) !== JSON.stringify(before.globalKeys) && push());
  const stopCommands = window.encore.app.onGlobalCommand((command) => {
    if (command in GLOBAL_RUN) GLOBAL_RUN[command as keyof typeof GLOBAL_RUN]();
  });
  return () => {
    stopSettings();
    stopCommands();
  };
}

export { GLOBAL_COMMANDS, globalKeysFor };
