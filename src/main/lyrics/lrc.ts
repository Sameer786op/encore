import type { LyricLine } from "@shared/types";

// LRC: "[01:23.45] a line of lyrics". A line may carry several timestamps
// (repeated choruses), and an "[offset:+250]" tag shifts everything.

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]/im;
/** a line that only marks a pause in the singing */
export const INTERLUDE = "♪";

export function parseLrc(text: string): LyricLine[] {
  const offsetMs = Number(text.match(OFFSET)?.[1] ?? 0);
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIME)];
    if (stamps.length === 0) continue;
    const words = raw.replace(TIME, "").replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3]) / 10 ** stamp[3].length : 0;
      // a positive offset means the lyrics come early, so lines move earlier
      const time = Number(stamp[1]) * 60 + Number(stamp[2]) + fraction - offsetMs / 1000;
      lines.push({ time: Math.max(0, Math.round(time * 1000) / 1000), text: words || INTERLUDE });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  // drop doubled interlude markers and a leading one at 0:00
  return lines.filter((line, i) => !(line.text === INTERLUDE && (i === 0 ? line.time === 0 : lines[i - 1].text === INTERLUDE)));
}

/** true when lyrics are only "instrumental" placeholders */
export function isInstrumental(lines: LyricLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.text === INTERLUDE || /^\(?instrumental\)?$/i.test(l.text));
}
