import type Database from 'better-sqlite3';
import { monthOfDate, todayInTimeZone } from '@budget-buddy/shared';
import type { Clock } from '../clock.js';
import { topUpEnvelopes } from '../domain/envelopes.js';
import type { Job } from './types.js';

/** Name of the top-up job in `job_run`. */
export const envelopeTopUpJobName = 'envelope-topup';

/**
 * Creates the job that tops up the envelopes on the 1st of each month at
 * 00:00 in the family's time zone (ENV-2). A slot's key is
 * `YYYY-MM-01T00:00`; when daylight saving skips that midnight the slot is
 * due at the first valid minute, as cadence slots are. A run inserts every
 * missing top-up up to the slot's month, so a server that was off across one
 * or more 1sts comes out right at start although the runner makes up only
 * the latest slot, and a slot run twice inserts nothing (COR-3).
 */
export function createEnvelopeTopUpJob(options: {
  database: Database.Database;
  clock: Clock;
}): Job {
  const { database, clock } = options;
  return {
    name: envelopeTopUpJobName,
    dueSlots(now, settings, lastDoneSlot) {
      // Once the local date is in a month, its first minute has passed.
      const month = monthOfDate(todayInTimeZone(now, settings.timeZone));
      const slot = `${month}-01T00:00`;
      return lastDoneSlot !== null && slot <= lastDoneSlot ? [] : [slot];
    },
    run(slot) {
      topUpEnvelopes(database, slot.slice(0, 7), clock.now().getTime());
    },
  };
}
