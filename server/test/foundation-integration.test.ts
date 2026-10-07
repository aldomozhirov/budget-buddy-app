import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ISO_4217_CODES } from '../../shared/src/money/iso4217.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrateDatabase, migrationVersion } from '../src/db/migrate.js';
import { account, member, snapshot } from '../src/db/schema.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));

describe('foundation server integration', () => {
  let temporaryDirectory: string | undefined;
  let databases: Database.Database[] = [];
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    for (const database of databases) {
      if (database.open) database.close();
    }
    if (temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true });
    app = undefined;
    databases = [];
    temporaryDirectory = undefined;
  });

  async function makeTempDirectory(): Promise<string> {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'budget-buddy-foundation-'),
    );
    return temporaryDirectory;
  }

  function trackDatabase(database: Database.Database): Database.Database {
    databases.push(database);
    return database;
  }

  it('runs the complete first migration once, then treats the next startup as a no-op', async () => {
    const root = await makeTempDirectory();
    const dataDir = join(root, 'data');
    const backupDir = join(root, 'backups');
    const database = trackDatabase(
      await openDatabase(
        parseConfig({
          NODE_ENV: 'test',
          DATA_DIR: dataDir,
          BACKUP_DIR: backupDir,
        }),
      ),
    );

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1n);
    expect(migrationVersion(database)).toBe(1);

    const tables = new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      )
        .map((table) => table.name)
        .filter((name) => !name.startsWith('sqlite_')),
    );
    for (const tableName of [
      'family',
      'member',
      'device',
      'session',
      'passkey',
      'push_subscription',
      'coin',
      'account',
      'snapshot',
      'snapshot_revision',
      'checkin',
      'rate',
      'rate_fetch',
      'job_run',
      'notification',
      'backup',
    ]) {
      expect(tables.has(tableName), `missing table ${tableName}`).toBe(true);
    }
    expect(tables.has('account_link')).toBe(false);
    const accountColumns = database
      .prepare('PRAGMA table_info(account)')
      .all() as Array<{ name: string }>;
    expect(accountColumns.some((column) => column.name === 'source')).toBe(
      false,
    );

    expect(() =>
      database
        .prepare(
          "INSERT INTO family (id, password_hash, created_at) VALUES (2, 'x', 1)",
        )
        .run(),
    ).toThrow();
    database
      .prepare("INSERT INTO member (name, created_at) VALUES ('Alex', 1)")
      .run();
    expect(() =>
      database
        .prepare("INSERT INTO member (name, created_at) VALUES ('aLeX', 2)")
        .run(),
    ).toThrow();
    database.prepare('INSERT INTO checkin (opened_at) VALUES (1)').run();
    expect(() =>
      database.prepare('INSERT INTO checkin (opened_at) VALUES (2)').run(),
    ).toThrow();

    const backupsBeforeNoOp = await readdir(backupDir);
    expect(backupsBeforeNoOp).toHaveLength(1);
    expect(backupsBeforeNoOp[0]).toMatch(/^pre_migration-.*\.sqlite$/);

    expect(await migrateDatabase(database, { backupDir })).toBe(1);
    expect(await readdir(backupDir)).toEqual(backupsBeforeNoOp);
  });

  it('backs up before a failing pending migration, exits non-zero, and preserves the old database version', async () => {
    const root = await makeTempDirectory();
    const databasePath = join(root, 'budget-buddy.sqlite');
    const backupDir = join(root, 'backups');
    const migrationsFolder = join(root, 'migrations');
    await mkdir(join(migrationsFolder, 'meta'), { recursive: true });

    const firstWhen = 1_791_411_000_000;
    const secondWhen = firstWhen + 1;
    const journalPath = join(migrationsFolder, 'meta', '_journal.json');
    const writeJournal = async (includeFailure: boolean) => {
      const entries = [
        {
          idx: 0,
          version: '6',
          when: firstWhen,
          tag: '0000_legacy',
          breakpoints: true,
        },
        ...(includeFailure
          ? [
              {
                idx: 1,
                version: '6',
                when: secondWhen,
                tag: '0001_deliberate_failure',
                breakpoints: true,
              },
            ]
          : []),
      ];
      await writeFile(
        journalPath,
        JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
      );
    };

    await writeFile(
      join(migrationsFolder, '0000_legacy.sql'),
      "CREATE TABLE legacy_state (value TEXT NOT NULL);\n--> statement-breakpoint\nINSERT INTO legacy_state VALUES ('preserved');\n",
    );
    await writeJournal(false);

    const database = trackDatabase(new Database(databasePath));
    expect(
      await migrateDatabase(database, {
        backupDir,
        migrationsFolder,
        now: new Date('2026-10-08T10:00:00.000Z'),
      }),
    ).toBe(1);
    database.close();

    await writeFile(
      join(migrationsFolder, '0001_deliberate_failure.sql'),
      'CREATE TABLE failed_state (value TEXT NOT NULL);\n--> statement-breakpoint\nINSERT INTO missing_migration_dependency VALUES (1);\n',
    );
    await writeJournal(true);

    const childScript = `
      import Database from 'better-sqlite3';
      import { migrateDatabase } from './src/db/migrate.ts';
      const db = new Database(process.env.TEST_DATABASE_PATH);
      await migrateDatabase(db, {
        backupDir: process.env.TEST_BACKUP_DIR,
        migrationsFolder: process.env.TEST_MIGRATIONS_DIR,
        now: new Date('2026-10-08T12:00:00.000Z'),
      });
    `;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', childScript],
      {
        cwd: serverDirectory,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          TEST_DATABASE_PATH: databasePath,
          TEST_BACKUP_DIR: backupDir,
          TEST_MIGRATIONS_DIR: migrationsFolder,
        },
      },
    );

    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}\n${child.stderr}`).toContain(
      'missing_migration_dependency',
    );

    const failedAttemptBackup = join(
      backupDir,
      'pre_migration-2026-10-08T12-00-00.000Z.sqlite',
    );
    const { access } = await import('node:fs/promises');
    await expect(access(failedAttemptBackup)).resolves.toBeUndefined();

    const unchangedDatabase = trackDatabase(new Database(databasePath));
    expect(migrationVersion(unchangedDatabase)).toBe(1);
    expect(
      unchangedDatabase.prepare('SELECT value FROM legacy_state').get(),
    ).toEqual({ value: 'preserved' });
    expect(
      unchangedDatabase
        .prepare("SELECT name FROM sqlite_master WHERE name = 'failed_state'")
        .get(),
    ).toBeUndefined();

    const preMigrationCopy = trackDatabase(
      new Database(failedAttemptBackup, { readonly: true }),
    );
    expect(migrationVersion(preMigrationCopy)).toBe(1);
    expect(
      preMigrationCopy.prepare('SELECT value FROM legacy_state').get(),
    ).toEqual({ value: 'preserved' });
  });

  it('backs up and rolls back a failing first migration on an empty database', async () => {
    const root = await makeTempDirectory();
    const databasePath = join(root, 'empty.sqlite');
    const backupDir = join(root, 'backups');
    const migrationsFolder = join(root, 'migrations');
    await mkdir(join(migrationsFolder, 'meta'), { recursive: true });
    await writeFile(
      join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          {
            idx: 0,
            version: '6',
            when: 1_791_411_000_000,
            tag: '0000_invalid_first_migration',
            breakpoints: true,
          },
        ],
      }),
    );
    await writeFile(
      join(migrationsFolder, '0000_invalid_first_migration.sql'),
      'CREATE TABLE should_be_rolled_back (value TEXT NOT NULL);\n--> statement-breakpoint\nINSERT INTO missing_first_migration_dependency VALUES (1);\n',
    );
    new Database(databasePath).close();

    const childScript = `
      import Database from 'better-sqlite3';
      import { migrateDatabase } from './src/db/migrate.ts';
      const db = new Database(process.env.TEST_DATABASE_PATH);
      await migrateDatabase(db, {
        backupDir: process.env.TEST_BACKUP_DIR,
        migrationsFolder: process.env.TEST_MIGRATIONS_DIR,
        now: new Date('2026-10-08T13:00:00.000Z'),
      });
    `;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', childScript],
      {
        cwd: serverDirectory,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          TEST_DATABASE_PATH: databasePath,
          TEST_BACKUP_DIR: backupDir,
          TEST_MIGRATIONS_DIR: migrationsFolder,
        },
      },
    );

    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}\n${child.stderr}`).toContain(
      'missing_first_migration_dependency',
    );
    const firstMigrationBackup = join(
      backupDir,
      'pre_migration-2026-10-08T13-00-00.000Z.sqlite',
    );
    const { access } = await import('node:fs/promises');
    await expect(access(firstMigrationBackup)).resolves.toBeUndefined();

    const unchangedDatabase = trackDatabase(new Database(databasePath));
    expect(migrationVersion(unchangedDatabase)).toBe(0);
    const userTables = unchangedDatabase
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(userTables.map((table) => table.name)).toEqual([]);
    const backupDatabase = trackDatabase(
      new Database(firstMigrationBackup, { readonly: true }),
    );
    expect(
      backupDatabase
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([]);
  });

  it('reads and writes snapshot amounts exactly as BigInt beyond 2^53', async () => {
    const root = await makeTempDirectory();
    const database = trackDatabase(
      await openDatabase(
        parseConfig({
          NODE_ENV: 'test',
          DATA_DIR: join(root, 'data'),
          BACKUP_DIR: join(root, 'backups'),
        }),
      ),
    );
    const orm = drizzle(database);
    const amount = 9_007_199_254_740_993n;

    await orm
      .insert(member)
      .values({ id: 1, name: 'Balance owner', createdAt: 1 })
      .run();
    await orm
      .insert(account)
      .values({
        id: 1,
        name: 'Exact amount',
        type: 'bank',
        currency: 'EUR',
        createdBy: 1,
        createdAt: 1,
        updatedBy: 1,
        updatedAt: 1,
      })
      .run();
    await orm
      .insert(snapshot)
      .values({
        id: 1,
        accountId: 1,
        takenAt: 1,
        amount,
        source: 'manual',
        createdBy: 1,
        createdAt: 1,
        updatedBy: 1,
        updatedAt: 1,
      })
      .run();

    const [stored] = await orm
      .select({ amount: snapshot.amount })
      .from(snapshot);
    expect(stored?.amount).toBe(amount);
    expect(typeof stored?.amount).toBe('bigint');
  });

  it('uses the required default data and backup directories', () => {
    expect(parseConfig({})).toMatchObject({
      dataDir: '/data',
      backupDir: '/backups',
      databasePath: '/data/budget-buddy.sqlite',
    });
  });

  it('rejects every ISO 4217 code as a coin code regardless of letter case', async () => {
    const root = await makeTempDirectory();
    const database = trackDatabase(
      await openDatabase(
        parseConfig({
          NODE_ENV: 'test',
          DATA_DIR: join(root, 'data'),
          BACKUP_DIR: join(root, 'backups'),
        }),
      ),
    );
    const insertCoin = database.prepare(
      'INSERT INTO coin (code, name, decimals, feed_id, created_at) VALUES (?, ?, 2, ?, 1)',
    );

    for (const code of ISO_4217_CODES) {
      expect(() => insertCoin.run(code, code, 'test-feed'), code).toThrow();
      expect(() =>
        insertCoin.run(code.toLowerCase(), code, 'test-feed'),
      ).toThrow();
    }
    expect(() => insertCoin.run('BTC', 'Bitcoin', 'test-feed')).not.toThrow();
  });

  it('allows cadence day 9 but rejects malformed day values', async () => {
    const root = await makeTempDirectory();
    const database = trackDatabase(
      await openDatabase(
        parseConfig({
          NODE_ENV: 'test',
          DATA_DIR: join(root, 'data'),
          BACKUP_DIR: join(root, 'backups'),
        }),
      ),
    );
    const insertFamily = database.prepare(
      'INSERT INTO family (id, password_hash, cadence_day_of_month, created_at) VALUES (1, ?, ?, 1)',
    );
    expect(() => insertFamily.run('hash', '9')).not.toThrow();
    expect(() =>
      database
        .prepare("UPDATE family SET cadence_day_of_month = '1a' WHERE id = 1")
        .run(),
    ).toThrow();
    expect(
      database
        .prepare('SELECT cadence_day_of_month FROM family WHERE id = 1')
        .get(),
    ).toEqual({ cadence_day_of_month: '9' });
  });

  it('enforces Unicode case-insensitive uniqueness for active members', async () => {
    const root = await makeTempDirectory();
    const database = trackDatabase(
      await openDatabase(
        parseConfig({
          NODE_ENV: 'test',
          DATA_DIR: join(root, 'data'),
          BACKUP_DIR: join(root, 'backups'),
        }),
      ),
    );
    const insertMember = database.prepare(
      'INSERT INTO member (name, active, created_at) VALUES (?, ?, 1)',
    );
    insertMember.run('Émilie', 1);
    expect(() => insertMember.run('émilie', 1)).toThrow();
    expect(() => insertMember.run('émilie', 0)).not.toThrow();

    insertMember.run('ΟΣ', 1);
    expect(() => insertMember.run('οσ', 1)).toThrow();
    expect(() => insertMember.run('οσ', 0)).not.toThrow();
  });

  it('defines session ids as integer primary keys and requires unique token hashes', async () => {
    const root = await makeTempDirectory();
    const database = trackDatabase(
      await openDatabase(
        parseConfig({
          NODE_ENV: 'test',
          DATA_DIR: join(root, 'data'),
          BACKUP_DIR: join(root, 'backups'),
        }),
      ),
    );
    const idColumn = (
      database.prepare('PRAGMA table_info(session)').all() as Array<{
        name: string;
        type: string;
        pk: bigint;
      }>
    ).find((column) => column.name === 'id');
    expect(idColumn).toMatchObject({ type: 'INTEGER', pk: 1n });

    await database
      .prepare(
        'INSERT INTO device (id, created_at, last_seen_at) VALUES (?, 1, 1)',
      )
      .run('device-1');
    const insertSession = database.prepare(
      'INSERT INTO session (token_hash, device_id, password_epoch, created_at, last_used_at, expires_at) VALUES (?, ?, 0, 1, 1, 2)',
    );
    insertSession.run('token-hash-1', 'device-1');
    const stored = database
      .prepare('SELECT id, typeof(id) AS id_type FROM session')
      .get() as { id: bigint; id_type: string };
    expect(stored).toMatchObject({ id_type: 'integer' });
    expect(stored.id).toBeGreaterThan(0n);

    expect(() =>
      database
        .prepare(
          "INSERT INTO session (id, token_hash, device_id, password_epoch, created_at, last_used_at, expires_at) VALUES ('not-an-integer', 'token-hash-2', 'device-1', 0, 1, 1, 2)",
        )
        .run(),
    ).toThrow();
    expect(() => insertSession.run('token-hash-1', 'device-1')).toThrow();
  });

  it('returns 200 with the migration version and 503 when SQLite cannot read the database file', async () => {
    const root = await makeTempDirectory();
    const databasePath = join(root, 'unreadable.sqlite');
    await writeFile(databasePath, 'this is not a SQLite database');
    const unreadableDatabase = trackDatabase(new Database(databasePath));
    app = await createApp({ database: unreadableDatabase, logger: false });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: 'unavailable', message: 'Database unavailable' },
    });
  });

  it('redacts a password logged from a request body', async () => {
    const database = trackDatabase(new Database(':memory:'));
    const logLines: string[] = [];
    app = await createApp({
      database,
      loggerStream: { write: (line) => logLines.push(line) },
    });
    app.post('/test/log-password', async (request, reply) => {
      request.log.info(
        request.body as { password: string },
        'received request body',
      );
      return reply.code(204).send();
    });

    const secret = 'unique-password-value-for-redaction-test';
    const response = await app.inject({
      method: 'POST',
      url: '/test/log-password',
      payload: { password: secret },
    });
    const logs = logLines.join('\n');

    expect(response.statusCode).toBe(204);
    expect(logs).toContain('[Redacted]');
    expect(logs).not.toContain(secret);
  });

  it('serves the production SPA fallback without masking unknown API routes', async () => {
    const staticRoot = join(await makeTempDirectory(), 'web-dist');
    await mkdir(staticRoot);
    const expectedIndex = '<!doctype html><title>Static fixture</title>';
    await writeFile(join(staticRoot, 'index.html'), expectedIndex);
    const database = trackDatabase(new Database(':memory:'));
    app = await createApp({ database, logger: false, staticRoot });
    const clientRoute = await app.inject({
      method: 'GET',
      url: '/accounts/overview',
    });
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.headers['content-type']).toContain('text/html');
    expect(clientRoute.body).toBe(expectedIndex);

    const unknownApiRoute = await app.inject({
      method: 'GET',
      url: '/api/route-that-does-not-exist',
    });
    expect(unknownApiRoute.statusCode).toBe(404);
    expect(unknownApiRoute.json()).toEqual({
      error: { code: 'not_found', message: 'Not found' },
    });
  });

  it('returns the exact not-found API error when the configured static root is missing', async () => {
    const root = await makeTempDirectory();
    const missingStaticRoot = join(root, 'web-dist-does-not-exist');
    const database = trackDatabase(new Database(':memory:'));
    app = await createApp({
      database,
      logger: false,
      staticRoot: missingStaticRoot,
    });

    const unknownApiRoute = await app.inject({
      method: 'GET',
      url: '/api/unknown',
    });

    expect(unknownApiRoute.statusCode).toBe(404);
    expect(unknownApiRoute.json()).toEqual({
      error: { code: 'not_found', message: 'Not found' },
    });
  });
});
