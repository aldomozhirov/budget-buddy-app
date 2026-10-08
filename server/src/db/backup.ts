import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Writes a consistent online SQLite backup to `path`, creating its parent
 * directory when needed. `better-sqlite3`'s backup API is safe with a live WAL DB.
 */
export async function backupTo(
  database: Database.Database,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await database.backup(path);
}
