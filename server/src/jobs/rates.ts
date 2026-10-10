import { todayInTimeZone } from '@budget-buddy/shared';
import type { RatesService } from '../rates/service.js';
import type { Job } from './types.js';

/** First local hour of the day at which rates are fetched (CUR-2). */
export const ratesFirstHour = 6;

/** The local hour, 0 to 23, of an instant in `timeZone`. */
function localHour(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find(({ type }) => type === 'hour')?.value ?? 0);
}

/**
 * Creates the daily rates job. It has one slot per local hour from 06:00,
 * keyed `YYYY-MM-DDTHH:00`, so a feed that has not published yet is asked
 * again every hour until it has; a slot where every feed has published does
 * no network work. A run fails when a feed could not be fetched, which the
 * runner retries a few times and then leaves for the next hour's slot.
 */
export function createRatesJob(
  service: Pick<RatesService, 'refreshToday'>,
): Job {
  return {
    name: 'rates',
    dueSlots(now, settings, lastDoneSlot) {
      const date = todayInTimeZone(now, settings.timeZone);
      const hour = localHour(now, settings.timeZone);
      const slots: string[] = [];
      for (let at = ratesFirstHour; at <= hour; at += 1) {
        const slot = `${date}T${String(at).padStart(2, '0')}:00`;
        if (lastDoneSlot === null || slot > lastDoneSlot) slots.push(slot);
      }
      return slots;
    },
    async run() {
      const { failures } = await service.refreshToday();
      if (failures.length > 0) {
        throw new Error(
          failures
            .map(({ feedId, message }) => `${feedId}: ${message}`)
            .join('; '),
        );
      }
    },
  };
}
