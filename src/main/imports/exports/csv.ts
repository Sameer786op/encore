/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** rows as objects keyed by lowercased header, starting at `headerRow` */
export function csvObjects(rows: string[][], headerRow = 0): Record<string, string>[] {
  const header = (rows[headerRow] ?? []).map(normalizeHeader);
  return rows.slice(headerRow + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** the first non-empty value among several possible column names */
export function pick(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value) return value;
  }
  return "";
}

export function hasColumn(rows: Record<string, string>[], names: string[]): boolean {
  const first = rows[0];
  return !!first && names.some((n) => normalizeHeader(n) in first);
}
