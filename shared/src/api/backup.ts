import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** The last good nightly backup. */
export const lastBackupSchema = z.object({
  /** Epoch milliseconds at which the copy was verified and in place. */
  finishedAt: z.number().int().nonnegative(),
  /** Size of the file in bytes. */
  bytes: z.number().int().nonnegative(),
});

/** The night that failed, when it is newer than the last good backup. */
export const backupFailureSchema = z.object({
  /** Epoch milliseconds at which the last attempt failed. */
  at: z.number().int().nonnegative(),
  /** A plain reason with no file paths. */
  message: z.string(),
});

/** What Settings shows about backups (BKP-4); `GET /api/backup/status`. */
export const backupStatusResponseSchema = z.object({
  /** Today in the family's time zone, YYYY-MM-DD. */
  today: dateSchema,
  timeZone: z.string(),
  /** Local time of the nightly job, `HH:MM`. */
  time: z.string().regex(/^\d{2}:\d{2}$/u),
  /** Null until the first nightly backup has been written. */
  last: lastBackupSchema.nullable(),
  /** Null unless the latest attempt failed after the last good backup. */
  failure: backupFailureSchema.nullable(),
  /** Daily copies on disk, and how many are kept. */
  daily: z.object({ kept: z.number().int(), limit: z.number().int() }),
  /** Monthly copies on disk, and how many are kept. */
  monthly: z.object({ kept: z.number().int(), limit: z.number().int() }),
});

/** Response of `GET /api/backup/status`. */
export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;
