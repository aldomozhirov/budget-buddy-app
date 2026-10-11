import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { toCsv } from '../src/export/csv.js';
import {
  exportExclusions,
  exportFiles,
  headerOf,
} from '../src/export/files.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** The files and exact columns of the export (BKP-3, SEC-6). */
const expectedHeaders: Record<string, string[]> = {
  'members.csv': ['id', 'name', 'active', 'created_at', 'deactivated_at'],
  'accounts.csv': [
    'id',
    'name',
    'owner_member_id',
    'type',
    'currency',
    'active',
    'deactivated_at',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
  ],
  'snapshots.csv': [
    'id',
    'account_id',
    'taken_at',
    'amount',
    'currency',
    'source',
    'checkin_id',
    'source_ref',
    'external_id',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
  ],
  'snapshot_revisions.csv': [
    'id',
    'snapshot_id',
    'account_id',
    'action',
    'old_amount',
    'currency',
    'old_taken_at',
    'changed_by',
    'changed_at',
  ],
  'checkins.csv': [
    'id',
    'opened_at',
    'opened_by',
    'schedule_slot',
    'closed_at',
    'closed_by',
  ],
  'rates.csv': ['base', 'quote', 'date', 'rate', 'source', 'fetched_at'],
  'coins.csv': ['code', 'name', 'decimals', 'feed_id', 'created_at'],
  'settings.csv': ['setting', 'value'],
};

/** Reads CSV text into rows of cells, understanding quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text[index + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
    } else cell += char;
  }
  return rows;
}

describe('export', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let cookies: string;
  const now = Date.parse('2026-10-11T10:00:00Z');

  const cookiesOf = (response: { headers: Record<string, unknown> }) => {
    const header = response.headers['set-cookie'];
    return (Array.isArray(header) ? header : [header])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.split(';', 1)[0])
      .join('; ');
  };
  const download = (headers: Record<string, string> = { cookie: cookies }) =>
    app.inject({ method: 'GET', url: '/api/export', headers });
  const files = async () => {
    const response = await download();
    expect(response.statusCode).toBe(200);
    const archive = unzipSync(new Uint8Array(response.rawPayload));
    return Object.fromEntries(
      Object.entries(archive).map(([name, bytes]) => [name, strFromU8(bytes)]),
    );
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-export-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
    });
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: jsonHeaders,
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair, "B."\nSecond line', 'Дарья'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookies = cookiesOf(setup);
    seed();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  /** Amounts in three currencies, some negative and one beyond 2^53. */
  function seed(): void {
    database
      .prepare(
        "INSERT INTO coin (code, name, decimals, feed_id, created_at) VALUES ('XBT', 'Test coin', 8, 'fixture', 5)",
      )
      .run();
    const account = database.prepare(
      `INSERT INTO account (name, owner_member_id, type, currency, created_by,
        created_at, updated_by, updated_at) VALUES (?, 1, 'bank', ?, 1, 2, 1, 3)`,
    );
    account.run('Giro', 'EUR');
    account.run('Tokyo', 'JPY');
    account.run('Coins', 'XBT');
    database
      .prepare(
        'INSERT INTO checkin (opened_at, opened_by, closed_at, closed_by) VALUES (1000, 1, 2000, 1)',
      )
      .run();
    const snapshot = database.prepare(
      `INSERT INTO snapshot (account_id, taken_at, amount, source, checkin_id,
        created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 10, 1, 11)`,
    );
    snapshot.run(1, 1500, -198630n, 'checkin', 1);
    snapshot.run(1, 1600, 5n, 'manual', null);
    snapshot.run(2, 1500, 9007199254740993n, 'manual', null);
    snapshot.run(3, 1500, 1n, 'manual', null);
    snapshot.run(3, 1700, -123456789012n, 'manual', null);
    database
      .prepare(
        `INSERT INTO snapshot_revision (snapshot_id, account_id, action,
          old_amount, old_taken_at, changed_by, changed_at)
         VALUES (2, 1, 'update', -7, 1400, 1, 1800)`,
      )
      .run();
    database
      .prepare(
        "INSERT INTO rate (base, quote, date, rate, source, fetched_at) VALUES ('EUR', 'USD', '2026-10-09', '1.0876543210987654321', 'ECB', 99)",
      )
      .run();
    // Secrets that must never reach the export.
    database
      .prepare(
        `INSERT INTO push_subscription (device_id, member_id, endpoint, p256dh, auth, created_at)
         SELECT id, 1, 'https://push.example/ENDPOINT-SECRET', 'P256DH-SECRET', 'AUTH-SECRET', 1 FROM device LIMIT 1`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at)
         SELECT id, 'CREDENTIAL-SECRET', 'PUBLICKEY-SECRET', 0, 1 FROM device LIMIT 1`,
      )
      .run();
  }

  it('needs a signed-in member with a profile', async () => {
    expect((await download({})).statusCode).toBe(401);
    // A device that has the password but has not picked a profile yet.
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: jsonHeaders,
      payload: { password },
    });
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json()).toEqual({ profileRequired: true });
    const profileless = await download({ cookie: cookiesOf(signIn) });
    expect(profileless.statusCode).toBe(403);
    expect(profileless.json().error.code).toBe('profile_required');
  });

  it('refuses a state-changing request to the route, like any other', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      headers: { cookie: cookies, 'content-type': 'text/plain' },
      payload: '',
    });
    expect(response.statusCode).toBe(403);
  });

  it('sends a zip to save, never to cache', async () => {
    const response = await download();
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="budget-buddy-export-2026-10-11.zip"',
    );
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('contains every listed CSV and nothing else', async () => {
    expect(Object.keys(await files()).sort()).toEqual(
      Object.keys(expectedHeaders).sort(),
    );
  });

  it('writes exactly the columns listed, and fails on an unknown one', async () => {
    const written = await files();
    for (const [name, header] of Object.entries(expectedHeaders)) {
      expect(parseCsv(written[name] ?? '')[0], name).toEqual(header);
    }
    // The definitions are the same list; a new column must be added to both.
    expect(
      Object.fromEntries(
        exportFiles.map((file) => [file.name, headerOf(file)]),
      ),
    ).toEqual(expectedHeaders);
  });

  it('accounts for every column of the schema: exported or excluded on purpose', () => {
    const tables = (
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'",
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    const columnsOf = (table: string) =>
      (
        database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
        }>
      ).map(({ name }) => name);
    for (const table of tables) {
      const exported = new Set(
        exportFiles
          .filter((file) => file.table === table)
          .flatMap((file) => file.columns.map(({ column }) => column)),
      );
      const exclusion = exportExclusions[table];
      if (exclusion === 'table') {
        expect(exported.size, `${table} is excluded`).toBe(0);
        continue;
      }
      const left = new Set(exclusion?.columns ?? []);
      for (const column of columnsOf(table)) {
        expect(
          exported.has(column) !== left.has(column),
          `${table}.${column} must be exported or excluded, not both or neither`,
        ).toBe(true);
      }
      for (const column of [...exported, ...left]) {
        if (column !== null) expect(columnsOf(table)).toContain(column);
      }
    }
  });

  it('holds no password hash, session, passkey, push or key material (SEC-6)', async () => {
    const hash = (
      database.prepare('SELECT password_hash FROM family').get() as {
        password_hash: string;
      }
    ).password_hash;
    const tokenHash = (
      database.prepare('SELECT token_hash FROM session LIMIT 1').get() as {
        token_hash: string;
      }
    ).token_hash;
    const everything = Object.values(await files()).join('\n');
    for (const secret of [
      hash,
      '$argon2',
      tokenHash,
      'ENDPOINT-SECRET',
      'P256DH-SECRET',
      'AUTH-SECRET',
      'CREDENTIAL-SECRET',
      'PUBLICKEY-SECRET',
      password,
    ]) {
      expect(everything).not.toContain(secret);
    }
    for (const forbidden of [
      /password/iu,
      /hash/iu,
      /token/iu,
      /session/iu,
      /passkey/iu,
      /endpoint/iu,
      /p256dh/iu,
      /vapid/iu,
      /secret/iu,
      /credential/iu,
      /public_key/iu,
    ]) {
      for (const [name, text] of Object.entries(await files())) {
        expect(parseCsv(text)[0]?.join(','), name).not.toMatch(forbidden);
      }
    }
  });

  it('writes amounts as exact decimal strings that match the database', async () => {
    const written = await files();
    const rows = parseCsv(written['snapshots.csv'] ?? '').slice(1);
    const stored = database
      .prepare('SELECT id, amount FROM snapshot ORDER BY id')
      .safeIntegers(true)
      .all() as Array<{ id: bigint; amount: bigint }>;
    expect(rows).toHaveLength(stored.length);
    expect(rows.map((row) => [row[0], row[3], row[4]])).toEqual([
      ['1', '-1986.30', 'EUR'],
      ['2', '0.05', 'EUR'],
      ['3', '9007199254740993', 'JPY'],
      ['4', '0.00000001', 'XBT'],
      ['5', '-1234.56789012', 'XBT'],
    ]);
    // Without the point, each cell is the stored integer, digit for digit.
    stored.forEach(({ amount }, index) => {
      expect(BigInt((rows[index]?.[3] ?? '').replace('.', ''))).toBe(amount);
    });
    const revisions = parseCsv(written['snapshot_revisions.csv'] ?? '').slice(
      1,
    );
    expect(revisions[0]?.slice(3, 6)).toEqual(['update', '-0.07', 'EUR']);
  });

  it('writes instants as ISO 8601 in UTC and keeps rates exact', async () => {
    const written = await files();
    expect(parseCsv(written['checkins.csv'] ?? '')[1]).toEqual([
      '1',
      '1970-01-01T00:00:01.000Z',
      '1',
      '',
      '1970-01-01T00:00:02.000Z',
      '1',
    ]);
    expect(parseCsv(written['rates.csv'] ?? '')[1]).toEqual([
      'EUR',
      'USD',
      '2026-10-09',
      '1.0876543210987654321',
      'ECB',
      '1970-01-01T00:00:00.099Z',
    ]);
  });

  it('writes names with commas, quotes, line breaks and Cyrillic back unchanged', async () => {
    const members = parseCsv((await files())['members.csv'] ?? '');
    expect(members.map((row) => row[1])).toEqual([
      'name',
      'Alex',
      'Blair, "B."\nSecond line',
      'Дарья',
    ]);
    expect(members[1]?.[2]).toBe('true');
  });

  it('lists the family settings without the password', async () => {
    const rows = parseCsv((await files())['settings.csv'] ?? '');
    expect(rows[0]).toEqual(['setting', 'value']);
    expect(rows.slice(1).map((row) => row[0])).toEqual([
      'common_currency',
      'time_zone',
      'cadence_kind',
      'cadence_day_of_month',
      'cadence_every_weeks',
      'cadence_weekday',
      'cadence_time',
      'cadence_anchor_date',
      'followup_days',
      'created_at',
    ]);
    expect(rows.find((row) => row[0] === 'time_zone')?.[1]).toBe(
      'Europe/Berlin',
    );
  });

  it('quotes only the cells that need it', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x', 'y,z'],
          [1, null],
        ],
      ),
    ).toBe('a,b\r\nx,"y,z"\r\n1,\r\n');
  });
});
