import { subMonths, subWeeks } from 'date-fns';
import { TZDate } from '@date-fns/tz';

/**
 * Whether a snapshot is older than one monthly or N-week cadence period.
 * @throws {RangeError} if `timeZone` is unknown.
 */
export function isOlderThanCadencePeriod(
  snapshotAt: Date,
  now: Date,
  timeZone: string,
  cadence:
    | { readonly kind: 'monthly' }
    | { readonly kind: 'weeks'; readonly every: number },
): boolean {
  const zonedNow = new TZDate(now.getTime(), timeZone);
  const cutoff =
    cadence.kind === 'monthly'
      ? subMonths(zonedNow, 1)
      : subWeeks(zonedNow, cadence.every);
  return snapshotAt.getTime() < cutoff.getTime();
}
