/** lowercase without accents, for forgiving filters */
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

/** every word of the query appears somewhere in the fields, ignoring case and accents */
export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(fields.filter(Boolean).join(" "));
  return words.every((word) => text.includes(word));
}

/** for sorting by name: case-insensitive, and "Track 2" before "Track 10" */
export const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
