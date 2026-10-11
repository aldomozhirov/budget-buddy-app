import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { runNightlyBackup } from '../src/backup/nightly.js';
import { verifyBackup } from '../src/verifyBackup.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

describe('verifyBackup', () => {
  let directory: string;
  let database: Database.Database;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-verify-'));
    await mkdir(join(directory, 'data'));
    database = new Database(join(directory, 'data', 'live.sqlite'));
    database.pragma('journal_mode = WAL');
    await migrateDatabase(database, {
      backupDir: join(directory, 'pre'),
      migrationsFolder,
    });
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('accepts a nightly backup and reports its migration version', async () => {
    await runNightlyBackup(
      {
        database,
        clock: { now: () => new Date('2026-10-11T10:00:00Z') },
        dataDir: join(directory, 'data'),
        backupDir: join(directory, 'backups'),
      },
      '2026-10-11',
    );
    const version = await verifyBackup(
      join(directory, 'backups', 'daily', 'budget-buddy-2026-10-11.sqlite'),
    );
    expect(version).toBeGreaterThan(0);
  });

  it('refuses a file that is not a database', async () => {
    const file = join(directory, 'junk.sqlite');
    await writeFile(file, 'this is not a database'.repeat(200));
    await expect(verifyBackup(file)).rejects.toThrow(
      'Not a SQLite database file.',
    );
  });

  it('refuses a missing file', async () => {
    await expect(verifyBackup(join(directory, 'none.sqlite'))).rejects.toThrow(
      'Not a SQLite database file.',
    );
  });

  it('refuses a database that is not Budget Buddy’s', async () => {
    const file = join(directory, 'other.sqlite');
    const other = new Database(file);
    other.exec('CREATE TABLE t (a)');
    other.close();
    await expect(verifyBackup(file)).rejects.toThrow(
      'Not a Budget Buddy database.',
    );
  });

  it('refuses a file with damaged pages', async () => {
    const file = join(directory, 'damaged.sqlite');
    const copy = new Database(file);
    copy.exec('CREATE TABLE t (a, b); CREATE INDEX i ON t (a)');
    const insert = copy.prepare('INSERT INTO t VALUES (?, ?)');
    // One transaction: a write per row would take seconds on a slow disk.
    copy.transaction(() => {
      for (let index = 0; index < 3000; index += 1) {
        insert.run(index, 'x'.repeat(100));
      }
    })();
    copy.close();
    const bytes = await readFile(file);
    for (let offset = 8192; offset < bytes.length - 4096; offset += 4096) {
      bytes.fill(0xff, offset, offset + 2048);
    }
    await writeFile(file, bytes);
    await expect(verifyBackup(file)).rejects.toThrow(
      /integrity check|Not a SQLite database/u,
    );
  });
});
