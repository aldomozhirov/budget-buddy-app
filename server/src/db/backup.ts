import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';

export async function backupTo(
  database: Database.Database,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await database.backup(path);
}
