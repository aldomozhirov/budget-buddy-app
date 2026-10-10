import { addLocalDays, formatDate } from '@budget-buddy/shared';

/** A rate this many days old or more is flagged as stale (CUR-4). */
export const staleRateDays = 5;

/**
 * Says when rates were last fetched, as "Updated today 06:00" (design
 * Settings screen), "Updated yesterday 06:00" or "Updated 03/10/2026 06:00".
 * @param updatedAt Epoch milliseconds of the last answer from a feed.
 * @param today The family's local date, YYYY-MM-DD, as the server reports it.
 */
export function formatUpdated(
  updatedAt: number,
  today: string,
  timeZone: string,
): string {
  const instant = new Date(updatedAt);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  const day =
    date === today
      ? 'today'
      : addLocalDays(date, 1, timeZone) === today
        ? 'yesterday'
        : formatDate(date, timeZone);
  return `Updated ${day} ${time}`;
}

/** Names the age of a rate: "Today", "Yesterday" or its DD/MM/YYYY date. */
export function formatRateDate(
  latestDate: string,
  ageDays: number,
  timeZone: string,
): string {
  if (ageDays === 0) return 'Today';
  if (ageDays === 1) return 'Yesterday';
  return formatDate(latestDate, timeZone);
}
