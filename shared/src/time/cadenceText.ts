import type { CadenceSetting } from '../api/schedule.js';
import { getCadenceSlots, type Cadence, type ScheduleSlot } from './cadence.js';

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
/** Longest gap between two slots: eight weeks, with room to spare. */
const lookaheadMs = 70 * 24 * 60 * 60 * 1000;

/**
 * Turns the stored setting into a schedule the slot calculator understands.
 * "Every N weeks" counts from `anchorDate` (YYYY-MM-DD, a local date).
 * Returns null when the cadence is off.
 */
export function toCadence(
  setting: CadenceSetting,
  anchorDate: string,
): Cadence | null {
  if (setting.kind === 'off') return null;
  if (setting.kind === 'monthly') {
    return { kind: 'monthly', day: setting.day, time: setting.time };
  }
  return {
    kind: 'weeks',
    every: setting.every,
    weekday: setting.weekday,
    anchorDate,
    time: setting.time,
  };
}

/** Whether two settings describe the same schedule. */
export function sameCadenceSetting(
  a: CadenceSetting,
  b: CadenceSetting,
): boolean {
  if (a.kind === 'off' || b.kind === 'off') return a.kind === b.kind;
  if (a.kind === 'monthly' && b.kind === 'monthly') {
    return a.day === b.day && a.time === b.time;
  }
  if (a.kind === 'weeks' && b.kind === 'weeks') {
    return a.every === b.every && a.weekday === b.weekday && a.time === b.time;
  }
  return false;
}

/**
 * The first slot strictly after `now`, or undefined when the cadence is off.
 * @throws {RangeError} if the time zone or the setting is invalid.
 */
export function nextCadenceSlot(
  setting: CadenceSetting,
  anchorDate: string,
  now: Date,
  timeZone: string,
): ScheduleSlot | undefined {
  const cadence = toCadence(setting, anchorDate);
  if (!cadence) return undefined;
  return getCadenceSlots(
    cadence,
    new Date(now.getTime() + 1),
    new Date(now.getTime() + lookaheadMs),
    timeZone,
  )[0];
}

/** `5` becomes `5th`, `22` becomes `22nd`. */
function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th');
  return `${day}${suffix}`;
}

/** The local date part of a slot key as "5 November". */
export function formatSlotDay(slotKey: string): string {
  const month = Number.parseInt(slotKey.slice(5, 7), 10);
  const day = Number.parseInt(slotKey.slice(8, 10), 10);
  return `${day} ${months[month - 1] ?? ''}`;
}

/** The local time part of a slot key as "09:00". */
export function formatSlotTime(slotKey: string): string {
  return slotKey.slice(11, 16);
}

/** "Every week" or "Every 2 weeks". */
function weeksPhrase(every: number): string {
  return every === 1 ? 'Every week' : `Every ${every} weeks`;
}

/**
 * The cadence in words for the Check-ins header: "Monthly on the 5th, 09:00",
 * "Monthly on the last day, 09:00", "Every 2 weeks on Friday, 09:00", or
 * "Schedule off".
 */
export function describeCadence(setting: CadenceSetting): string {
  if (setting.kind === 'off') return 'Schedule off';
  if (setting.kind === 'monthly') {
    const day =
      setting.day === 'last' ? 'the last day' : `the ${ordinal(setting.day)}`;
    return `Monthly on ${day}, ${setting.time}`;
  }
  const weekday = weekdays[setting.weekday - 1] ?? '';
  return `${weeksPhrase(setting.every)} on ${weekday}, ${setting.time}`;
}

/**
 * The cadence in a few words for the Settings row: "Monthly, 5th, 09:00",
 * "Monthly, last day, 09:00", "Every 2 weeks, Fri, 09:00", or "Off".
 */
export function summarizeCadence(setting: CadenceSetting): string {
  if (setting.kind === 'off') return 'Off';
  if (setting.kind === 'monthly') {
    const day = setting.day === 'last' ? 'last day' : ordinal(setting.day);
    return `Monthly, ${day}, ${setting.time}`;
  }
  const weekday = (weekdays[setting.weekday - 1] ?? '').slice(0, 3);
  return `${weeksPhrase(setting.every)}, ${weekday}, ${setting.time}`;
}

/** The names of the seven ISO weekdays, Monday first. */
export const weekdayNames: readonly string[] = weekdays;
