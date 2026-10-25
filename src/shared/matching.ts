/** above this, with a solid title and artist, a match is taken without asking */
export const CONFIDENT = 0.82;
/** above this a match is shown for review; below it the song counts as not found */
export const PLAUSIBLE = 0.55;

/** a rough verdict from the score alone, for places that don't have the full comparison */
export function classifyScore(score: number): "matched" | "review" | "missing" {
  return score >= CONFIDENT ? "matched" : score >= PLAUSIBLE ? "review" : "missing";
}
