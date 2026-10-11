import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  backupStatusResponseSchema,
  todayInTimeZone,
  type BackupStatusResponse,
} from '@budget-buddy/shared';
import {
  backupFolders,
  backupTime,
  dailyLimit,
  listCopies,
  monthlyLimit,
} from '../../backup/files.js';
import { backupJobName } from '../../jobs/backup.js';
import { systemClock, type Clock } from '../../clock.js';

/** Registers the backup status that Settings shows (BKP-4). */
export const backupRoutes: FastifyPluginAsync<{
  database: Database.Database;
  /** Folder of the daily and monthly copies; none means no copies. */
  backupDir?: string | undefined;
  clock?: Clock;
}> = async (app, options) => {
  const clock = options.clock ?? systemClock;

  app.get('/api/backup/status', async () =>
    backupStatusResponseSchema.parse(
      await getBackupStatus(options.database, {
        now: clock.now(),
        backupDir: options.backupDir,
      }),
    ),
  );
};

/**
 * Reads the last good nightly backup, the failure of the latest attempt if
 * the night failed, and the copies on disk. A failure shows only until a
 * later night succeeds, and carries a plain reason with no file path.
 */
export async function getBackupStatus(
  database: Database.Database,
  options: { now: Date; backupDir: string | undefined },
): Promise<BackupStatusResponse> {
  const family = database
    .prepare('SELECT time_zone FROM family WHERE id = 1')
    .get() as { time_zone: string } | undefined;
  const timeZone = family?.time_zone ?? 'UTC';
  const last = database
    .prepare(
      `SELECT bytes, finished_at FROM backup
       WHERE status = 'done' AND kind = 'daily' AND finished_at IS NOT NULL
       ORDER BY finished_at DESC, id DESC LIMIT 1`,
    )
    .get() as { bytes: bigint | null; finished_at: bigint } | undefined;
  const latestRun = database
    .prepare(
      `SELECT status, error, finished_at FROM job_run
       WHERE job = ? ORDER BY slot DESC LIMIT 1`,
    )
    .get(backupJobName) as
    | { status: string; error: string | null; finished_at: bigint | null }
    | undefined;
  const folders =
    options.backupDir === undefined
      ? undefined
      : backupFolders(options.backupDir);
  const [daily, monthly] = folders
    ? await Promise.all([
        listCopies(folders.daily),
        listCopies(folders.monthly),
      ])
    : [[], []];
  return {
    today: todayInTimeZone(options.now, timeZone),
    timeZone,
    time: backupTime,
    last: last
      ? {
          finishedAt: Number(last.finished_at),
          bytes: Number(last.bytes ?? 0n),
        }
      : null,
    failure:
      latestRun?.status === 'failed'
        ? {
            at: Number(latestRun.finished_at ?? options.now.getTime()),
            message: latestRun.error ?? 'The backup could not be written.',
          }
        : null,
    daily: { kept: daily.length, limit: dailyLimit },
    monthly: { kept: monthly.length, limit: monthlyLimit },
  };
}
