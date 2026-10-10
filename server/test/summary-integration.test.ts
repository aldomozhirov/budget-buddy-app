import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const day = 86_400_000;

describe('summary routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let cookies: string;
  let now: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-summary-api-'));
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
      headers: { ...jsonHeaders, 'user-agent': 'SummaryTest/1.0' },
      payload: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
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
  const send = (method: 'POST' | 'PUT', url: string, payload: unknown) =>
    app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie: cookies },
      payload: payload as object,
    });

  /** One EUR and one USD account, with EUR->USD 1.25 stored for the day. */
  function seedAccounts(): number[] {
    const insert = database.prepare(
      `INSERT INTO account (name, owner_member_id, type, currency, created_by,
        created_at, updated_by, updated_at) VALUES (?, 1, 'bank', ?, 1, 1, 1, 1)`,
    );
    const ids = [
      Number(insert.run('Main', 'EUR').lastInsertRowid),
      Number(insert.run('Wise', 'USD').lastInsertRowid),
    ];
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES ('EUR', 'USD', '2026-07-01', '1.25', 'test', 1),
                ('EUR', 'USD', '2026-08-01', '1.25', 'test', 1)`,
      )
      .run();
    return ids;
  }

  /** Runs one whole check-in through the API; the last value closes it. */
  async function runCheckin(values: Record<number, string>): Promise<number> {
    const started = await send('POST', '/api/checkins', {});
    const id = started.json().checkin.id as number;
    for (const [accountId, amount] of Object.entries(values)) {
      const saved = await send(
        'PUT',
        `/api/checkins/${id}/values/${accountId}`,
        { amount },
      );
      expect(saved.statusCode).toBe(200);
    }
    return id;
  }

  it('requires a session', async () => {
    const response = await get('/api/checkins/1/summary', {});
    expect(response.statusCode).toBe(401);
    expect((await get('/api/wealth/series', {})).statusCode).toBe(401);
  });

  it('returns the summary of a check-in closed through the API', async () => {
    const [eur, usd] = seedAccounts() as [number, number];
    now = Date.parse('2026-07-01T10:00:00Z');
    const first = await runCheckin({ [eur]: '100000', [usd]: '50000' });
    now += day * 31;
    const second = await runCheckin({ [eur]: '110000', [usd]: '60000' });
    // Saving the last value closed each check-in by itself.
    const open = await send('POST', '/api/checkins', {});
    const openId = open.json().checkin.id as number;
    const refused = await get(`/api/checkins/${openId}/summary`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('forbidden_state');

    // Check-in 1: EUR 1,000.00 + USD 500.00 / 1.25 (400.00) = 1,400.00.
    // Check-in 2: 1,100.00 + 600.00 / 1.25 (480.00) = 1,580.00; change 180.00.
    // Per account: EUR +100.00 and USD +100.00 / 1.25 = 80.00, so 180.00 from
    // balances and nothing from exchange rates (the rate did not move).
    const response = await get(`/api/checkins/${second}/summary`);
    expect(response.statusCode).toBe(200);
    const summary = response.json();
    expect(summary.checkin).toMatchObject({ id: second, date: '2026-08-01' });
    expect(summary.previous.id).toBe(first);
    expect(summary.total).toEqual({
      current: '158000',
      previous: '140000',
      change: '18000',
      direction: 'up',
      complete: true,
    });
    expect(summary.fromBalances).toBe('18000');
    expect(summary.fromExchangeRates).toBe('0');
    expect(summary.byMember).toEqual([
      { memberId: 1, name: 'Alex', change: '18000' },
    ]);

    const firstSummary = (await get(`/api/checkins/${first}/summary`)).json();
    expect(firstSummary.previous).toBeNull();
    expect(firstSummary.total.current).toBe('140000');
  });

  it('answers not found for an unknown check-in and rejects a bad id', async () => {
    expect((await get('/api/checkins/999/summary')).statusCode).toBe(404);
    expect((await get('/api/checkins/abc/summary')).statusCode).toBe(400);
  });

  it('returns the chart series and validates its query', async () => {
    const [eur, usd] = seedAccounts() as [number, number];
    now = Date.parse('2026-07-01T10:00:00Z');
    await runCheckin({ [eur]: '100000', [usd]: '50000' });

    const series = (await get('/api/wealth/series')).json();
    expect(series).toMatchObject({
      view: 'equivalent',
      currency: 'EUR',
      rates: 'dated',
      currencies: ['EUR', 'USD'],
      incomplete: false,
    });
    expect(
      series.points.map((point: { amount: string }) => point.amount),
    ).toEqual(['140000']);

    const usdSeries = (
      await get('/api/wealth/series?view=currency&currency=usd&rates=today')
    ).json();
    expect(usdSeries.currency).toBe('USD');
    expect(usdSeries.points[0].amount).toBe('50000');

    for (const query of [
      'view=currency',
      'view=currency&currency=JPY',
      'view=sideways',
      'rates=yesterday',
      'extra=1',
    ]) {
      const response = await get(`/api/wealth/series?${query}`);
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error.code).toBe('validation');
    }
  });
});
