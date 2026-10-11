import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Clock } from '../clock.js';
import { registerDatabaseFunctions } from '../db/migrate.js';
import {
  backupFileName,
  backupFolders,
  copyAtomically,
  copyDate,
  copyNewFiles,
  dailyLimit,
  isMissing,
  listCopies,
  monthlyLimit,
  pruneCopies,
  removeStaleTemporaries,
  syncFile,
  temporaryPath,
} from './files.js';

/** A failure whose message is safe to show in Settings: no paths, no SQL. */
export class BackupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackupError';
  }
}

/** What the nightly backup needs. */
export interface NightlyBackupOptions {
  /** The live database; its online backup copies it while it is in use. */
  database: Database.Database;
  clock: Clock;
  /** Folder that holds `budget-buddy.sqlite` and `images/` (DEP-2). */
  dataDir: string;
  /** Folder that receives `daily/`, `monthly/` and `images/` (DEP-2). */
  backupDir: string;
}

/** What one night's run did. */
export interface NightlyBackupResult {
  /** Local date of the night, `YYYY-MM-DD`. */
  date: string;
  /** True when the daily copy of that date was already in place and intact. */
  reused: boolean;
  /** Set when this run made the monthly copy of the month. */
  monthly: string | null;
  /** Image files copied this run. */
  images: number;
}

/**
 * Whether a database file passes SQLite's `PRAGMA integrity_check`.
 * An unreadable or non-database file is not intact.
 */
export function isIntact(path: string, mode: 'read' | 'write'): boolean {
  let database: Database.Database | undefined;
  try {
    database = new Database(path, {
      readonly: mode === 'read',
      fileMustExist: true,
    });
    // The member-name index calls a function that the app registers, and
    // the check cannot read the index without it.
    registerDatabaseFunctions(database);
    // A copy of a WAL database says "WAL" in its header; a plain single
    // file is easier to keep, copy and restore, so it is converted first.
    if (mode === 'write') database.pragma('journal_mode = DELETE');
    return database.pragma('integrity_check', { simple: true }) === 'ok';
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

/**
 * Writes the backup of one night (BKP-1) and returns what it did.
 *
 * The daily copy is made with SQLite's online backup into a temporary file,
 * converted to a plain single file, verified with `PRAGMA integrity_check`
 * and only then renamed to `daily/budget-buddy-YYYY-MM-DD.sqlite`. A failed
 * or interrupted run leaves no file that looks like a good backup and never
 * replaces a good one. A date whose copy is already in place and intact is
 * not written again, so the same night twice gives one file (COR-3). The
 * first copy of each month is also kept in `monthly/`, the oldest copies are
 * pruned only after the new ones are in place, and new image files are
 * copied last.
 * @param date The night's local date, `YYYY-MM-DD`.
 * @throws {BackupError} with a message that is safe to show, when any step
 * fails; the run is safe to repeat.
 */
export async function runNightlyBackup(
  options: NightlyBackupOptions,
  date: string,
): Promise<NightlyBackupResult> {
  const { database, clock, dataDir, backupDir } = options;
  const folders = backupFolders(backupDir);
  const record = createRecorder(database, clock);
  try {
    await mkdir(folders.daily, { recursive: true });
    await mkdir(folders.monthly, { recursive: true });
    await removeStaleTemporaries([folders.daily, folders.monthly]);
    record.closeInterrupted();

    const target = join(folders.daily, backupFileName(date));
    const reused = await isIntactFile(target);
    if (!reused) await writeDailyCopy(database, target, record);
    else record.ensureDone('daily', target, (await stat(target)).size);

    const monthly = await keepFirstOfMonth(
      target,
      date,
      folders.monthly,
      record,
    );
    await pruneCopies(folders.daily, dailyLimit);
    await pruneCopies(folders.monthly, monthlyLimit);
    const images = await copyNewFiles(join(dataDir, 'images'), folders.images);
    return { date, reused, monthly, images };
  } catch (error) {
    throw error instanceof BackupError
      ? error
      : new BackupError(describeFailure(error), { cause: error });
  }
}

/** Whether a file exists and passes the integrity check. */
async function isIntactFile(path: string): Promise<boolean> {
  try {
    await stat(path);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  return isIntact(path, 'read');
}

/** Online backup to a temporary name, verified, then renamed over `target`. */
async function writeDailyCopy(
  database: Database.Database,
  target: string,
  record: Recorder,
): Promise<void> {
  const temporary = temporaryPath(target);
  const attempt = record.start('daily', target);
  try {
    await database.backup(temporary);
    if (!isIntact(temporary, 'write')) {
      throw new BackupError('The new copy failed its integrity check.');
    }
    await syncFile(temporary);
    const bytes = (await stat(temporary)).size;
    await rename(temporary, target);
    record.finish(attempt, bytes);
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(`${temporary}-wal`, { force: true });
    await rm(`${temporary}-shm`, { force: true });
    const failure =
      error instanceof BackupError
        ? error
        : new BackupError(describeFailure(error), { cause: error });
    record.fail(attempt, failure.message);
    throw failure;
  }
}

/**
 * Copies the daily file to `monthly/` when the month has no copy yet. The
 * first backup of a month is normally that of the 1st; going by "no copy for
 * this month yet" also covers a 1st on which the server was off.
 * @returns The file name made, or null when the month already had one.
 */
async function keepFirstOfMonth(
  daily: string,
  date: string,
  folder: string,
  record: Recorder,
): Promise<string | null> {
  const month = date.slice(0, 7);
  const existing = await listCopies(folder);
  if (existing.some((name) => copyDate(name)?.startsWith(month))) return null;
  const name = backupFileName(date);
  const target = join(folder, name);
  const attempt = record.start('monthly', target);
  try {
    await copyAtomically(daily, target);
    record.finish(attempt, (await stat(target)).size);
  } catch (error) {
    record.fail(attempt, describeFailure(error));
    throw error;
  }
  return name;
}

/** A plain reason for an unexpected failure, with no paths in it. */
function describeFailure(error: unknown): string {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  return code === undefined
    ? 'The backup could not be written.'
    : `The backup could not be written (${code}).`;
}

type Recorder = ReturnType<typeof createRecorder>;

/** Keeps the `backup` table, which Settings and Home read (BKP-4). */
function createRecorder(database: Database.Database, clock: Clock) {
  const insert = database.prepare(
    `INSERT INTO backup (kind, path, started_at, status)
    VALUES (?, ?, ?, 'running') RETURNING id`,
  );
  const finish = database.prepare(
    `UPDATE backup SET status = 'done', bytes = ?, finished_at = ?, error = NULL
    WHERE id = ?`,
  );
  const fail = database.prepare(
    `UPDATE backup SET status = 'failed', finished_at = ?, error = ?
    WHERE id = ?`,
  );
  const interrupted = database.prepare(
    `UPDATE backup SET status = 'failed', finished_at = ?,
      error = 'Interrupted by a restart'
    WHERE status = 'running' AND kind IN ('daily', 'monthly')`,
  );
  const hasDone = database.prepare(
    `SELECT 1 FROM backup WHERE kind = ? AND path = ? AND status = 'done'`,
  );
  const now = () => clock.now().getTime();
  return {
    start(kind: 'daily' | 'monthly', path: string): number {
      const row = insert.get(kind, path, now()) as { id: bigint };
      return Number(row.id);
    },
    finish(id: number, bytes: number): void {
      finish.run(bytes, now(), id);
    },
    fail(id: number, message: string): void {
      fail.run(now(), message, id);
    },
    closeInterrupted(): void {
      interrupted.run(now());
    },
    /** Records a copy that an earlier run made but did not get to record. */
    ensureDone(kind: 'daily' | 'monthly', path: string, bytes: number): void {
      if (hasDone.get(kind, path) !== undefined) return;
      this.finish(this.start(kind, path), bytes);
    },
  };
}
