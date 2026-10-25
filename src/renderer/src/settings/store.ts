import { create } from "zustand";
import { DEFAULT_EQ, type EqSettings } from "@/audio/eq";

export interface Settings {
  /** 0 means songs follow each other without a gap */
  crossfadeSeconds: number;
  /** when off, songs from the same album play back to back without fading */
  crossfadeSameAlbum: boolean;
  /** play every song at about the same loudness */
  levelling: boolean;
  eq: EqSettings;
  lyricsSize: "small" | "medium" | "large";
  miniPlayer: { showOnMinimize: boolean };
  discord: { enabled: boolean; clientId: string; showWhenPaused: boolean };
  /** a desktop notification when an artist you listen to puts out something new */
  releaseAlerts: boolean;
  /** Liquid Glass look: clear lets more of the picture through, tinted is easier to read */
  glass: "clear" | "tinted";
}

const STORAGE_KEY = "encore.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  crossfadeSeconds: 0,
  crossfadeSameAlbum: false,
  levelling: true,
  eq: DEFAULT_EQ,
  lyricsSize: "medium",
  miniPlayer: { showOnMinimize: false },
  discord: { enabled: false, clientId: "", showWhenPaused: false },
  releaseAlerts: true,
  glass: "clear",
};

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      eq: { ...DEFAULT_SETTINGS.eq, ...saved.eq },
      miniPlayer: { ...DEFAULT_SETTINGS.miniPlayer, ...saved.miniPlayer },
      discord: { ...DEFAULT_SETTINGS.discord, ...saved.discord },
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

function persist(state: SettingsStore): void {
  const { update: _u, updateEq: _e, ...settings } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // settings simply won't survive a restart
  }
}
