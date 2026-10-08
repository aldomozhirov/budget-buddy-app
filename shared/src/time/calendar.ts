import { addDays, endOfDay, format, subDays } from 'date-fns';
import { TZDate } from '@date-fns/tz';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a YYYY-MM-DD date as noon on that day in `timeZone`, so DST changes
 * never shift it onto another day.
 * @throws {RangeError} if `date` is malformed or not a real calendar date,
 * or `timeZone` is unknown.
 */
function parseLocalDate(date: string, timeZone: string): TZDate {
  if (!DATE_PATTERN.test(date)) throw new RangeError(`Expected a YYYY-MM-DD date: ${date}`);
  const [yearString, monthString, dayString] = date.split('-');
  const year = Number.parseInt(yearString ?? '', 10);
  const month = Number.parseInt(monthString ?? '', 10);
  const day = Number.parseInt(dayString ?? '', 10);
  const result = new TZDate(year, month - 1, day, 12, 0, 0, 0, timeZone);
  if (format(result, 'yyyy-MM-dd') !== date) throw new RangeError(`Invalid calendar date: ${date}`);
  return result;
}

/**
 * Returns the YYYY-MM-DD calendar date of an instant in `timeZone`.
 * @throws {RangeError} if `timeZone` is unknown.
 */
export function todayInTimeZone(now: Date, timeZone: string): string {
  return format(new TZDate(now.getTime(), timeZone), 'yyyy-MM-dd');
}

/**
 * Returns the final millisecond of a YYYY-MM-DD date in `timeZone`, allowing
 * for 23- and 25-hour days at DST changes.
 * @throws {RangeError} if `date` is not a valid YYYY-MM-DD date or
 * `timeZone` is unknown.
 */
export function endOfLocalDay(date: string, timeZone: string): Date {
  return endOfDay(parseLocalDate(date, timeZone));
}

/**
 * Formats an instant, or a YYYY-MM-DD calendar date, as DD/MM/YYYY in
 * `timeZone`.
 * @example
 * formatDate(new Date('2026-09-30T23:30:00Z'), 'Europe/Berlin');
 * // '01/10/2026'
 * @throws {RangeError} if a string `date` is not a valid YYYY-MM-DD date or
 * `timeZone` is unknown.
 */
export function formatDate(date: Date | string, timeZone: string): string {
  const zoned = typeof date === 'string' ? parseLocalDate(date, timeZone) : new TZDate(date.getTime(), timeZone);
  return format(zoned, 'dd/MM/yyyy');
}

/**
 * Formats a date as `'Today'` or `'Yesterday'` relative to `now` in
 * `timeZone`, and any other date (future ones too) as DD/MM/YYYY.
 * @param date An instant, or a YYYY-MM-DD calendar date.
 * @throws {RangeError} if a string `date` is not a valid YYYY-MM-DD date or
 * `timeZone` is unknown.
 */
export function formatRecentDate(date: Date | string, now: Date, timeZone: string): string {
  const targetDate = typeof date === 'string' ? date : format(new TZDate(date.getTime(), timeZone), 'yyyy-MM-dd');
  const today = todayInTimeZone(now, timeZone);
  if (targetDate === today) return 'Today';
  const yesterday = format(subDays(parseLocalDate(today, timeZone), 1), 'yyyy-MM-dd');
  if (targetDate === yesterday) return 'Yesterday';
  return formatDate(targetDate, timeZone);
}

/**
 * Adds calendar days (negative to go back) to a YYYY-MM-DD date.
 * @throws {RangeError} if `date` is not a valid YYYY-MM-DD date or
 * `timeZone` is unknown.
 */
export function addLocalDays(date: string, days: number, timeZone: string): string {
  return format(addDays(parseLocalDate(date, timeZone), days), 'yyyy-MM-dd');
}

/**
 * Compares two YYYY-MM-DD dates, returning -1, 0 or 1 for sorting.
 * @throws {RangeError} if either is not a valid YYYY-MM-DD date.
 */
export function compareLocalDates(left: string, right: string): number {
  if (!DATE_PATTERN.test(left) || !DATE_PATTERN.test(right)) throw new RangeError('Expected YYYY-MM-DD dates');
  parseLocalDate(left, 'UTC');
  parseLocalDate(right, 'UTC');
  return left < right ? -1 : left > right ? 1 : 0;
}
