/**
 * A CSV reader that survives what dealers actually send.
 *
 * NO DEPENDENCY, AND NO `split(',')`. The Malabar file from CarsForSale is
 * twenty-one vehicles in 137KB because one `Description` column holds markdown
 * with newlines in it and one `images` column holds forty URLs. Splitting on
 * commas turns that file into several hundred garbage rows, every one of which
 * looks plausible enough to import. This is RFC 4180 with the three real-world
 * concessions below, and it is tested against that file.
 *
 *   - **BOM.** Excel writes one. Left in place it becomes part of the first
 *     header name, so `"﻿VIN"` never matches `VIN` and the most important
 *     column in the file silently fails to map.
 *   - **CRLF, LF, and mixed.** A file edited on two machines has both.
 *   - **Ragged rows.** Short rows fill with empty strings, long rows keep the
 *     overflow under a numbered key rather than throwing the row away — a
 *     trailing stray comma should not cost somebody a vehicle.
 *
 * Pure and synchronous. No database, no file system: the caller supplies text.
 */

export type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
  /** Rows whose field count did not match the header row, by 1-based line. */
  ragged: { line: number; got: number; expected: number }[];
};

/** Split one CSV document into a grid of raw cells. */
function toGrid(input: string): string[][] {
  // Strip the BOM before anything else looks at character zero.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        // A doubled quote is a literal quote; a lone one closes the field.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF or a bare CR, both end the row.
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // A file that does not end in a newline still has a last row — unless the
  // whole tail is empty, which is what a trailing newline leaves behind.
  if (field !== '' || row.length > 0) endRow();

  return grid;
}

export function parseCsv(input: string): CsvTable {
  const grid = toGrid(input).filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
  if (grid.length === 0) return { headers: [], rows: [], ragged: [] };

  const headers = grid[0]!.map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  const ragged: CsvTable['ragged'] = [];

  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r]!;
    if (cells.length !== headers.length) {
      ragged.push({ line: r + 1, got: cells.length, expected: headers.length });
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, c) => {
      obj[h] = (cells[c] ?? '').trim();
    });
    // Overflow cells are kept rather than dropped, so a stray comma is visible
    // in the preview instead of quietly eating the end of a description.
    for (let c = headers.length; c < cells.length; c += 1) {
      obj[`__extra_${c}`] = (cells[c] ?? '').trim();
    }
    rows.push(obj);
  }

  return { headers, rows, ragged };
}
