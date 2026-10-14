import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrateDatabase, migrationVersion } from '../src/db/migrate.js';
import {
  insertStarterCategories,
  starterCategories,
} from '../src/db/starterCategories.js';

const drizzleFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';

/** Every table of spec 1 (migrations 0000 to 0004). */
const spec1Tables = [
  'family',
  'member',
  'device',
  'session',
  'passkey',
  'push_subscription',
  'coin',
  'account',
  'checkin',
  'snapshot',
  'snapshot_revision',
  'rate',
  'rate_fetch',
  'job_run',
  'notification',
  'backup',
] as const;

const spec2Tables = [
  'category',
  'envelope',
  'envelope_plan',
  'envelope_topup',
  'envelope_adjustment',
  'txn',
  'txn_part',
  'txn_revision',
  'rule',
] as const;

/**
 * Rows like the family's database has after spec 1, with every spec 1 table
 * filled: a closed and an open check-in, carried-forward snapshots, a deleted
 * snapshot kept in its revision, a retired account, an inactive member.
 */
const spec1Rows = `
  INSERT INTO family (id, password_hash, common_currency, time_zone,
    cadence_kind, cadence_day_of_month, followup_days, created_at)
  VALUES (1, '$argon2id$v=19$m=19456,t=2,p=1$x$y', 'EUR', 'Europe/Berlin',
    'monthly', '1', 2, 1790000000000);
  INSERT INTO coin (code, name, decimals, feed_id, created_at) VALUES
    ('BTC', 'Bitcoin', 8, 'BTC-EUR', 1790000000000),
    ('USDT', 'Tether', 6, 'USDT-EUR', 1790000000000);
  INSERT INTO member (id, name, active, created_at, deactivated_at) VALUES
    (1, 'Alex', 1, 1790000000000, NULL),
    (2, 'Дарья', 1, 1790000000000, NULL),
    (3, 'Old profile', 0, 1790000000000, 1790500000000);
  INSERT INTO device (id, default_member_id, hide_home_amounts, lock_on_reopen,
    label, created_at, last_seen_at) VALUES
    ('dev-a', 1, 1, 1, 'iPhone', 1790000000000, 1791000000000),
    ('dev-b', 2, 0, 0, 'iPad', 1790000000000, 1791000000000);
  INSERT INTO session (token_hash, device_id, member_id, password_epoch,
    created_at, last_used_at, foreground_at, expires_at) VALUES
    ('hash-a', 'dev-a', 1, 0, 1790000000000, 1791000000000, 1791000000000,
     1797000000000),
    ('hash-b', 'dev-b', NULL, 0, 1790000000000, 1791000000000, 1791000000000,
     1797000000000);
  INSERT INTO passkey (device_id, credential_id, public_key, counter,
    created_at) VALUES ('dev-a', 'cred-1', 'pk-1', 7, 1790000000000);
  INSERT INTO push_subscription (device_id, member_id, endpoint, p256dh, auth,
    created_at, last_success_at, failures) VALUES
    ('dev-a', 1, 'https://push.example/a', 'p', 'a', 1790000000000,
     1791000000000, 0);
  INSERT INTO account (id, name, owner_member_id, type, currency, active,
    deactivated_at, created_by, created_at, updated_by, updated_at) VALUES
    (1, 'Giro', 1, 'bank', 'EUR', 1, NULL, 1, 1790000000000, 1, 1790000000000),
    (2, 'Cash Alex', 1, 'cash', 'EUR', 1, NULL, 1, 1790000000000, 1,
     1790000000000),
    (3, 'Wise $', 2, 'bank', 'USD', 1, NULL, 2, 1790000000000, 2,
     1790000000000),
    (4, 'Bitcoin', NULL, 'crypto', 'BTC', 1, NULL, 1, 1790000000000, 1,
     1790000000000),
    (5, 'Loan', NULL, 'owed_to_us', 'RUB', 0, 1790600000000, 1, 1790000000000,
     1, 1790600000000);
  INSERT INTO checkin (id, opened_at, opened_by, schedule_slot, closed_at,
    closed_by) VALUES
    (1, 1790100000000, 1, '2026-10-01', 1790200000000, 2),
    (2, 1791000000000, NULL, '2026-11-01', NULL, NULL);
  INSERT INTO snapshot (id, account_id, taken_at, amount, source, checkin_id,
    created_by, created_at, updated_by, updated_at) VALUES
    (1, 1, 1790000000000, 456789, 'opening', NULL, 1, 1790000000000, 1,
     1790000000000),
    (2, 1, 1790100000000, -198630, 'checkin', 1, 1, 1790100000000, 2,
     1790100000000),
    (3, 3, 1790100000000, 9007199254740993, 'checkin', 1, 2, 1790100000000, 2,
     1790100000000),
    (4, 4, 1790100000000, 125000000, 'carried_forward', 1, 1, 1790100000000, 1,
     1790100000000),
    (5, 2, 1791000000000, 4200, 'manual', NULL, 1, 1791000000000, 1,
     1791000000000);
  INSERT INTO snapshot_revision (id, snapshot_id, account_id, action,
    old_amount, old_taken_at, changed_by, changed_at) VALUES
    (1, 2, 1, 'update', -190000, 1790100000000, 1, 1790150000000),
    (2, 99, 1, 'delete', 777, 1790050000000, 2, 1790160000000);
  INSERT INTO rate (base, quote, date, rate, source, fetched_at) VALUES
    ('EUR', 'USD', '2026-10-09', '1.0876543210987654321', 'ECB', 1790300000000),
    ('EUR', 'RUB', '2026-10-09', '98.5', 'CBR', 1790300000000),
    ('BTC', 'EUR', '2026-10-09', '61234.5', 'coingecko', 1790300000000);
  INSERT INTO rate_fetch (feed_id, date, status, error, at) VALUES
    ('ECB', '2026-10-09', 'ok', NULL, 1790300000000),
    ('CBR', '2026-10-10', 'failed', 'timeout', 1790400000000);
  INSERT INTO job_run (job, slot, status, attempts, started_at, finished_at,
    error) VALUES
    ('daily-backup', '2026-10-09', 'done', 1, 1790300000000, 1790300001000,
     NULL),
    ('rates', '2026-10-10', 'failed', 3, 1790400000000, 1790400001000, 'x');
  INSERT INTO notification (event, checkin_id, member_id, slot, sent_at)
    VALUES ('checkin_opened', 1, 1, '2026-10-01', 1790100000000);
  INSERT INTO backup (kind, path, bytes, started_at, finished_at, status,
    error) VALUES
    ('daily', '/backups/daily-1.sqlite', 90112, 1790300000000, 1790300001000,
     'done', NULL),
    ('pre_migration', '/backups/pre_migration-1.sqlite', 90112, 1790000000000,
     1790000001000, 'done', NULL);
`;

describe('migration 0005: spending schema', () => {
  let root: string;
  let databases: Database.Database[] = [];
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'budget-buddy-spending-schema-'));
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const database of databases) if (database.open) database.close();
    databases = [];
    await rm(root, { recursive: true, force: true });
  });

  const track = (database: Database.Database) => {
    databases.push(database);
    return database;
  };

  /** A copy of the migrations folder as `main` had it before 0005. */
  async function previousMainMigrations(): Promise<string> {
    const folder = join(root, 'main-migrations');
    await mkdir(join(folder, 'meta'), { recursive: true });
    const journal = JSON.parse(
      await readFile(join(drizzleFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const kept = journal.entries.filter(({ tag }) => !tag.startsWith('0005_'));
    expect(kept).toHaveLength(5);
    for (const { tag } of kept) {
      await cp(join(drizzleFolder, `${tag}.sql`), join(folder, `${tag}.sql`));
    }
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: kept }),
    );
    return folder;
  }

  /** The family's database file as `main` leaves it, with spec 1 data in it. */
  async function oldMainDatabase(dataDir: string): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    const database = new Database(join(dataDir, 'budget-buddy.sqlite'));
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    expect(
      await migrateDatabase(database, {
        backupDir: join(root, 'old-backups'),
        migrationsFolder: await previousMainMigrations(),
      }),
    ).toBe(5);
    database.exec(spec1Rows);
    database.close();
  }

  const dump = (database: Database.Database, table: string) =>
    database
      .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
      .safeIntegers(true)
      .all();

  const config = (dataDir: string, backupDir: string) =>
    parseConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, BACKUP_DIR: backupDir });

  it('keeps every spec 1 row, passes the foreign-key check, and adds 16 starter categories once', async () => {
    const dataDir = join(root, 'data');
    const backupDir = join(root, 'backups');
    await oldMainDatabase(dataDir);

    const before = new Database(join(dataDir, 'budget-buddy.sqlite'));
    const expected = Object.fromEntries(
      spec1Tables.map((table) => [table, dump(before, table)]),
    );
    for (const table of spec1Tables) {
      expect(expected[table]?.length, `${table} has rows`).toBeGreaterThan(0);
    }
    before.close();

    // First start after the merge.
    const database = track(await openDatabase(config(dataDir, backupDir)));
    expect(migrationVersion(database)).toBe(6);
    for (const table of spec1Tables) {
      expect(dump(database, table), table).toEqual(expected[table]);
    }
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    const backups = await readdir(backupDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^pre_migration-.*\.sqlite$/);

    const categories = database
      .prepare(
        'SELECT name, kind, position, default_envelope_id, archived_at, created_by, updated_by FROM category ORDER BY position',
      )
      .all();
    expect(categories).toEqual(
      starterCategories.map(({ name, kind }, index) => ({
        name,
        kind,
        position: BigInt(index + 1),
        default_envelope_id: null,
        archived_at: null,
        created_by: null,
        updated_by: null,
      })),
    );
    expect(categories).toHaveLength(16);
    // Stamped in milliseconds, like every other instant of the database.
    const stamps = database
      .prepare('SELECT DISTINCT created_at, updated_at FROM category')
      .all() as Array<{ created_at: bigint; updated_at: bigint }>;
    expect(stamps).toHaveLength(1);
    expect(Math.abs(Number(stamps[0]?.created_at) - Date.now())).toBeLessThan(
      60_000,
    );
    expect(stamps[0]?.updated_at).toBe(stamps[0]?.created_at);
    expect(
      database
        .prepare("SELECT COUNT(*) AS n FROM category WHERE kind = 'income'")
        .get(),
    ).toEqual({ n: 2n });
    for (const table of spec2Tables.filter((name) => name !== 'category')) {
      expect(dump(database, table), table).toEqual([]);
    }

    // Restarts, as at a deploy: no second migration, backup or category.
    database.close();
    for (let start = 0; start < 2; start += 1) {
      const again = track(await openDatabase(config(dataDir, backupDir)));
      expect(migrationVersion(again)).toBe(6);
      expect(dump(again, 'category')).toHaveLength(16);
      again.close();
    }
    expect(await readdir(backupDir)).toEqual(backups);
  });

  it('adds the starter list when first start runs, not before, and never twice', async () => {
    const dataDir = join(root, 'data');
    const database = track(
      await openDatabase(config(dataDir, join(root, 'backups'))),
    );
    // A new install: the migration saw no family, so it adds nothing.
    expect(dump(database, 'category')).toEqual([]);

    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
    });
    const password = 'correct horse battery staple';
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { origin, 'content-type': 'application/json' },
      payload: { password, passwordConfirmation: password, profiles: ['Alex'] },
    });
    expect(setup.statusCode).toBe(201);
    expect(dump(database, 'category')).toHaveLength(16);

    // First start can't run again, and the insert itself is idempotent.
    const second = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { origin, 'content-type': 'application/json' },
      payload: { password, passwordConfirmation: password, profiles: ['Alex'] },
    });
    expect(second.statusCode).toBe(403);
    insertStarterCategories(database, 1);
    expect(dump(database, 'category')).toHaveLength(16);

    // A restart of the finished install adds nothing either.
    await app.close();
    app = undefined;
    database.close();
    const restarted = track(
      await openDatabase(config(dataDir, join(root, 'backups'))),
    );
    expect(dump(restarted, 'category')).toHaveLength(16);
  });

  it('seeds the same list in the migration and in the code', async () => {
    const sql = await readFile(
      join(drizzleFolder, '0005_spending-schema.sql'),
      'utf8',
    );
    const seeded = [
      ...sql.matchAll(/\('([^']+)', '(expense|income)', (\d+)\)/g),
    ];
    expect(
      seeded.map(([, name, kind, position]) => [name, kind, position]),
    ).toEqual(
      starterCategories.map(({ name, kind }, index) => [
        name,
        kind,
        String(index + 1),
      ]),
    );
  });

  describe('constraints', () => {
    let database: Database.Database;

    beforeEach(async () => {
      database = track(new Database(join(root, 'constraints.sqlite')));
      database.pragma('foreign_keys = ON');
      await migrateDatabase(database, { backupDir: root });
      database.exec(`
        INSERT INTO member (id, name, created_at) VALUES (1, 'Alex', 1);
        INSERT INTO account (id, name, type, currency, created_by, created_at,
          updated_by, updated_at) VALUES
          (1, 'Giro', 'bank', 'EUR', 1, 1, 1, 1),
          (2, 'Cash', 'cash', 'EUR', 1, 1, 1, 1);
        INSERT INTO envelope (id, name, currency, starting_balance,
          starting_month, topup_from_month, position, created_by, created_at,
          updated_by, updated_at)
          VALUES (1, 'Groceries', 'EUR', 0, '2026-10', '2026-11', 1, 1, 1, 1, 1);
        INSERT INTO category (id, name, kind, position, created_at, updated_at)
          VALUES (1, 'Groceries', 'expense', 1, 1, 1);
        INSERT INTO txn (id, kind, date, account_id, amount, member_id,
          created_by, created_at, updated_by, updated_at)
          VALUES (1, 'expense', '2026-10-01', 1, 100, 1, 1, 1, 1, 1);
      `);
    });

    const txn = (columns: string, values: string) =>
      `INSERT INTO txn (kind, date, account_id, member_id, created_by,
         created_at, updated_by, updated_at, ${columns})
       VALUES ('expense', '2026-10-02', 1, 1, 1, 1, 1, 1, ${values})`;
    const transfer = (extra: string, extraValues: string) =>
      `INSERT INTO txn (kind, date, account_id, member_id, created_by,
         created_at, updated_by, updated_at, ${extra})
       VALUES ('transfer', '2026-10-02', 1, 1, 1, 1, 1, 1, ${extraValues})`;

    const refused: Array<[string, string, RegExp]> = [
      [
        'an expense of 0',
        txn('amount', '0'),
        /CHECK constraint failed: txn_expense_amount_check/,
      ],
      [
        'an income of 0',
        `INSERT INTO txn (kind, date, account_id, amount, member_id, created_by, created_at, updated_by, updated_at) VALUES ('income', '2026-10-02', 1, 0, 1, 1, 1, 1, 1)`,
        /CHECK constraint failed: txn_income_amount_check/,
      ],
      [
        'an income below zero',
        `INSERT INTO txn (kind, date, account_id, amount, member_id, created_by, created_at, updated_by, updated_at) VALUES ('income', '2026-10-02', 1, -5, 1, 1, 1, 1, 1)`,
        /CHECK constraint failed: txn_income_amount_check/,
      ],
      [
        'a transfer to the same account',
        transfer('amount, to_account_id, to_amount', '10, 1, 10'),
        /CHECK constraint failed: txn_transfer_check/,
      ],
      [
        'a transfer without a target account',
        transfer('amount, to_amount', '10, 10'),
        /CHECK constraint failed: txn_transfer_check/,
      ],
      [
        'a transfer without a target amount',
        transfer('amount, to_account_id', '10, 2'),
        /CHECK constraint failed: txn_transfer_check/,
      ],
      [
        'a transfer of 0 or less',
        transfer('amount, to_account_id, to_amount', '0, 2, 10'),
        /CHECK constraint failed: txn_transfer_check/,
      ],
      [
        'a transfer into a negative target amount',
        transfer('amount, to_account_id, to_amount', '10, 2, -10'),
        /CHECK constraint failed: txn_transfer_check/,
      ],
      [
        'a transfer with a merchant',
        transfer(
          'amount, to_account_id, to_amount, merchant',
          "10, 2, 10, 'REWE'",
        ),
        /CHECK constraint failed: txn_transfer_check/,
      ],
      [
        'an expense with a target account',
        txn('amount, to_account_id, to_amount', '5, 2, 5'),
        /CHECK constraint failed: txn_no_transfer_side_check/,
      ],
      [
        'an external id without a source reference',
        txn('amount, external_id', "5, 'x'"),
        /CHECK constraint failed: txn_external_source_check/,
      ],
      [
        'a duplicate client id',
        txn('amount, client_id', "5, 'c-1'") +
          ';' +
          txn('amount, client_id', "6, 'c-1'"),
        /UNIQUE constraint failed: txn.client_id/,
      ],
      [
        'a duplicate source reference and external id',
        txn('amount, source_ref, external_id', "5, 's', 'e'") +
          ';' +
          txn('amount, source_ref, external_id', "6, 's', 'e'"),
        /UNIQUE constraint failed: txn.source_ref, txn.external_id/,
      ],
      [
        'a transaction date that is not a date',
        txn('amount', '5').replace("'2026-10-02'", "'02/10/2026'"),
        /CHECK constraint failed: txn_date_check/,
      ],
      [
        'a transaction of an unknown kind',
        txn('amount', '5').replace("'expense'", "'gift'"),
        /CHECK constraint failed: txn_kind_check/,
      ],
      [
        'a duplicate category name in another case',
        `INSERT INTO category (name, kind, position, created_at, updated_at) VALUES ('GROCERIES', 'expense', 99, 1, 1)`,
        /UNIQUE constraint failed: index 'category_kind_name_unique'/,
      ],
      [
        'a duplicate category name written with an umlaut in another case',
        `INSERT INTO category (name, kind, position, created_at, updated_at) VALUES ('Bäckerei', 'expense', 98, 1, 1); INSERT INTO category (name, kind, position, created_at, updated_at) VALUES ('BÄCKEREI', 'expense', 99, 1, 1)`,
        /UNIQUE constraint failed: index 'category_kind_name_unique'/,
      ],
      [
        'a default envelope on an income category',
        `INSERT INTO category (name, kind, default_envelope_id, position, created_at, updated_at) VALUES ('Bonus', 'income', 1, 99, 1, 1)`,
        /CHECK constraint failed: category_default_envelope_check/,
      ],
      [
        'a category of an unknown kind',
        `INSERT INTO category (name, kind, position, created_at, updated_at) VALUES ('X', 'transfer', 99, 1, 1)`,
        /CHECK constraint failed: category_kind_check/,
      ],
      [
        'a second envelope_topup for one month',
        `INSERT INTO envelope_topup (envelope_id, month, amount, mode, created_at) VALUES (1, '2026-11', 100, 'reset', 1); INSERT INTO envelope_topup (envelope_id, month, amount, mode, created_at) VALUES (1, '2026-11', 100, 'reset', 2)`,
        /UNIQUE constraint failed: envelope_topup.envelope_id, envelope_topup.month/,
      ],
      [
        'a duplicate envelope name in another case',
        `INSERT INTO envelope (name, currency, starting_balance, starting_month, topup_from_month, position, created_by, created_at, updated_by, updated_at) VALUES ('groceries', 'EUR', 0, '2026-10', '2026-11', 2, 1, 1, 1, 1)`,
        /UNIQUE constraint failed: index 'envelope_name_unique'/,
      ],
      [
        'an envelope month that is not a month',
        `INSERT INTO envelope (name, currency, starting_balance, starting_month, topup_from_month, position, created_by, created_at, updated_by, updated_at) VALUES ('Trips', 'EUR', 0, '2026-13', '2026-11', 2, 1, 1, 1, 1)`,
        /CHECK constraint failed: envelope_starting_month_check/,
      ],
      [
        'two plans for one envelope and month',
        `INSERT INTO envelope_plan (envelope_id, from_month, monthly_amount, mode, created_by, created_at) VALUES (1, '2026-10', 100, 'reset', 1, 1); INSERT INTO envelope_plan (envelope_id, from_month, monthly_amount, mode, created_by, created_at) VALUES (1, '2026-10', 200, 'carry_over', 1, 1)`,
        /UNIQUE constraint failed: envelope_plan.envelope_id, envelope_plan.from_month/,
      ],
      [
        'a negative monthly amount',
        `INSERT INTO envelope_plan (envelope_id, from_month, monthly_amount, mode, created_by, created_at) VALUES (1, '2026-10', -1, 'reset', 1, 1)`,
        /CHECK constraint failed: envelope_plan_amount_check/,
      ],
      [
        'a plan with an unknown mode',
        `INSERT INTO envelope_plan (envelope_id, from_month, monthly_amount, mode, created_by, created_at) VALUES (1, '2026-10', 1, 'spend', 1, 1)`,
        /CHECK constraint failed: envelope_plan_mode_check/,
      ],
      [
        'an adjustment of 0',
        `INSERT INTO envelope_adjustment (envelope_id, date, amount, created_by, created_at) VALUES (1, '2026-10-02', 0, 1, 1)`,
        /CHECK constraint failed: envelope_adjustment_amount_check/,
      ],
      [
        'an envelope amount without an envelope',
        `INSERT INTO txn_part (txn_id, position, amount, envelope_amount) VALUES (1, 1, 100, 100)`,
        /CHECK constraint failed: txn_part_envelope_amount_check/,
      ],
      [
        'two parts at one position',
        `INSERT INTO txn_part (txn_id, position, amount) VALUES (1, 1, 100); INSERT INTO txn_part (txn_id, position, amount) VALUES (1, 1, 100)`,
        /UNIQUE constraint failed: txn_part.txn_id, txn_part.position/,
      ],
      [
        'a part of a missing transaction',
        `INSERT INTO txn_part (txn_id, position, amount) VALUES (42, 1, 100)`,
        /FOREIGN KEY constraint failed/,
      ],
      [
        'a revision whose changes are not JSON',
        `INSERT INTO txn_revision (txn_id, action, changes, changed_by, changed_at) VALUES (1, 'update', 'not json', 1, 1)`,
        /CHECK constraint failed: txn_revision_changes_check/,
      ],
      [
        'two rules at one position',
        `INSERT INTO rule (position, pattern, category_id, created_by, created_at, updated_by, updated_at) VALUES (1, 'REWE', 1, 1, 1, 1, 1); INSERT INTO rule (position, pattern, category_id, created_by, created_at, updated_by, updated_at) VALUES (1, 'LIDL', 1, 1, 1, 1, 1)`,
        /UNIQUE constraint failed: rule.position/,
      ],
      [
        'a blank rule pattern',
        `INSERT INTO rule (position, pattern, category_id, created_by, created_at, updated_by, updated_at) VALUES (5, '  ', 1, 1, 1, 1, 1)`,
        /CHECK constraint failed: rule_pattern_check/,
      ],
    ];

    it.each(refused)('refuses %s', (_name, statement, message) => {
      const run = () => database.exec(statement);
      expect(run).toThrow(message);
    });

    it('accepts the valid forms the checks must let through', () => {
      database.exec(`
        INSERT INTO txn (kind, date, account_id, amount, member_id, created_by,
          created_at, updated_by, updated_at) VALUES
          ('expense', '2026-10-02', 1, 500, 1, 1, 1, 1, 1),
          ('income', '2026-10-02', 1, 500, 1, 1, 1, 1, 1);
        INSERT INTO txn (kind, date, account_id, amount, to_account_id,
          to_amount, member_id, created_by, created_at, updated_by, updated_at)
          VALUES ('transfer', '2026-10-02', 1, 100, 2, 100, 1, 1, 1, 1, 1);
        INSERT INTO txn (client_id, kind, date, account_id, amount, member_id,
          created_by, created_at, updated_by, updated_at) VALUES
          (NULL, 'expense', '2026-10-02', 1, 1, 1, 1, 1, 1, 1),
          (NULL, 'expense', '2026-10-02', 1, 1, 1, 1, 1, 1, 1);
        INSERT INTO category (name, kind, position, created_at, updated_at)
          VALUES ('Groceries', 'income', 50, 1, 1);
      `);
    });

    it('deletes the parts of a deleted transaction, and never reuses its id', () => {
      database.exec(
        'INSERT INTO txn_part (txn_id, position, amount) VALUES (1, 1, 100)',
      );
      database.exec('DELETE FROM txn WHERE id = 1');
      expect(dump(database, 'txn_part')).toEqual([]);
      const next = database
        .prepare(
          `INSERT INTO txn (kind, date, account_id, amount, member_id,
             created_by, created_at, updated_by, updated_at)
           VALUES ('expense', '2026-10-02', 1, 1, 1, 1, 1, 1, 1)`,
        )
        .run();
      expect(next.lastInsertRowid).toBe(2n);
    });
  });
});
