import type Database from 'better-sqlite3';
import { followUpSlotsBetween } from '@budget-buddy/shared';
import type { CheckinEventBus } from '../events.js';
import { settleJobUntil } from './settle.js';
import type { Job } from './types.js';

/** Name of the follow-up job in `job_run`. */
export const followUpJobName = 'checkin-followup';

const dayMs = 86_400_000;

type OpenCheckin = {
  id: bigint;
  openedAt: bigint;
  scheduleSlot: string | null;
};

/** The open check-in, or undefined when none is open. */
function readOpenCheckin(database: Database.Database): OpenCheckin | undefined {
  return database
    .prepare(
      `SELECT id, opened_at AS openedAt, schedule_slot AS scheduleSlot
      FROM checkin WHERE closed_at IS NULL`,
    )
    .get() as OpenCheckin | undefined;
}

/**
 * Creates the job that reminds members while a check-in is open (CHK-3).
 * Every `followup_days` days after it opened, at the cadence time of a
 * scheduled check-in or the opening time of a manual one, it announces a
 * `checkin.followup` event for the open check-in; the notifier then picks the
 * members who still own accounts without a value. A slot's key is its local
 * time, `YYYY-MM-DDTHH:MM`, so reminders keep their wall time across
 * daylight-saving changes. The runner makes up only the latest missed slot
 * (COR-3), so a restart after missed reminders sends one. Nothing is due
 * when reminders are off (0 days) or no check-in is open.
 */
export function createFollowUpJob(options: {
  database: Database.Database;
  events: CheckinEventBus;
}): Job {
  const { database, events } = options;
  return {
    name: followUpJobName,
    dueSlots(now, settings, lastDoneSlot) {
      const open = readOpenCheckin(database);
      if (!open || settings.followupDays < 1) return [];
      // The latest slot at or before now is within one interval of it.
      const from = new Date(
        now.getTime() - (settings.followupDays + 1) * dayMs,
      );
      return followUpSlotsBetween(
        {
          openedAt: Number(open.openedAt),
          scheduleSlot: open.scheduleSlot,
        },
        settings.followupDays,
        from,
        now,
        settings.timeZone,
      )
        .map(({ key }) => key)
        .filter((key) => lastDoneSlot === null || key > lastDoneSlot);
    },
    run(slot) {
      // The check-in may have closed since the slot was claimed.
      const open = readOpenCheckin(database);
      if (!open) return;
      events.emit('checkin.followup', { checkinId: Number(open.id), slot });
    },
  };
}

/**
 * Records that every reminder up to now is settled, so a changed interval or
 * time zone counts its reminders from now on and never sends one for a time
 * in the past (CHK-3). Call it when either is saved.
 */
export function settleFollowUpsUntil(
  database: Database.Database,
  now: Date,
  timeZone: string,
): void {
  settleJobUntil(database, followUpJobName, now, timeZone);
}
