import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { caseFold } from 'unicode-case-folding';
import { systemClock, type Clock } from '../clock.js';
import { backupTo } from './backup.js';

type Journal = { entries: Array<{ tag: string; when: number }> };

const defaultMigrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);
const configuredDatabases = new WeakSet<Database.Database>();

function registerDatabaseFunctions(database: Database.Database): void {
  if (configuredDatabases.has(database)) return;
  database.function(
    'unicode_casefold',
    { deterministic: true },
    (value: string) => caseFold(value.normalize('NFKC')).normalize('NFKC'),
  );
  configuredDatabases.add(database);
}

async function pendingMigrations(
  database: Database.Database,
  migrationsFolder: string,
): Promise<boolean> {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal;
  const hasMigrationTable = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!hasMigrationTable) return journal.entries.length > 0;

  const applied = new Set(
    (
      database
        .prepare('SELECT created_at FROM __drizzle_migrations')
        .all() as Array<{ created_at: number | bigint }>
    ).map((row) => Number(row.created_at)),
  );
  return journal.entries.some((entry) => !applied.has(entry.when));
}

export async function migrateDatabase(
  database: Database.Database,
  options: {
    backupDir: string;
    migrationsFolder?: string;
    now?: Date;
    clock?: Clock;
  },
): Promise<number> {
  database.defaultSafeIntegers(true);
  registerDatabaseFunctions(database);
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;
  if (await pendingMigrations(database, migrationsFolder)) {
    const stamp = (options.now ?? options.clock?.now() ?? systemClock.now())
      .toISOString()
      .replaceAll(':', '-');
    const backupPath = path.join(
      options.backupDir,
      `pre_migration-${stamp}.sqlite`,
    );
    await backupTo(database, backupPath);
  }

  const hasMigrationTable = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  try {
    migrate(drizzle(database), { migrationsFolder });
  } catch (error) {
    if (!hasMigrationTable) {
      database.exec('DROP TABLE IF EXISTS __drizzle_migrations');
    }
    throw error;
  }
  return migrationVersion(database);
}

export function migrationVersion(database: Database.Database): number {
  const exists = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!exists) return 0;
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
    .get() as { count: number | bigint };
  return Number(row.count);
}
