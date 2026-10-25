/** lowercase without accents, for forgiving filters */
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}
