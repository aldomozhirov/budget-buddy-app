/**
 * Checks a backup file before it is restored (BKP-2): the file must be a
 * SQLite database that passes `PRAGMA integrity_check`, belongs to this app
 * and is not from a newer version of it. `scripts/restore.sh` runs it inside
 * the image, since the check needs the app's own SQL functions.
 *
 * Usage: `node server/dist/verifyBackup.js <file>`. Prints
 * `ok (migration version N)` and exits 0 when the file is good, else exits 1
 * with the reason. `restore.sh` requires that line, not only the exit status.
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { migrationVersion, registerDatabaseFunctions } from './db/migrate.js';

const journalPath = fileURLToPath(
  new URL('../drizzle/meta/_journal.json', import.meta.url),
);

/**
 * Looks over a backup file without changing it.
 * @returns The number of migrations the file has applied.
 * @throws {Error} with the reason when the file cannot be restored.
 */
export async function verifyBackup(path: string): Promise<number> {
  let database: Database.Database;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    throw new Error('Not a SQLite database file.');
  }
  try {
    registerDatabaseFunctions(database);
    let result: unknown;
    try {
      result = database.pragma('integrity_check', { simple: true });
    } catch {
      throw new Error('Not a SQLite database file.');
    }
    if (result !== 'ok') throw new Error('The file fails the integrity check.');
    const version = migrationVersion(database);
    if (version === 0) throw new Error('Not a Budget Buddy database.');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: unknown[];
    };
    if (version > journal.entries.length) {
      throw new Error('The file is from a newer version of Budget Buddy.');
    }
    return version;
  } finally {
    database.close();
  }
}

const [, entry, file] = process.argv;
// Compared as real file URLs, so a path that needs encoding (a space) or a
// symlink still runs the check; a guard that fails open would pass any file.
if (
  entry !== undefined &&
  pathToFileURL(realpathSync(entry)).href === import.meta.url
) {
  if (!file) {
    console.error('Usage: node server/dist/verifyBackup.js <backup file>');
    process.exitCode = 2;
  } else {
    try {
      console.log(`ok (migration version ${await verifyBackup(file)})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
