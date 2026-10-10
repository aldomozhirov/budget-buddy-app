const dayMs = 86_400_000;

/** Parses a YYYY-MM-DD date as midnight UTC; the date is only a label here. */
function utcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Formats an instant as its UTC calendar date, YYYY-MM-DD. */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Adds calendar days (negative to go back) to a YYYY-MM-DD date. */
export function shiftDate(date: string, days: number): string {
  return new Date(utcMs(date) + days * dayMs).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / dayMs);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday to 7 = Sunday. */
export function isoWeekday(date: string): number {
  return new Date(utcMs(date)).getUTCDay() || 7;
}

/** Every date from `from` to `to`, inclusive, oldest first. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}
