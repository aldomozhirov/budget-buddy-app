/** Envelope months: `YYYY-MM` keys in the family's time zone (COR-2). */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Splits a `YYYY-MM` month into its year and month number.
 * @throws {RangeError} if `month` is not a valid `YYYY-MM` month.
 */
function parseMonth(month: string): [number, number] {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new RangeError(`Expected a YYYY-MM month: ${month}`);
  return [Number(match[1]), Number(match[2])];
}

/**
 * Adds whole months (negative to go back) to a `YYYY-MM` month.
 * @example addMonths('2026-12', 1) // '2027-01'
 * @throws {RangeError} if `month` is not a valid `YYYY-MM` month.
 */
export function addMonths(month: string, months: number): string {
  const [year, number] = parseMonth(month);
  const index = year * 12 + (number - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextNumber = index - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextNumber).padStart(2, '0')}`;
}

/**
 * The `YYYY-MM` month of a `YYYY-MM-DD` date.
 * @example monthOfDate('2026-10-13') // '2026-10'
 * @throws {RangeError} if `date` does not start with a valid month.
 */
export function monthOfDate(date: string): string {
  const month = date.slice(0, 7);
  parseMonth(month);
  return month;
}

/**
 * Lists every month from `from` to `to`, both included, oldest first; an
 * empty list when `to` is before `from`.
 * @throws {RangeError} if either is not a valid `YYYY-MM` month.
 */
export function monthsBetween(from: string, to: string): string[] {
  parseMonth(to);
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}
