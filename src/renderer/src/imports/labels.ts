import type { ImportDestination, ImportOrigin } from "@shared/types";

export const ORIGIN_LABEL: Record<ImportOrigin, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  youtube: "YouTube Music",
  csv: "CSV file",
  encore: "Encore",
};

/** small colour cue per service, as a CSS colour */
export const ORIGIN_COLOR: Record<ImportOrigin, string> = {
  spotify: "#1ed760",
  apple: "#fa586a",
  youtube: "#ff4e45",
  csv: "#a1a1aa",
  encore: "var(--color-accent)",
};

export function destinationLabel(destination: ImportDestination): string {
  return destination.kind === "liked" ? "Liked Songs" : `New playlist "${destination.name}"`;
}

/** which service a pasted link belongs to, for a hint while typing */
export function guessService(text: string): ImportOrigin | null {
  if (/spotify\.com|^spotify:/i.test(text)) return "spotify";
  if (/music\.apple\.com|itunes\.apple\.com/i.test(text)) return "apple";
  if (/youtube\.com|youtu\.be/i.test(text)) return "youtube";
  return null;
}

export function yearRange(firstAt?: string, lastAt?: string): string {
  if (!firstAt || !lastAt) return "";
  const a = new Date(firstAt);
  const b = new Date(lastAt);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
}
