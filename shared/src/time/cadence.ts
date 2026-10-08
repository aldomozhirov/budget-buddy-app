import { addMonths, endOfMonth, format } from 'date-fns';
import { TZDate } from '@date-fns/tz';
import { addLocalDays, compareLocalDates, todayInTimeZone } from './calendar.js';

/**
 * A recurring schedule at a local wall time `time` (24-hour `HH:mm`).
 * - `monthly`: on `day` 1-31 of each month, clamped to the month's last day,
 *   or on its last day with `'last'`.
 * - `weeks`: on ISO `weekday` (1 = Monday to 7 = Sunday) every `every` weeks
 *   (1-8), starting with the first such weekday on or after `anchorDate`
 *   (YYYY-MM-DD).
 */
export type Cadence =
  | { readonly kind: 'monthly'; readonly day: number | 'last'; readonly time: string }
  | { readonly kind: 'weeks'; readonly every: number; readonly weekday: number; readonly anchorDate: string; readonly time: string };

/** One scheduled occurrence of a cadence. */
export interface ScheduleSlot {
  /**
   * Scheduled local date and time, `YYYY-MM-DDTHH:mm`, as requested; it stays
   * the same when a DST gap moves the instant.
   */
  readonly key: string;
  readonly instant: Date;
}

/** Wall-clock fields in some time zone; `month` is 1-based. */
interface LocalDateTime { year: number; month: number; day: number; hour: number; minute: number }

/** Reads the wall-clock date and time of an instant in `timeZone`. */
function localParts(instant: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number.parseInt(parts.find((part) => part.type === type)?.value ?? '', 10);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

function sameMinute(left: LocalDateTime, right: LocalDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

/**
 * Finds the earliest instant whose wall time in `timeZone` is `target`, or
 * `undefined` when that minute falls in a DST gap.
 */
function localMinuteToInstant(target: LocalDateTime, timeZone: string): Date | undefined {
  const wallMilliseconds = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const probe = new Date(wallMilliseconds + delta * 60 * 60 * 1000);
    const shown = localParts(probe, timeZone);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    offsets.add(shownAsUtc - Math.floor(probe.getTime() / 60_000) * 60_000);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wallMilliseconds - offset))
    .filter((candidate) => sameMinute(localParts(candidate, timeZone), target))
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0];
}

/**
 * Converts a YYYY-MM-DD date and wall time in `timeZone` to an instant.
 * Nonexistent wall times resolve to the first valid minute; folds resolve
 * once, to the earlier instant.
 * @throws {RangeError} if no valid minute exists within 180 minutes.
 */
function resolveLocalDateTime(date: string, hour: number, minute: number, timeZone: string): { instant: Date; localDate: string; localTime: string } {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part ?? '', 10));
  const requested: LocalDateTime = { year: year ?? 0, month: month ?? 0, day: day ?? 0, hour, minute };
  for (let advance = 0; advance <= 180; advance += 1) {
    const wall = new Date(Date.UTC(requested.year, requested.month - 1, requested.day, requested.hour, requested.minute + advance));
    const candidate: LocalDateTime = {
      year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate(),
      hour: wall.getUTCHours(), minute: wall.getUTCMinutes(),
    };
    const instant = localMinuteToInstant(candidate, timeZone);
    if (instant) {
      const actual = localParts(instant, timeZone);
      const localDate = `${actual.year.toString().padStart(4, '0')}-${actual.month.toString().padStart(2, '0')}-${actual.day.toString().padStart(2, '0')}`;
      return { instant, localDate, localTime: `${actual.hour.toString().padStart(2, '0')}:${actual.minute.toString().padStart(2, '0')}` };
    }
  }
  throw new RangeError(`Could not resolve local time ${date} ${hour}:${minute} in ${timeZone}`);
}

/**
 * Parses a 24-hour `HH:mm` time into hour and minute.
 * @throws {RangeError} if it is malformed or out of range.
 */
function validateTime(time: string): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`Invalid cadence time: ${time}`);
  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);
  if (hour > 23 || minute > 59) throw new RangeError(`Invalid cadence time: ${time}`);
  return [hour, minute];
}

/**
 * Returns the YYYY-MM-DD date of `day` in a month, clamped to its last day.
 * @param month 0-based month, as in `Date`.
 */
function monthDate(year: number, month: number, day: number | 'last', timeZone: string): string {
  const first = new TZDate(year, month, 1, 12, 0, 0, 0, timeZone);
  const lastDay = endOfMonth(first).getDate();
  const actualDay = day === 'last' ? lastDay : Math.min(day, lastDay);
  return format(new TZDate(year, month, actualDay, 12, 0, 0, 0, timeZone), 'yyyy-MM-dd');
}

/** Appends the slot for a local date and time if it falls within [from, to]. */
function collectSlot(date: string, hour: number, minute: number, timeZone: string, from: Date, to: Date, result: ScheduleSlot[]): void {
  const resolved = resolveLocalDateTime(date, hour, minute, timeZone);
  if (resolved.instant >= from && resolved.instant <= to) {
    result.push({
      key: `${date}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      instant: resolved.instant,
    });
  }
}

/**
 * Returns the cadence's slots whose instants fall between `from` and `to`
 * inclusive, sorted by instant. Wall times are read in `timeZone`; a time
 * in a DST gap moves to the first valid minute after it, and a repeated
 * time occurs once, at its earlier instant. A reversed range returns `[]`
 * without validating the cadence.
 * @throws {RangeError} if the cadence's time, day, interval, weekday or
 * anchor date is invalid, or `timeZone` is unknown.
 */
export function getCadenceSlots(cadence: Cadence, from: Date, to: Date, timeZone: string): ScheduleSlot[] {
  if (from > to) return [];
  const [hour, minute] = validateTime(cadence.time);
  // Validate the time zone even if the requested range contains no occurrence.
  new Intl.DateTimeFormat('en', { timeZone }).format(from);
  const firstDate = todayInTimeZone(from, timeZone);
  const lastDate = todayInTimeZone(to, timeZone);
  const slots: ScheduleSlot[] = [];

  if (cadence.kind === 'monthly') {
    if (cadence.day !== 'last' && (!Number.isInteger(cadence.day) || cadence.day < 1 || cadence.day > 31)) {
      throw new RangeError('Monthly cadence day must be 1–31 or last');
    }
    let cursor = new TZDate(
      Number.parseInt(firstDate.slice(0, 4), 10), Number.parseInt(firstDate.slice(5, 7), 10) - 1, 1, 12, 0, 0, 0, timeZone,
    );
    const finalMonth = new TZDate(
      Number.parseInt(lastDate.slice(0, 4), 10), Number.parseInt(lastDate.slice(5, 7), 10) - 1, 1, 12, 0, 0, 0, timeZone,
    );
    while (cursor <= finalMonth) {
      const date = monthDate(cursor.getFullYear(), cursor.getMonth(), cadence.day, timeZone);
      collectSlot(date, hour, minute, timeZone, from, to, slots);
      cursor = addMonths(cursor, 1);
    }
  } else {
    if (!Number.isInteger(cadence.every) || cadence.every < 1 || cadence.every > 8) throw new RangeError('Every-weeks cadence must be 1–8');
    if (!Number.isInteger(cadence.weekday) || cadence.weekday < 1 || cadence.weekday > 7) throw new RangeError('Weekday must be 1–7');
    const anchor = new TZDate(
      Number.parseInt(cadence.anchorDate.slice(0, 4), 10), Number.parseInt(cadence.anchorDate.slice(5, 7), 10) - 1,
      Number.parseInt(cadence.anchorDate.slice(8, 10), 10), 12, 0, 0, 0, timeZone,
    );
    const anchorDate = format(anchor, 'yyyy-MM-dd');
    if (anchorDate !== cadence.anchorDate) throw new RangeError('Invalid cadence anchor date');
    const anchorWeekday = (anchor.getDay() || 7);
    const firstScheduled = addLocalDays(anchorDate, (cadence.weekday - anchorWeekday + 7) % 7, timeZone);
    const rangeStart = compareLocalDates(firstScheduled, firstDate) < 0 ? firstDate : firstScheduled;
    let cursorDate = rangeStart;
    while (compareLocalDates(cursorDate, lastDate) <= 0) {
      const utcDate = (value: string): number => {
        const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
        return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
      };
      const delta = Math.round((utcDate(cursorDate) - utcDate(firstScheduled)) / 86_400_000);
      const weekIndex = Math.floor(delta / 7);
      const localWeekday = new TZDate(
        Number.parseInt(cursorDate.slice(0, 4), 10), Number.parseInt(cursorDate.slice(5, 7), 10) - 1,
        Number.parseInt(cursorDate.slice(8, 10), 10), 12, 0, 0, 0, timeZone,
      ).getDay() || 7;
      if (localWeekday === cadence.weekday && weekIndex % cadence.every === 0) {
        collectSlot(cursorDate, hour, minute, timeZone, from, to, slots);
      }
      cursorDate = addLocalDays(cursorDate, 1, timeZone);
    }
  }
  return slots.sort((left, right) => left.instant.getTime() - right.instant.getTime());
}
