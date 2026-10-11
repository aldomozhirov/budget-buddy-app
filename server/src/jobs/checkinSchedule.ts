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
 * already open the slot opens nothing, and the same slot never opens two.
 * The reminder for that case belongs to the notification task.
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
        settings.cadenceAnchorDate ??
        todayInTimeZone(now, settings.timeZone);
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
      startCheckin(database, {
        openedBy: null,
        scheduleSlot: slot,
        now: clock.now().getTime(),
        events,
      });
    },
  };
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
  const date = todayInTimeZone(now, timeZone);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  database
    .prepare(
      `INSERT INTO job_run (job, slot, status, attempts, started_at,
        finished_at, error)
      VALUES (?, ?, 'done', 0, ?, ?, 'Cadence changed')
      ON CONFLICT (job, slot) DO NOTHING`,
    )
    .run(checkinScheduleJobName, `${date}T${time}`, now.getTime(), now.getTime());
}
