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

describe('currency and money settings integration', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'budget-buddy-money-'));
    database = new Database(join(temporaryDirectory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, {
      backupDir: temporaryDirectory,
      migrationsFolder,
    });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('seeds BTC, ETH, and USDT with their first-start definitions', async () => {
    expect(database.prepare('SELECT code FROM coin').all()).toEqual([]);
    const cookies = await createFamily();

    const coins = database
      .prepare('SELECT code, name, decimals, feed_id FROM coin ORDER BY code')
      .all();
    expect(coins).toEqual([
      {
        code: 'BTC',
        name: 'Bitcoin',
        decimals: 8n,
        feed_id: 'BTC-EUR',
      },
      {
        code: 'ETH',
        name: 'Ethereum',
        decimals: 8n,
        feed_id: 'ETH-EUR',
      },
      {
        code: 'USDT',
        name: 'Tether',
        decimals: 6n,
        feed_id: 'USDT-EUR',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/currencies',
      headers: { cookie: cookies },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().coins).toEqual([
      { code: 'BTC', name: 'Bitcoin', decimals: 8, inUse: false },
      { code: 'ETH', name: 'Ethereum', decimals: 8, inUse: false },
      { code: 'USDT', name: 'Tether', decimals: 6, inUse: false },
    ]);
  });

  it('rejects ISO coin codes and 18 decimals while accepting the 8-decimal cap', async () => {
    const cookies = await createFamily();
    const headers = { ...jsonHeaders, cookie: cookies };

    const isoCode = await app.inject({
      method: 'POST',
      url: '/api/coins',
      headers,
      payload: { code: 'USD', name: 'Coin named dollar', decimals: 2 },
    });
    expect(isoCode.statusCode).toBe(400);
    expect(isoCode.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: { code: 'Use a code that is not an ISO currency.' },
      },
    });

    const tooManyDecimals = await app.inject({
      method: 'POST',
      url: '/api/coins',
      headers,
      payload: { code: 'DOGE', name: 'Dogecoin', decimals: 18 },
    });
    expect(tooManyDecimals.statusCode).toBe(400);
    expect(tooManyDecimals.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: { decimals: 'Stored with at most 8 decimals' },
      },
    });
    expect(
      database.prepare('SELECT code FROM coin WHERE code = ?').get('DOGE'),
    ).toBeUndefined();

    const atCap = await app.inject({
      method: 'POST',
      url: '/api/coins',
      headers,
      payload: { code: 'DOGE', name: 'Dogecoin', decimals: 8 },
    });
    expect(atCap.statusCode).toBe(201);
    expect(atCap.json().coin).toMatchObject({
      code: 'DOGE',
      name: 'Dogecoin',
      decimals: 8,
      inUse: false,
    });
  });

  it('blocks deletion of an in-use coin but permits an unused coin', async () => {
    const cookies = await createFamily();
    const headers = { ...jsonHeaders, cookie: cookies };
    const unusedCoin = await app.inject({
      method: 'POST',
      url: '/api/coins',
      headers,
      payload: { code: 'DOGE', name: 'Dogecoin', decimals: 8 },
    });
    expect(unusedCoin.statusCode).toBe(201);
    database
      .prepare(
        'INSERT INTO account (name, type, currency, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, 1, 1, 1)',
      )
      .run('Bitcoin wallet', 'crypto', 'BTC');

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/coins/BTC',
      headers,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'This coin is in use and cannot be deleted.',
      },
    });
    expect(
      database.prepare('SELECT code FROM coin WHERE code = ?').get('BTC'),
    ).toEqual({ code: 'BTC' });

    const deletedUnusedCoin = await app.inject({
      method: 'DELETE',
      url: '/api/coins/DOGE',
      headers,
      payload: {},
    });
    expect(deletedUnusedCoin.statusCode).toBe(200);
    expect(deletedUnusedCoin.json()).toEqual({ deleted: true });
  });

  it('changes the common currency without changing snapshot row count or sum', async () => {
    const cookies = await createFamily();
    insertAccountWithSnapshot('Everyday account', 'EUR', 12_345);
    insertAccountWithSnapshot('Wallet', 'BTC', -5_000);
    const before = snapshotRows();
    expect(before).toHaveLength(2);
    expect(before.map(({ amount }) => amount)).toEqual([12_345n, -5_000n]);

    const unavailableCurrency = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { commonCurrency: 'ZZZ' },
    });
    expect(unavailableCurrency.statusCode).toBe(400);
    expect(unavailableCurrency.json()).toMatchObject({
      error: {
        code: 'validation',
        fields: { commonCurrency: 'Choose an ISO currency or a coin in use.' },
      },
    });
    expect(snapshotRows()).toEqual(before);

    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...jsonHeaders, cookie: cookies },
      payload: { commonCurrency: 'USD' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({
      commonCurrency: 'USD',
      timeZone: 'Europe/Berlin',
    });
    expect(snapshotRows()).toEqual(before);
  });

  async function createFamily(): Promise<string> {
    const password = 'correct family password';
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'MoneyIntegrationTest/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex'],
      },
    });
    expect(response.statusCode).toBe(201);
    return sessionCookies(response);
  }

  function insertAccountWithSnapshot(
    name: string,
    currency: string,
    amount: number,
  ): void {
    const result = database
      .prepare(
        'INSERT INTO account (name, type, currency, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, 1, 1, 1)',
      )
      .run(name, currency === 'BTC' ? 'crypto' : 'bank', currency);
    database
      .prepare(
        'INSERT INTO snapshot (account_id, taken_at, amount, source, created_by, created_at, updated_by, updated_at) VALUES (?, 1, ?, ?, 1, 1, 1, 1)',
      )
      .run(result.lastInsertRowid, amount, 'manual');
  }

  function snapshotRows(): Array<{
    id: bigint;
    account_id: bigint;
    taken_at: bigint;
    amount: bigint;
    source: string;
  }> {
    return database
      .prepare(
        'SELECT id, account_id, taken_at, amount, source FROM snapshot ORDER BY id',
      )
      .all() as Array<{
      id: bigint;
      account_id: bigint;
      taken_at: bigint;
      amount: bigint;
      source: string;
    }>;
  }
});

function sessionCookies(response: {
  headers: Record<string, unknown>;
}): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
