// The moods you can start a mix for. Each is tuned by YouTube Music itself:
// `code` picks its mood-tuned radio for a song ("RDAT" + code + video id),
// `tags` are the tuning chips that mark a song of yours as suiting the mood,
// and `page` is its Moods & moments page, for when there's no history yet.

export const MOOD_IDS = ["chill", "energize", "focus", "warm", "feel-good", "party", "workout", "sad", "sleep"] as const;

export type MoodId = (typeof MOOD_IDS)[number];

export interface Mood {
  id: MoodId;
  name: string;
  code: string;
  tags: string[];
  page: string;
  /** the orb's colours, light to deep */
  colors: [string, string, string];
}

export const MOODS: Mood[] = [
  { id: "chill", name: "Chill", code: "mXv", tags: ["Chill"], page: "Chill", colors: ["#9ff3e6", "#3fa7d6", "#5b4bb7"] },
  { id: "energize", name: "Energize", code: "mYv", tags: ["Pump-up", "Workout", "Party", "Upbeat"], page: "Energize", colors: ["#ffe27a", "#ff7a3d", "#e5265e"] },
  { id: "focus", name: "Focus", code: "mav", tags: ["Focus"], page: "Focus", colors: ["#c9f7a6", "#38b98a", "#1d5f73"] },
  { id: "warm", name: "Warm", code: "mdv", tags: ["Romance"], page: "Romance", colors: ["#ffd6a0", "#ff8a7a", "#c2416f"] },
  { id: "feel-good", name: "Feel good", code: "mbv", tags: ["Upbeat", "Party"], page: "Feel good", colors: ["#fff3a3", "#ffc14d", "#ff6f91"] },
  { id: "party", name: "Party", code: "mev", tags: ["Party"], page: "Party", colors: ["#ffa6f0", "#d63bd6", "#5a2bd9"] },
  { id: "workout", name: "Workout", code: "mZv", tags: ["Workout", "Pump-up"], page: "Workout", colors: ["#ffcf6b", "#ff4b2b", "#9c1c3c"] },
  { id: "sad", name: "Sad", code: "mcv", tags: ["Downbeat"], page: "Sad", colors: ["#b9c9e8", "#5a73b0", "#27305e"] },
  { id: "sleep", name: "Sleep", code: "mfv", tags: ["Sleep"], page: "Sleep", colors: ["#c3b8ff", "#5d5fd6", "#1c1f5c"] },
];

export const isMoodId = (value: unknown): value is MoodId => typeof value === "string" && (MOOD_IDS as readonly string[]).includes(value);

export const moodById = (id: MoodId): Mood => MOODS.find((m) => m.id === id)!;
