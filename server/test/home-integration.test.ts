import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { turnOffReopenLock } from './reopenLock.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const day = 86_400_000;

describe('home and device routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let cookies: string;
  let now: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-home-api-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = Date.parse('2026-08-01T10:00:00Z');
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
      headers: { ...jsonHeaders, 'user-agent': 'HomeTest/1.0' },
      payload: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    turnOffReopenLock(database);
    const header = setup.headers['set-cookie'];
    cookies = (Array.isArray(header) ? header : [header])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.split(';', 1)[0])
      .join('; ');
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const get = (
    url: string,
    headers: Record<string, string> = { cookie: cookies },
  ) => app.inject({ method: 'GET', url, headers });
  const send = (
    method: 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie: cookies },
      payload: payload as object,
    });
  const home = async () => (await get('/api/home')).json();

  /** Alex owns a EUR and a USD account, Blair a EUR one; EUR->USD is 1.25. */
  function seedAccounts(): { eur: number; usd: number; blair: number } {
    const insert = database.prepare(
      `INSERT INTO account (name, owner_member_id, type, currency, created_by,
        created_at, updated_by, updated_at) VALUES (?, ?, 'bank', ?, 1, 1, 1, 1)`,
    );
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES ('EUR', 'USD', '2026-07-01', '1.25', 'test', 1),
                ('EUR', 'USD', '2026-08-01', '1.25', 'test', 1)`,
      )
      .run();
    return {
      eur: Number(insert.run('Main', 1, 'EUR').lastInsertRowid),
      usd: Number(insert.run('Wise', 1, 'USD').lastInsertRowid),
      blair: Number(insert.run('Cash', 2, 'EUR').lastInsertRowid),
    };
  }

  async function startCheckin(): Promise<number> {
    const started = await send('POST', '/api/checkins', {});
    expect(started.statusCode).toBe(201);
    return started.json().checkin.id as number;
  }

  async function saveValue(
    checkinId: number,
    accountId: number,
    amount: string,
  ) {
    const saved = await send(
      'PUT',
      `/api/checkins/${checkinId}/values/${accountId}`,
      { amount },
    );
    expect(saved.statusCode).toBe(200);
  }

  async function closeCheckin(checkinId: number): Promise<void> {
    const closed = await send('POST', `/api/checkins/${checkinId}/close`, {});
    expect(closed.statusCode).toBe(200);
  }

  function addBackup(
    kind: string,
    status: string,
    finishedAt: number | null,
  ): void {
    database
      .prepare(
        `INSERT INTO backup (kind, path, started_at, finished_at, status)
         VALUES (?, '/backups/x.sqlite', ?, ?, ?)`,
      )
      .run(kind, finishedAt ?? now, finishedAt, status);
  }

  it('requires a session', async () => {
    expect((await get('/api/home', {})).statusCode).toBe(401);
    expect((await get('/api/devices/current', {})).statusCode).toBe(401);
  });

  it('answers a fresh family with no banner, no wealth and no warning', async () => {
    expect(await home()).toEqual({
      today: '2026-08-01',
      commonCurrency: 'EUR',
      hideAmounts: true,
      checkin: null,
      wealth: null,
      spending: null,
      needsCategory: 0,
      backupWarning: null,
    });
  });

  it('describes a check-in a member started, counting only their accounts', async () => {
    const { eur, usd } = seedAccounts();
    const id = await startCheckin();
    expect((await home()).checkin).toEqual({
      id,
      scheduled: false,
      cadence: null,
      openedBy: 'Alex',
      openedByYou: true,
      openedDate: '2026-08-01',
      accountsLeft: 2,
    });
    await saveValue(id, eur, '100000');
    expect((await home()).checkin.accountsLeft).toBe(1);
    await saveValue(id, usd, '50000');
    expect((await home()).checkin.accountsLeft).toBe(0);
  });

  it('says whether the signed-in profile is the one who started it', async () => {
    seedAccounts();
    await startCheckin();
    database.prepare('UPDATE checkin SET opened_by = 2').run();
    expect((await home()).checkin).toMatchObject({
      openedBy: 'Blair',
      openedByYou: false,
    });
  });

  it('names a scheduled check-in by its cadence, with nobody as opener', async () => {
    seedAccounts();
    const id = await startCheckin();
    database
      .prepare('UPDATE checkin SET opened_by = NULL, schedule_slot = ?')
      .run('2026-08-01T09:00');
    database
      .prepare("UPDATE family SET cadence_kind = 'monthly' WHERE id = 1")
      .run();
    expect((await home()).checkin).toMatchObject({
      id,
      scheduled: true,
      cadence: 'monthly',
      openedBy: null,
      openedByYou: false,
    });
    database
      .prepare(
        "UPDATE family SET cadence_kind = 'weeks', cadence_every_weeks = 1",
      )
      .run();
    expect((await home()).checkin.cadence).toBe('weekly');
    database.prepare('UPDATE family SET cadence_every_weeks = 2').run();
    expect((await home()).checkin.cadence).toBeNull();
  });

  it('never puts an amount in the banner data', async () => {
    const { eur } = seedAccounts();
    const id = await startCheckin();
    await saveValue(id, eur, '123456');
    const banner = (await home()).checkin;
    expect(Object.keys(banner).sort()).toEqual([
      'accountsLeft',
      'cadence',
      'id',
      'openedBy',
      'openedByYou',
      'openedDate',
      'scheduled',
    ]);
    expect(JSON.stringify(banner)).not.toContain('123456');
  });

  it('values current wealth at the latest rates against the last check-in', async () => {
    const { eur, usd, blair } = seedAccounts();
    now = Date.parse('2026-07-01T10:00:00Z');
    const id = await startCheckin();
    await saveValue(id, eur, '100000');
    await saveValue(id, usd, '50000');
    await saveValue(id, blair, '0');
    await closeCheckin(id);
    // At the check-in: EUR 1,000.00 + USD 500.00 / 1.25 = EUR 1,400.00.
    expect((await home()).wealth).toEqual({
      checkinId: id,
      amount: '140000',
      lastCheckinDate: '2026-07-01',
      change: '0',
    });

    // Later the EUR account holds 1,200.00 and the dollar is dearer:
    // USD 500.00 / 1.60 = EUR 312.50, so wealth is 1,512.50 and the change
    // against the check-in's 1,400.00 is +112.50.
    now = Date.parse('2026-08-05T10:00:00Z');
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES ('EUR', 'USD', '2026-08-05', '1.60', 'test', 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO snapshot (account_id, taken_at, amount, source,
          created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, 120000, 'manual', 1, 1, 1, 1)`,
      )
      .run(eur, now - day);
    expect((await home()).wealth).toEqual({
      checkinId: id,
      amount: '151250',
      lastCheckinDate: '2026-07-01',
      change: '11250',
    });
  });

  it('reports a negative change and uses the latest closed check-in', async () => {
    const { eur, usd, blair } = seedAccounts();
    now = Date.parse('2026-07-01T10:00:00Z');
    for (const amount of ['100000', '90000']) {
      const id = await startCheckin();
      await saveValue(id, eur, amount);
      await saveValue(id, usd, '0');
      await saveValue(id, blair, '0');
      await closeCheckin(id);
      now += day;
    }
    const latest = (await get('/api/checkins'))
      .json()
      .checkins.find(
        (checkin: { closedAt: number }) =>
          checkin.closedAt === Date.parse('2026-07-02T10:00:00Z'),
      ).id as number;
    now = Date.parse('2026-07-03T10:00:00Z');
    database
      .prepare(
        `INSERT INTO snapshot (account_id, taken_at, amount, source,
          created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, 85000, 'manual', 1, 1, 1, 1)`,
      )
      .run(eur, now - 1000);
    expect((await home()).wealth).toEqual({
      checkinId: latest,
      amount: '85000',
      lastCheckinDate: '2026-07-02',
      change: '-5000',
    });
  });

  it('leaves the amount and change empty while a rate is missing', async () => {
    const { eur, usd, blair } = seedAccounts();
    now = Date.parse('2026-07-01T10:00:00Z');
    const id = await startCheckin();
    await saveValue(id, eur, '100000');
    await saveValue(id, usd, '50000');
    await saveValue(id, blair, '0');
    await closeCheckin(id);
    database
      .prepare(
        `INSERT INTO account (name, owner_member_id, type, currency,
          created_by, created_at, updated_by, updated_at)
         VALUES ('Rubles', 1, 'bank', 'RUB', 1, 1, 1, 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO snapshot (account_id, taken_at, amount, source,
          created_by, created_at, updated_by, updated_at)
         VALUES (4, ?, 700000, 'manual', 1, 1, 1, 1)`,
      )
      .run(now + 1000);
    now += day;
    expect((await home()).wealth).toEqual({
      checkinId: id,
      amount: null,
      lastCheckinDate: '2026-07-01',
      change: null,
    });
  });

  /** Creates an envelope and returns its id. */
  async function envelope(
    name: string,
    monthlyAmount: string,
    extra: object = {},
  ): Promise<number> {
    const response = await send('POST', '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount,
      mode: 'reset',
      startingBalance: monthlyAmount,
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

  async function spend(
    accountId: number,
    amount: string,
    extra: object = {},
  ): Promise<void> {
    const response = await send('POST', '/api/transactions', {
      kind: 'expense',
      date: '2026-08-01',
      accountId,
      amount,
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
  }

  it('shows no envelopes card without active envelopes', async () => {
    const id = await envelope('Old', '10000');
    await send('PATCH', `/api/envelopes/${id}`, { archived: true });
    expect((await home()).spending).toBeNull();
  });

  it('gives each active envelope its share used, rounded down', async () => {
    const { eur } = seedAccounts();
    const groceries = await envelope('Groceries', '50000');
    const fun = await envelope('Fun', '10000');
    const full = await envelope('Rent', '20000');
    const empty = await envelope('Spare', '5000');
    const archived = await envelope('Gone', '1000');
    await send('PATCH', `/api/envelopes/${archived}`, { archived: true });
    await spend(eur, '31299', { envelopeId: groceries });
    await spend(eur, '12000', { envelopeId: fun });
    await spend(eur, '20000', { envelopeId: full });
    await spend(eur, '999', { merchant: 'No envelope' });
    const { spending } = await home();
    expect(spending.spent).toBe('64298');
    expect(spending.envelopes).toEqual([
      expect.objectContaining({
        name: 'Groceries',
        available: '50000',
        spent: '31299',
        left: '18701',
        share: 62,
        over: false,
      }),
      expect.objectContaining({
        name: 'Fun',
        left: '-2000',
        share: 100,
        over: true,
      }),
      expect.objectContaining({ name: 'Rent', left: '0', share: 100 }),
      expect.objectContaining({ name: 'Spare', spent: '0', share: 0 }),
    ]);
    expect(spending.envelopes[2].over).toBe(false);
    expect(spending.envelopes.map(({ id }: { id: number }) => id)).toEqual([
      groceries,
      fun,
      full,
      empty,
    ]);
  });

  it('sums the month in the common currency and ignores other months', async () => {
    const { eur, usd } = seedAccounts();
    await envelope('Groceries', '50000');
    await spend(eur, '1000');
    await spend(usd, '1250');
    await spend(eur, '7777', { date: '2026-07-31' });
    expect((await home()).spending.spent).toBe('2000');
  });

  it('leaves the month’s spending empty while a rate is missing', async () => {
    seedAccounts();
    await envelope('Groceries', '50000');
    database
      .prepare(
        `INSERT INTO account (name, owner_member_id, type, currency,
          created_by, created_at, updated_by, updated_at)
         VALUES ('Rubles', 1, 'bank', 'RUB', 1, 1, 1, 1)`,
      )
      .run();
    await spend(4, '10000');
    const { spending } = await home();
    expect(spending.spent).toBeNull();
    expect(spending.envelopes).toHaveLength(1);
  });

  it('counts the transactions waiting for a category', async () => {
    const { eur } = seedAccounts();
    await spend(eur, '500');
    await spend(eur, '600', { merchant: 'Shop' });
    await spend(eur, '700', { categoryId: 1 });
    expect((await home()).needsCategory).toBe(2);
  });

  it('warns once the last successful nightly backup is over two days old', async () => {
    expect((await home()).backupWarning).toBeNull();
    addBackup('daily', 'done', now - 2 * day);
    expect((await home()).backupWarning).toBeNull();
    database.prepare('DELETE FROM backup').run();
    addBackup('daily', 'done', now - 2 * day - 1);
    expect((await home()).backupWarning).toEqual({ daysAgo: 2 });
    database.prepare('DELETE FROM backup').run();
    addBackup('daily', 'done', now - 3.5 * day);
    expect((await home()).backupWarning).toEqual({ daysAgo: 3 });
  });

  it('ignores failed, running and pre-migration backups', async () => {
    addBackup('daily', 'done', now - 5 * day);
    addBackup('daily', 'failed', now - day);
    addBackup('monthly', 'running', null);
    addBackup('pre_migration', 'done', now - day);
    expect((await home()).backupWarning).toEqual({ daysAgo: 5 });
  });

  it('reads and changes this device’s setting, and Home follows it', async () => {
    expect((await get('/api/devices/current')).json()).toEqual({
      hideHomeAmounts: true,
    });
    const changed = await send('PATCH', '/api/devices/current', {
      hideHomeAmounts: false,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ hideHomeAmounts: false });
    expect((await home()).hideAmounts).toBe(false);
    await send('PATCH', '/api/devices/current', { hideHomeAmounts: true });
    expect((await home()).hideAmounts).toBe(true);
  });

  it('rejects a device change that is not a boolean or has other fields', async () => {
    for (const payload of [
      {},
      { hideHomeAmounts: 'no' },
      { hideHomeAmounts: false, label: 'x' },
    ]) {
      const response = await send('PATCH', '/api/devices/current', payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation');
    }
  });
});
