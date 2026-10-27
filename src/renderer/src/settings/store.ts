import { create } from "zustand";
import type { GlobalKeysConfig } from "@shared/shortcuts";
import type { MiniConfig } from "@shared/types";
import { DEFAULT_EQ, type EqSettings } from "@/audio/eq";

export interface Settings {
  /** 0 means songs follow each other without a gap */
  crossfadeSeconds: number;
  /** when off, songs from the same album play back to back without fading */
  crossfadeSameAlbum: boolean;
  /** play every song at about the same loudness */
  levelling: boolean;
  /** play songs exactly as they come: the EQ, levelling, speed and reverb step aside (and keep their settings) */
  pureSound: boolean;
  eq: EqSettings;
  /** playback speed (1 is normal), whether the key stays put when it changes, and reverb from 0 to 1 */
  sound: { speed: number; keepPitch: boolean; reverb: number };
  lyricsSize: "small" | "medium" | "large";
  /**
   * a line of light round the window while the full-screen player shows lyrics:
   * colours is a preset id from visuals/edgeColors, "rainbow", "artwork" or "custom";
   * speed and glow go from 0 to 100; pulse swells it with the bass
   */
  edgeLight: { enabled: boolean; colors: string; custom: [string, string]; speed: number; glow: number; pulse: boolean };
  miniPlayer: MiniConfig;
  discord: { enabled: boolean; clientId: string; showWhenPaused: boolean };
  /** a desktop notification when an artist you listen to puts out something new */
  releaseAlerts: boolean;
  /** Liquid Glass look: clear lets more of the picture through, tinted is easier to read, custom is set per area */
  glass: "clear" | "tinted" | "custom";
  /** with custom glass: how see-through (0-100) and how blurred (px) each area is */
  glassAreas: Record<GlassArea, { opacity: number; blur: number }>;
  theme: "dark" | "light" | "system";
  /** a preset id from ui/colors, or "custom" for customAccent */
  accent: string;
  customAccent: string;
  /** what fills the window behind everything: Ember's glows or Moss's floor, the playing cover, a picture of your own, or a plain colour */
  background: "signature" | "artwork" | "wallpaper" | "plain";
  /** blur in px and dim from 0 to 1, for the artwork wash and for a wallpaper */
  artworkLook: { blur: number; dim: number };
  wallpaper: { url: string | null; blur: number; dim: number };
  /** closing the window while music plays keeps it going from the system tray */
  backgroundPlay: boolean;
  /** music that was playing when the app closed carries on from the same spot when it opens */
  continueOnOpen: boolean;
  /** pause when the headphones or speakers being played on are disconnected */
  pauseOnUnplug: boolean;
  /** what double-clicking (or pressing Enter on) a song in a list does */
  doubleClick: "play" | "queue";
  /** keyboard shortcuts changed from their defaults, by command id (ui/shortcuts); [] turns one off */
  shortcuts: Record<string, string[]>;
  /** shortcuts that work while Vyse Music is in the background */
  globalKeys: GlobalKeysConfig;
  /** which look these settings were last saved under; 2 is Ember & Moss */
  lookVersion: number;
}

export type GlassArea = "sidebar" | "player" | "panels";

const STORAGE_KEY = "encore.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  crossfadeSeconds: 0,
  crossfadeSameAlbum: false,
  levelling: true,
  pureSound: false,
  eq: DEFAULT_EQ,
  sound: { speed: 1, keepPitch: false, reverb: 0 },
  lyricsSize: "medium",
  edgeLight: { enabled: true, colors: "neon", custom: ["#ff2fd0", "#3a8bff"], speed: 50, glow: 50, pulse: true },
  miniPlayer: { showOnMinimize: false, alwaysOnTop: true, corner: "remember" },
  discord: { enabled: false, clientId: "", showWhenPaused: false },
  releaseAlerts: true,
  glass: "clear",
  glassAreas: {
    sidebar: { opacity: 30, blur: 22 },
    player: { opacity: 30, blur: 22 },
    panels: { opacity: 30, blur: 22 },
  },
  theme: "dark",
  accent: "ember",
  customAccent: "#ff5a1f",
  background: "signature",
  artworkLook: { blur: 90, dim: 0.58 },
  wallpaper: { url: null, blur: 0, dim: 0.3 },
  backgroundPlay: true,
  continueOnOpen: true,
  pauseOnUnplug: true,
  doubleClick: "play",
  shortcuts: {},
  globalKeys: { enabled: true, keys: {} },
  lookVersion: 2,
};

/** settings saved before Ember & Moss move to its accent and backdrop once; a picture of your own or a plain colour stays */
function upgradeLook(saved: Partial<Settings>): Partial<Settings> {
  if (Object.keys(saved).length === 0 || (saved.lookVersion ?? 1) >= 2) return saved;
  return {
    ...saved,
    accent: "ember",
    background: saved.background === "wallpaper" || saved.background === "plain" ? saved.background : "signature",
    lookVersion: 2,
  };
}

function load(): Settings {
  try {
    const saved = upgradeLook(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>);
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      eq: { ...DEFAULT_SETTINGS.eq, ...saved.eq },
      sound: { ...DEFAULT_SETTINGS.sound, ...saved.sound },
      edgeLight: { ...DEFAULT_SETTINGS.edgeLight, ...saved.edgeLight },
      miniPlayer: { ...DEFAULT_SETTINGS.miniPlayer, ...saved.miniPlayer },
      discord: { ...DEFAULT_SETTINGS.discord, ...saved.discord },
      glassAreas: {
        sidebar: { ...DEFAULT_SETTINGS.glassAreas.sidebar, ...saved.glassAreas?.sidebar },
        player: { ...DEFAULT_SETTINGS.glassAreas.player, ...saved.glassAreas?.player },
        panels: { ...DEFAULT_SETTINGS.glassAreas.panels, ...saved.glassAreas?.panels },
      },
      artworkLook: { ...DEFAULT_SETTINGS.artworkLook, ...saved.artworkLook },
      wallpaper: { ...DEFAULT_SETTINGS.wallpaper, ...saved.wallpaper },
      shortcuts: { ...saved.shortcuts },
      globalKeys: { ...DEFAULT_SETTINGS.globalKeys, ...saved.globalKeys, keys: { ...saved.globalKeys?.keys } },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsStore extends Settings {
  update(patch: Partial<Settings>): void;
  updateEq(patch: Partial<EqSettings>): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    persist(get());
  },
  updateEq(patch) {
    set({ eq: { ...get().eq, ...patch } });
    persist(get());
  },
}));

// the mini player window shares this storage; it hears about changes made in the main window
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) useSettings.setState(load());
  });
}

function persist(state: SettingsStore): void {
  const { update: _u, updateEq: _e, ...settings } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // settings simply won't survive a restart
  }
}
