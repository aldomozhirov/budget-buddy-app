import {
  addLocalDays,
  localSlotKey,
  todayInTimeZone,
} from '@budget-buddy/shared';
import {
  runNightlyBackup,
  type NightlyBackupOptions,
} from '../backup/nightly.js';
import { backupTime } from '../backup/files.js';
import type { Job } from './types.js';

/** Name of the backup job in `job_run`. */
export const backupJobName = 'backup';

/**
 * Creates the nightly backup job (BKP-1). It has one slot per local date,
 * keyed `YYYY-MM-DDT03:30`, due once the family's wall clock has reached
 * 03:30 of that date. Comparing wall-clock text instead of a UTC instant
 * keeps the slot at 03:30 on the nights the clocks change: on the short
 * night the slot is due when the clock reads 03:30, and on the long night
 * the repeated hour before it makes no second slot. After downtime the
 * runner makes up only the latest missed slot (COR-3), and a slot whose copy
 * is already in place writes nothing again.
 */
export function createBackupJob(options: NightlyBackupOptions): Job {
  return {
    name: backupJobName,
    dueSlots(now, settings, lastDoneSlot) {
      const local = localSlotKey(now, settings.timeZone);
      const today = todayInTimeZone(now, settings.timeZone);
      const yesterday = addLocalDays(today, -1, settings.timeZone);
      return [yesterday, today]
        .map((date) => `${date}T${backupTime}`)
        .filter(
          (slot) =>
            slot <= local && (lastDoneSlot === null || slot > lastDoneSlot),
        );
    },
    async run(slot) {
      await runNightlyBackup(options, slot.slice(0, 10));
    },
  };
}
