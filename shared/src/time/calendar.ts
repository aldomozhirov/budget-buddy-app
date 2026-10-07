import { addDays, endOfDay, format, subDays } from 'date-fns';
import { TZDate } from '@date-fns/tz';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export function todayInTimeZone(now: Date, timeZone: string): string {
  return format(new TZDate(now.getTime(), timeZone), 'yyyy-MM-dd');
}

/** The final millisecond of the given calendar date in the configured zone. */
export function endOfLocalDay(date: string, timeZone: string): Date {
  return endOfDay(parseLocalDate(date, timeZone));
}

export function formatDate(date: Date | string, timeZone: string): string {
  const zoned = typeof date === 'string' ? parseLocalDate(date, timeZone) : new TZDate(date.getTime(), timeZone);
  return format(zoned, 'dd/MM/yyyy');
}

export function formatRecentDate(date: Date | string, now: Date, timeZone: string): string {
  const targetDate = typeof date === 'string' ? date : format(new TZDate(date.getTime(), timeZone), 'yyyy-MM-dd');
  const today = todayInTimeZone(now, timeZone);
  if (targetDate === today) return 'Today';
  const yesterday = format(subDays(parseLocalDate(today, timeZone), 1), 'yyyy-MM-dd');
  if (targetDate === yesterday) return 'Yesterday';
  return formatDate(targetDate, timeZone);
}

export function addLocalDays(date: string, days: number, timeZone: string): string {
  return format(addDays(parseLocalDate(date, timeZone), days), 'yyyy-MM-dd');
}

export function compareLocalDates(left: string, right: string): number {
  if (!DATE_PATTERN.test(left) || !DATE_PATTERN.test(right)) throw new RangeError('Expected YYYY-MM-DD dates');
  parseLocalDate(left, 'UTC');
  parseLocalDate(right, 'UTC');
  return left < right ? -1 : left > right ? 1 : 0;
}
