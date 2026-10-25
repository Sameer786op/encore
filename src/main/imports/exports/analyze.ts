import { basename } from "node:path";
import { looksLikeApple, parseApple } from "./apple";
import { openExport } from "./files";
import { parseGenericCsv } from "./genericCsv";
import { looksLikeSpotify, parseSpotify } from "./spotify";
import { looksLikeTakeout, parseTakeout } from "./takeout";
import type { ParsedExport } from "./types";

export class UnrecognizedExportError extends Error {}

/** read whatever export the user picked; several services in one folder are merged */
export async function readExport(path: string): Promise<ParsedExport> {
  const { files, close } = await openExport(path);
  try {
    const parts: ParsedExport[] = [];
    if (looksLikeSpotify(files)) parts.push(await parseSpotify(files));
    if (looksLikeTakeout(files)) parts.push(await parseTakeout(files));
    if (looksLikeApple(files)) parts.push(await parseApple(files));
    if (parts.length === 0) {
      for (const csv of files.filter((f) => /\.csv$/i.test(f.name))) {
        const parsed = await parseGenericCsv(csv);
        if (parsed) parts.push(parsed);
      }
    }
    if (parts.length === 0) {
      throw new UnrecognizedExportError(
        `"${basename(path)}" doesn't look like a Spotify, Google Takeout or Apple Music export, or a playlist CSV.`,
      );
    }
    const [first, ...rest] = parts;
    for (const part of rest) {
      first.plays.push(...part.plays.map((play) => ({ ...play, origin: part.origin })));
      first.collections.push(...part.collections);
      first.warnings.push(...part.warnings);
      first.hasListeningTime &&= part.hasListeningTime;
    }
    return first;
  } finally {
    close();
  }
}
