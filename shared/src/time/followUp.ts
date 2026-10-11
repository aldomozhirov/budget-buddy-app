import {
  localSlotInstant,
  localSlotKey,
  type ScheduleSlot,
} from './cadence.js';
import { addLocalDays, todayInTimeZone } from './calendar.js';

/** What the reminders of a check-in are counted from. */
export interface FollowUpBasis {
  /** When the check-in opened, in epoch milliseconds. */
  openedAt: number;
  /**
   * The local `YYYY-MM-DDTHH:mm` slot a scheduled check-in was opened for, or
   * null for one a member started.
   */
  scheduleSlot: string | null;
}

const dayMs = 86_400_000;

/** Whole calendar days from one `YYYY-MM-DD` date to a later one. */
function daysBetween(from: string, to: string): number {
  const utc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
  return Math.round((utc(to) - utc(from)) / dayMs);
}

/**
 * The local date and time reminders fall on: the cadence time of a scheduled
 * check-in, else the time a member opened it (to the minute).
 */
function reminderStart(
  basis: FollowUpBasis,
  timeZone: string,
): { date: string; time: string } {
  const key =
    basis.scheduleSlot ?? localSlotKey(new Date(basis.openedAt), timeZone);
  return { date: key.slice(0, 10), time: key.slice(11, 16) };
}

/**
 * Returns the `index`-th follow-up reminder (1 is the first): `index * days`
 * calendar days after the check-in opened, at the same wall time. The key is
 * the requested local time, so a daylight-saving gap moves the instant but
 * not the key, and a day of 23 or 25 hours never shifts the time shown.
 * @throws {RangeError} if `timeZone` is unknown.
 */
export function followUpSlot(
  basis: FollowUpBasis,
  days: number,
  index: number,
  timeZone: string,
): ScheduleSlot {
  const { date, time } = reminderStart(basis, timeZone);
  const reminderDate = addLocalDays(date, index * days, timeZone);
  return {
    key: `${reminderDate}T${time}`,
    instant: localSlotInstant(reminderDate, time, timeZone),
  };
}

/**
 * Lists the follow-up reminders of a check-in whose instants fall in
 * `[from, to]`, oldest first. A reminder never falls at or before the moment
 * the check-in opened, which keeps a scheduled check-in that was made up
 * after downtime from reminding at once. `days` below 1 means reminders are
 * off and gives none.
 * @throws {RangeError} if `timeZone` is unknown.
 */
export function followUpSlotsBetween(
  basis: FollowUpBasis,
  days: number,
  from: Date,
  to: Date,
  timeZone: string,
): ScheduleSlot[] {
  if (days < 1) return [];
  const { date } = reminderStart(basis, timeZone);
  const first = Math.max(
    1,
    Math.ceil(daysBetween(date, todayInTimeZone(from, timeZone)) / days),
  );
  const last = Math.floor(
    daysBetween(date, todayInTimeZone(to, timeZone)) / days,
  );
  const slots: ScheduleSlot[] = [];
  for (let index = first; index <= last; index += 1) {
    const slot = followUpSlot(basis, days, index, timeZone);
    if (
      slot.instant >= from &&
      slot.instant <= to &&
      slot.instant.getTime() > basis.openedAt
    )
      slots.push(slot);
  }
  return slots;
}

/**
 * Returns the first reminder after `after`, or null when reminders are off.
 * @throws {RangeError} if `timeZone` is unknown.
 */
export function nextFollowUp(
  basis: FollowUpBasis,
  days: number,
  after: Date,
  timeZone: string,
): ScheduleSlot | null {
  if (days < 1) return null;
  const { date } = reminderStart(basis, timeZone);
  let index = Math.max(
    1,
    Math.floor(daysBetween(date, todayInTimeZone(after, timeZone)) / days),
  );
  for (;;) {
    const slot = followUpSlot(basis, days, index, timeZone);
    if (slot.instant > after && slot.instant.getTime() > basis.openedAt)
      return slot;
    index += 1;
  }
}

/**
 * Words for how far off a reminder is, by calendar days in `timeZone`:
 * "today", "tomorrow" or "in N days" (UI-CHK-7).
 */
export function describeReminderIn(
  reminder: Date,
  now: Date,
  timeZone: string,
): string {
  const days = daysBetween(
    todayInTimeZone(now, timeZone),
    todayInTimeZone(reminder, timeZone),
  );
  if (days <= 0) return 'today';
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/**
 * Words for the follow-up interval in Settings (UI-SET-1): "Off", "Every day"
 * or "Every N days".
 */
export function summarizeFollowUp(days: number): string {
  if (days < 1) return 'Off';
  return days === 1 ? 'Every day' : `Every ${days} days`;
}
