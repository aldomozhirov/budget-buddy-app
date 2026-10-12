import type Database from 'better-sqlite3';

/**
 * Turns off "Sign in again when reopened" (MEM-7) for every device. Tests that
 * move a fake clock by hours or days with one session use it, since a session
 * that does not say it is in use would be locked after five minutes (SEC-9);
 * those tests are about something else and keep the behaviour of MEM-2.
 */
export function turnOffReopenLock(database: Database.Database): void {
  database.prepare('UPDATE device SET lock_on_reopen = 0').run();
}
