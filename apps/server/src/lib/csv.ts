import { parse } from "csv-parse/sync";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** Pick the delimiter that splits the header line into the most columns (Excel pt-BR exports use ";"). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of ["\t", ";", ","]) {
    const n = firstLine.split(d).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export function parseTable(text: string): ParsedTable {
  const records = parse(text, {
    delimiter: detectDelimiter(text),
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
    max_record_size: 64 * 1024,
  }) as string[][];
  const [headers = [], ...rows] = records;
  return { headers, rows: rows.filter((r) => r.some((cell) => cell !== "")) };
}
