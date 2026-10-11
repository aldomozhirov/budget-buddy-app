import type Database from 'better-sqlite3';
import {
  getCadenceSlots,
  toCadence,
  todayInTimeZone,
} from '@budget-buddy/shared';
import type { Clock } from '../clock.js';
import { cadenceFromFields } from '../domain/cadence.js';
import { startCheckin } from '../domain/checkin.js';
import type { CheckinEventBus } from '../events.js';
import { settleJobUntil } from './settle.js';
import type { Job } from './types.js';

/** Name of the schedule job in `job_run`. */
export const checkinScheduleJobName = 'checkin-schedule';

const dayMs = 86_400_000;
/** Any past slot of any cadence (at most 8 weeks apart) is this recent. */
const lookbackMs = 62 * dayMs;
/** How far back a never-run schedule looks, since it has no history. */
const freshLookbackMs = dayMs;

/**
 * Creates the job that opens a check-in at each scheduled slot (CHK-2). A
 * slot's key is its local time, `YYYY-MM-DDTHH:MM`, so a daylight-saving gap
 * keeps the requested time as key (Design section 5). A run after downtime
 * opens one check-in for the latest missed slot (COR-3). When a check-in is
 * already open the slot opens nothing, and the same slot never opens two;
 * instead it announces a reminder (`checkin.followup`, keyed by the slot) for
 * that check-in, which the notifier sends once to each active member who
 * still owns accounts without a value (CHK-2, CHK-3). A retry of a slot that
 * opened its own check-in sends no reminder.
 */
export function createCheckinScheduleJob(options: {
  database: Database.Database;
  clock: Clock;
  events: CheckinEventBus;
}): Job {
  const { database, clock, events } = options;
  return {
    name: checkinScheduleJobName,
    dueSlots(now, settings, lastDoneSlot) {
      const cadence = cadenceFromFields(settings);
      if (cadence.kind === 'off') return [];
      const anchorDate =
        settings.cadenceAnchorDate ?? todayInTimeZone(now, settings.timeZone);
      if (cadence.kind === 'weeks' && !settings.cadenceAnchorDate) return [];
      const schedule = toCadence(cadence, anchorDate);
      if (!schedule) return [];
      const from = new Date(
        now.getTime() - (lastDoneSlot === null ? freshLookbackMs : lookbackMs),
      );
      return getCadenceSlots(schedule, from, now, settings.timeZone)
        .map(({ key }) => key)
        .filter((key) => lastDoneSlot === null || key > lastDoneSlot);
    },
    run(slot) {
      const { checkinId, joined } = startCheckin(database, {
        openedBy: null,
        scheduleSlot: slot,
        now: clock.now().getTime(),
        events,
      });
      if (joined && !isOpenedBySlot(database, checkinId, slot)) {
        events.emit('checkin.followup', { checkinId, slot });
      }
    },
  };
}

/** Whether this slot made the check-in, as on a retry or a late rerun. */
function isOpenedBySlot(
  database: Database.Database,
  checkinId: number,
  slot: string,
): boolean {
  const row = database
    .prepare('SELECT schedule_slot AS scheduleSlot FROM checkin WHERE id = ?')
    .get(checkinId) as { scheduleSlot: string | null } | undefined;
  return row?.scheduleSlot === slot;
}

/**
 * Records that every slot up to now is settled, so that a changed cadence
 * counts its slots from now on and never opens a check-in for a slot that
 * lies in the past (CHK-2). Call it when the cadence is saved.
 */
export function settleSlotsUntil(
  database: Database.Database,
  now: Date,
  timeZone: string,
): void {
  settleJobUntil(database, checkinScheduleJobName, now, timeZone);
}
