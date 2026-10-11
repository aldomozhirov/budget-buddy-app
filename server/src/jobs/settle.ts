import type Database from 'better-sqlite3';
import { todayInTimeZone } from '@budget-buddy/shared';

/**
 * Records that every slot of a job up to the current local minute is settled,
 * so a changed setting counts its slots from now on and never runs one that
 * lies in the past. Slot keys are local `YYYY-MM-DDTHH:MM` times.
 */
export function settleJobUntil(
  database: Database.Database,
  jobName: string,
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
      VALUES (?, ?, 'done', 0, ?, ?, 'Setting changed')
      ON CONFLICT (job, slot) DO NOTHING`,
    )
    .run(jobName, `${date}T${time}`, now.getTime(), now.getTime());
}
