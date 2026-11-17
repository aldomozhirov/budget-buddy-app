import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { fillPendingLinkAmounts } from '../src/domain/wishLinks.js';
import { createRatesService, type RatesService } from '../src/rates/service.js';

/**
 * Adding an expense that counts for a wish (spec 3a, TASK-50): PLN-18, O9,
 * O13 and Design 3 and 4, through `POST /api/transactions`.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** A parsed JSON answer, read loosely by the tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('adding an expense for a wish', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let alex: string;
  let rates: RatesService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-wish-add-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    const now = Date.parse('2026-10-15T10:00:00.000Z');
    const clock = { now: () => new Date(now) };
    rates = createRatesService({
      database,
      clock,
      feeds: [],
      onRatesStored: () => fillPendingLinkAmounts(database),
    });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock,
      rates,
    });
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'Alex-iPhone/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    alex = cookieHeader(setup);
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
  });

  afterEach(async () => {
    await rates.idle();
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie: alex },
      ...(method === 'GET' ? {} : { payload: payload ?? {} }),
    });
  }

  async function account(name: string, currency: string): Promise<number> {
    const response = await call('POST', '/api/accounts', {
      name,
      type: 'bank',
      currency,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().account.id;
  }

  async function envelope(name: string): Promise<number> {
    const response = await call('POST', '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount: '40000',
      mode: 'carry_over',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

  function category(name: string): number {
    const row = database
      .prepare('SELECT id FROM category WHERE name = ?')
      .get(name) as { id: bigint };
    return Number(row.id);
  }

  /** Adds a wish of October 2026 in euros unless the overrides say not. */
  async function wish(
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/wishes', {
      month: '2026-10',
      name: 'Winter tyres',
      amount: '48000',
      currency: 'EUR',
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().wish.id;
  }

  async function wishRead(id: number): Promise<Json> {
    const response = await call('GET', `/api/wishes/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().wish;
  }

  function add(accountId: number, wishId: number, extra: object = {}) {
    return call('POST', '/api/transactions', {
      kind: 'expense',
      accountId,
      amount: '48000',
      date: '2026-10-15',
      note: 'Winter tyres',
      wishId,
      wishFrom: 'wish',
      ...extra,
    });
  }

  function rate(base: string, quote: string, date: string, value: string) {
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES (?, ?, ?, ?, 'Test rates', 0)`,
      )
      .run(base, quote, date, value);
  }

  function link(txnId: number) {
    return database
      .prepare(
        `SELECT amount, amount_manual AS manual, made_how AS madeHow,
           month FROM plan_link WHERE txn_id = ? AND detached_at IS NULL`,
      )
      .get(txnId) as
      | { amount: bigint; manual: bigint; madeHow: string; month: string }
      | undefined;
  }

  function revisions(txnId: number) {
    return database
      .prepare('SELECT action, changes FROM txn_revision WHERE txn_id = ?')
      .all(txnId) as Array<{ action: string; changes: string }>;
  }

  it('saves the expense, a recorded link and its revision, and leaves the wish open', async () => {
    const bank = await account('Bank', 'EUR');
    const w = await wish({ categoryId: category('Transport') });
    const response = await add(bank, w, { categoryId: category('Transport') });
    expect(response.statusCode, response.body).toBe(201);
    const txn = response.json().transaction;
    expect(txn).toMatchObject({
      status: 'confirmed',
      envelopeId: null,
      countsFor: {
        type: 'wish',
        id: w,
        name: 'Winter tyres',
        madeHow: 'recorded',
        linkAmount: '48000',
      },
    });
    expect(link(txn.id)).toMatchObject({
      madeHow: 'recorded',
      month: '2026-10',
    });
    const entries = revisions(txn.id);
    expect(entries.map((entry) => entry.action)).toEqual(['update']);
    expect(JSON.parse(entries[0]!.changes)).toHaveProperty('link');
    expect(await wishRead(w)).toMatchObject({
      state: 'open',
      spent: '48000',
      expenseCount: 1,
    });
  });

  it('puts the expense in no envelope, despite a default and a rule', async () => {
    const bank = await account('Bank', 'EUR');
    const food = await envelope('Food');
    const groceries = category('Groceries');
    expect(
      (
        await call('PATCH', `/api/categories/${groceries}`, {
          defaultEnvelopeId: food,
        })
      ).statusCode,
    ).toBe(200);
    const w = await wish({ categoryId: groceries });
    const response = await add(bank, w, { categoryId: groceries });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().transaction.envelopeId).toBeNull();
    expect(response.json().transaction.countsFor.type).toBe('wish');
    expect(response.json().filled).toEqual({});
  });

  it('makes a member link for a wish picked on the form (UI-ADD-17)', async () => {
    const bank = await account('Bank', 'EUR');
    const food = await envelope('Food');
    const groceries = category('Groceries');
    await call('PATCH', `/api/categories/${groceries}`, {
      defaultEnvelopeId: food,
    });
    const w = await wish();
    const response = await add(bank, w, {
      wishFrom: 'form',
      categoryId: groceries,
    });
    expect(response.statusCode, response.body).toBe(201);
    const txn = response.json().transaction;
    expect(txn.envelopeId).toBeNull();
    expect(txn.countsFor).toMatchObject({ type: 'wish', madeHow: 'member' });
    expect(link(txn.id)).toMatchObject({ madeHow: 'member' });
    const bare = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId: bank,
      amount: '100',
      date: '2026-10-15',
      wishId: w,
    });
    expect(bare.json().transaction.countsFor.madeHow).toBe('member');
  });

  it('puts "neither" in no envelope and no link, despite a default', async () => {
    const bank = await account('Bank', 'EUR');
    const food = await envelope('Food');
    const groceries = category('Groceries');
    await call('PATCH', `/api/categories/${groceries}`, {
      defaultEnvelopeId: food,
    });
    const plain = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId: bank,
      amount: '100',
      date: '2026-10-15',
      categoryId: groceries,
    });
    expect(plain.json().transaction.envelopeId).toBe(food);
    const response = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId: bank,
      amount: '100',
      date: '2026-10-15',
      categoryId: groceries,
      envelopeId: null,
      unplanned: true,
    });
    expect(response.statusCode, response.body).toBe(201);
    const txn = response.json().transaction;
    expect(txn.envelopeId).toBeNull();
    expect(txn.countsFor).toEqual({ type: 'none' });
    expect(response.json().filled).toEqual({});
    expect(link(txn.id)).toBeUndefined();
  });

  it('refuses "neither" with an envelope or a wish, or on an income', async () => {
    const bank = await account('Bank', 'EUR');
    const food = await envelope('Food');
    const w = await wish();
    const base = {
      kind: 'expense',
      accountId: bank,
      amount: '100',
      date: '2026-10-15',
      unplanned: true,
    };
    const withEnvelope = await call('POST', '/api/transactions', {
      ...base,
      envelopeId: food,
    });
    expect(withEnvelope.statusCode).toBe(400);
    const withWish = await call('POST', '/api/transactions', {
      ...base,
      wishId: w,
    });
    expect(withWish.statusCode).toBe(400);
    const income = await call('POST', '/api/transactions', {
      ...base,
      kind: 'income',
    });
    expect(income.statusCode).toBe(400);
    const orphan = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId: bank,
      amount: '100',
      wishFrom: 'form',
    });
    expect(orphan.statusCode).toBe(400);
  });

  it('answers 409 for a dropped wish and a date outside its month', async () => {
    const bank = await account('Bank', 'EUR');
    const w = await wish();
    const other = await add(bank, w, { date: '2026-09-30', wishFrom: 'form' });
    expect(other.statusCode).toBe(409);
    database.prepare("UPDATE wish SET state = 'dropped' WHERE id = ?").run(w);
    const dropped = await add(bank, w, { wishFrom: 'form' });
    expect(dropped.statusCode).toBe(409);
    expect(dropped.json().error.code).toBe('wish_not_open');
  });

  it('counts the typed amount in the same currency, whatever linkAmount says', async () => {
    const bank = await account('Bank', 'EUR');
    const w = await wish();
    const response = await add(bank, w, { amount: '3000', linkAmount: '1' });
    expect(response.json().transaction.countsFor.linkAmount).toBe('3000');
  });

  it('converts at the day’s rate in another currency, rounded once', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const response = await add(wise, w, { amount: '2355' });
    expect(response.statusCode, response.body).toBe(201);
    const txn = response.json().transaction;
    expect(txn.countsFor.linkAmount).toBe('2120');
    expect(link(txn.id)).toMatchObject({ manual: 0n });
  });

  it('stores the linkAmount of an untouched prefill instead of converting back', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    // 480 euro is $533.33 at 0.9, which would convert back to 47999.7.
    const response = await add(wise, w, {
      amount: '53333',
      linkAmount: '48000',
    });
    expect(response.json().transaction.countsFor.linkAmount).toBe('48000');
  });

  it('leaves the link amount empty while no rate exists', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    const response = await add(wise, w, { amount: '2355' });
    expect(response.statusCode, response.body).toBe(201);
    expect(link(response.json().transaction.id)?.amount).toBeNull();
  });

  it('answers 409 for a dropped, a deleted or another month’s wish, and saves nothing', async () => {
    const bank = await account('Bank', 'EUR');
    const dropped = await wish();
    const deleted = await wish({ name: 'Old' });
    const other = await wish({ month: '2026-11', name: 'Later' });
    expect(
      (await call('PATCH', `/api/wishes/${dropped}`, { state: 'dropped' }))
        .statusCode,
    ).toBe(200);
    expect((await call('DELETE', `/api/wishes/${deleted}`)).statusCode).toBe(
      204,
    );
    for (const id of [dropped, deleted, other]) {
      const response = await add(bank, id);
      expect(response.statusCode, response.body).toBe(409);
    }
    const count = database.prepare('SELECT COUNT(*) AS n FROM txn').get() as {
      n: bigint;
    };
    expect(count.n).toBe(0n);
  });

  it('answers 400 for a wish with an envelope, another kind, or a linkAmount alone', async () => {
    const bank = await account('Bank', 'EUR');
    const food = await envelope('Food');
    const w = await wish();
    expect((await add(bank, w, { envelopeId: food })).statusCode).toBe(400);
    expect(
      (await add(bank, w, { kind: 'income', note: undefined })).statusCode,
    ).toBe(400);
    const alone = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId: bank,
      amount: '100',
      linkAmount: '100',
    });
    expect(alone.statusCode).toBe(400);
    expect((await add(bank, 9999)).statusCode).toBe(400);
  });

  it('saves once for a retry with the same client id', async () => {
    const bank = await account('Bank', 'EUR');
    const w = await wish();
    const clientId = randomUUID();
    const first = await add(bank, w, { clientId });
    const second = await add(bank, w, { clientId });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().transaction.id).toBe(first.json().transaction.id);
    expect((await wishRead(w)).expenseCount).toBe(1);
  });
});

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
