/** One cell of a CSV row: text, a number, a big integer, or empty. */
export type CsvCell = string | number | bigint | null;

/** Quotes a cell when it holds a comma, a quote or a line break (RFC 4180). */
function escapeCell(cell: CsvCell): string {
  if (cell === null) return '';
  const text = typeof cell === 'string' ? cell : cell.toString();
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Writes rows as CSV text: a header line, then one line per row, all ended
 * by CRLF as RFC 4180 says. Cells are written as given; nothing is rounded
 * or reformatted here.
 */
export function toCsv(
  header: readonly string[],
  rows: Iterable<readonly CsvCell[]>,
): string {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
