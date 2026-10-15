import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { fillPendingEnvelopeAmounts } from '../src/domain/envelopes.js';
import type { FeedRate, FeedRequest, RateFeed } from '../src/rates/feed.js';
import { createRatesService, type RatesService } from '../src/rates/service.js';

/** The transaction routes of spec 2 task 8 (TXN-1 to TXN-8, CAT-5, MEM-5). */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

describe('transactions API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;
  let rates: RatesService;
  let fetch: ReturnType<typeof answerNothing>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-transactions-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    now = Date.parse('2026-10-15T10:00:00.000Z');
    const clock = { now: () => new Date(now) };
    // A feed that answers nothing, so the tests own every stored rate.
    fetch = answerNothing();
    const feed: RateFeed = {
      id: 'test',
      source: 'Test rates',
      covers: ({ code }) => code !== 'EUR',
      targetDate: (_now, today) => today,
      fetch,
    };
    rates = createRatesService({ database, clock, feeds: [feed] });
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
    cookie = alex,
  ) {
    return app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie },
      ...(method === 'GET' ? {} : { payload: payload ?? {} }),
    });
  }

  async function account(
    name: string,
    currency: string,
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/accounts', {
      name,
      type: 'bank',
      currency,
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().account.id;
  }

  function category(name: string): number {
    const row = database
      .prepare('SELECT id FROM category WHERE name = ?')
      .get(name) as { id: bigint };
    return Number(row.id);
  }

  async function envelope(
    name: string,
    currency = 'EUR',
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/envelopes', {
      name,
      currency,
      monthlyAmount: '40000',
      mode: 'carry_over',
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

  async function envelopeState(id: number) {
    const response = await call('GET', `/api/envelopes/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().envelope.current;
  }

  function rate(base: string, quote: string, date: string, value: string) {
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES (?, ?, ?, ?, 'Test rates', 0)`,
      )
      .run(base, quote, date, value);
  }

  async function create(payload: Record<string, unknown>, cookie = alex) {
    return call('POST', '/api/transactions', payload, cookie);
  }

  async function created(payload: Record<string, unknown>) {
    const response = await create(payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as {
      transaction: Record<string, unknown> & { id: number };
      filled: Record<string, string>;
    };
  }

  function count(table: string): number {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: bigint };
    return Number(row.count);
  }

  function revisions(txnId: number) {
    return (
      database
        .prepare(
          `SELECT action, changes, changed_by AS changedBy FROM txn_revision
           WHERE txn_id = ? ORDER BY id`,
        )
        .all(txnId) as Array<{
        action: string;
        changes: string;
        changedBy: bigint;
      }>
    ).map((row) => ({
      action: row.action,
      changes: JSON.parse(row.changes) as Record<string, unknown>,
      changedBy: Number(row.changedBy),
    }));
  }

  it('saves an expense with only an amount and an account', async () => {
    const joint = await account('Joint', 'EUR');
    const { transaction, filled } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '1250',
    });
    expect(transaction).toMatchObject({
      kind: 'expense',
      status: 'confirmed',
      date: '2026-10-15',
      accountId: joint,
      currency: 'EUR',
      amount: '1250',
      memberId: 1,
      createdBy: 1,
      merchant: null,
      categoryId: null,
      envelopeId: null,
      envelopeAmount: null,
      envelopeRate: null,
      source: 'typed',
    });
    expect(filled).toEqual({});
    const part = database
      .prepare('SELECT amount, category_id AS categoryId FROM txn_part')
      .get();
    expect(part).toEqual({ amount: 1250n, categoryId: null });
  });

  it('records the payer it is given and who typed it', async () => {
    const joint = await account('Joint', 'EUR');
    const { transaction } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '500',
      memberId: 2,
      merchant: '  REWE   City ',
      note: 'Milk',
      enteredAt: now - 60_000,
    });
    expect(transaction).toMatchObject({
      memberId: 2,
      createdBy: 1,
      merchant: 'REWE   City',
      note: 'Milk',
      enteredAt: now - 60_000,
    });
    const row = database
      .prepare('SELECT merchant_key AS key FROM txn')
      .get() as { key: string };
    expect(row.key).toBe('rewe city');
  });

  it('saves a retry with the same client id once', async () => {
    const joint = await account('Joint', 'EUR');
    const clientId = randomUUID();
    const body = {
      clientId,
      kind: 'expense',
      accountId: joint,
      amount: '1250',
      merchant: 'REWE',
    };
    const first = await create(body);
    expect(first.statusCode).toBe(201);
    // The same body with its keys in another order is the same request.
    const second = await create(
      Object.fromEntries(Object.entries(body).reverse()),
    );
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().transaction.id).toBe(first.json().transaction.id);
    expect(count('txn')).toBe(1);

    // An edit made since does not matter; another body is a conflict.
    const id = first.json().transaction.id;
    await call('PATCH', `/api/transactions/${id}`, { amount: '1300' });
    expect((await create(body)).statusCode).toBe(200);
    const other = await create({ ...body, amount: '1251' });
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe('conflict');
    expect(count('txn')).toBe(1);

    // A retry after the transaction was deleted does not bring it back.
    await call('DELETE', `/api/transactions/${id}`);
    const afterDelete = await create(body);
    expect(afterDelete.statusCode).toBe(409);
    expect(count('txn')).toBe(0);
  });

  it('restores the envelope with a refund', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    await created({
      kind: 'expense',
      accountId: joint,
      amount: '5000',
      envelopeId: groceries,
    });
    const before = await envelopeState(groceries);
    const { transaction } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '-1999',
      envelopeId: groceries,
    });
    expect(transaction).toMatchObject({
      amount: '-1999',
      envelopeAmount: '-1999',
    });
    const after = await envelopeState(groceries);
    expect(BigInt(after.closing) - BigInt(before.closing)).toBe(1999n);
    expect(after.spent).toBe('3001');
  });

  it('fills the envelope from the category on save', async () => {
    const joint = await account('Joint', 'EUR');
    const groceriesCategory = category('Groceries');
    const groceries = await envelope('Groceries');
    const unexpected = await envelope('Unexpected');
    const linked = await call('PATCH', `/api/categories/${groceriesCategory}`, {
      defaultEnvelopeId: groceries,
    });
    expect(linked.statusCode, linked.body).toBe(200);

    const filled = await created({
      kind: 'expense',
      accountId: joint,
      amount: '2380',
      categoryId: groceriesCategory,
    });
    expect(filled.transaction).toMatchObject({
      categoryId: groceriesCategory,
      envelopeId: groceries,
      envelopeAmount: '2380',
    });
    expect(filled.filled).toEqual({ envelope: 'category' });

    const kept = await created({
      kind: 'expense',
      accountId: joint,
      amount: '2380',
      categoryId: groceriesCategory,
      envelopeId: unexpected,
    });
    expect(kept.transaction.envelopeId).toBe(unexpected);
    expect(kept.filled).toEqual({});

    // A PATCH that clears the envelope does not refill it.
    const cleared = await call(
      'PATCH',
      `/api/transactions/${filled.transaction.id}`,
      { envelopeId: null },
    );
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().transaction).toMatchObject({
      categoryId: groceriesCategory,
      envelopeId: null,
      envelopeAmount: null,
    });
  });

  it('fills the category from the envelope on save', async () => {
    const joint = await account('Joint', 'EUR');
    const groceriesCategory = category('Groceries');
    const groceries = await envelope('Groceries', 'EUR', {
      defaultCategoryId: groceriesCategory,
    });
    const { transaction, filled } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '900',
      envelopeId: groceries,
    });
    expect(transaction.categoryId).toBe(groceriesCategory);
    expect(filled).toEqual({ category: 'envelope' });
  });

  it('does not apply an archived default', async () => {
    const joint = await account('Joint', 'EUR');
    const groceriesCategory = category('Groceries');
    const groceries = await envelope('Groceries');
    await call('PATCH', `/api/categories/${groceriesCategory}`, {
      defaultEnvelopeId: groceries,
    });
    const archived = await call('PATCH', `/api/envelopes/${groceries}`, {
      archived: true,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const { transaction, filled } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '2380',
      categoryId: groceriesCategory,
    });
    expect(transaction.envelopeId).toBeNull();
    expect(filled).toEqual({});

    // Nor is an archived envelope or category accepted when chosen.
    const chosen = await create({
      kind: 'expense',
      accountId: joint,
      amount: '100',
      envelopeId: groceries,
    });
    expect(chosen.statusCode).toBe(400);
    expect(chosen.json().error.fields.envelopeId).toBeDefined();
  });

  it('converts an expense into an envelope of another currency', async () => {
    const wise = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    rate('USD', 'EUR', '2026-10-02', '0.9149');
    const { transaction } = await created({
      kind: 'expense',
      accountId: wise,
      amount: '2339',
      date: '2026-10-03',
      envelopeId: groceries,
    });
    // $23.39 × 0.9149 = €21.399… → €21.40.
    expect(transaction).toMatchObject({
      envelopeCurrency: 'EUR',
      envelopeAmount: '2140',
      envelopeAmountManual: false,
      envelopeRate: {
        from: 'USD',
        to: 'EUR',
        rate: '0.9149',
        date: '2026-10-02',
      },
    });

    // A later rate does not change the stored amount.
    rate('USD', 'EUR', '2026-10-03', '0.5');
    fillPendingEnvelopeAmounts(database);
    const id = transaction.id;
    const read = await call('GET', `/api/transactions/${id}`);
    expect(read.json().transaction.envelopeAmount).toBe('2140');

    // A hand-typed one is kept, without a rate, until the amount changes.
    const typed = await call('PATCH', `/api/transactions/${id}`, {
      envelopeAmount: '2150',
    });
    expect(typed.json().transaction).toMatchObject({
      envelopeAmount: '2150',
      envelopeAmountManual: true,
      envelopeRate: null,
    });
    const note = await call('PATCH', `/api/transactions/${id}`, {
      note: 'Market',
    });
    expect(note.json().transaction.envelopeAmount).toBe('2150');
    const amount = await call('PATCH', `/api/transactions/${id}`, {
      amount: '1000',
    });
    // $10.00 × 0.5 (the rate of 3 October now) = €5.00.
    expect(amount.json().transaction).toMatchObject({
      envelopeAmount: '500',
      envelopeAmountManual: false,
      envelopeRate: { rate: '0.5', date: '2026-10-03' },
    });
  });

  it('leaves the envelope amount empty until a rate arrives', async () => {
    const wise = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    const { transaction } = await created({
      kind: 'expense',
      accountId: wise,
      amount: '2339',
      date: '2026-10-03',
      envelopeId: groceries,
    });
    expect(transaction).toMatchObject({
      envelopeAmount: null,
      envelopeRate: null,
    });
    expect((await envelopeState(groceries)).incomplete).toBe(true);
    rate('USD', 'EUR', '2026-10-01', '0.9');
    expect(fillPendingEnvelopeAmounts(database)).toBe(1);
    const read = await call('GET', `/api/transactions/${transaction.id}`);
    expect(read.json().transaction).toMatchObject({
      envelopeAmount: '2105',
      envelopeRate: { rate: '0.9', date: '2026-10-01' },
    });
  });

  it('gives the rate per whole unit for currencies of other decimals', async () => {
    const yen = await account('Yen', 'JPY');
    const groceries = await envelope('Groceries');
    // Only EUR→JPY is stored; JPY→EUR is its inverse.
    rate('EUR', 'JPY', '2026-10-01', '160');
    const { transaction } = await created({
      kind: 'expense',
      accountId: yen,
      amount: '3500',
      date: '2026-10-02',
      envelopeId: groceries,
    });
    expect(transaction).toMatchObject({
      currency: 'JPY',
      envelopeAmount: '2188',
      envelopeRate: {
        from: 'JPY',
        to: 'EUR',
        rate: '0.00625',
        date: '2026-10-01',
      },
    });
  });

  it('stores both amounts of a transfer between currencies', async () => {
    const joint = await account('Joint', 'EUR');
    const wise = await account('Wise $', 'USD');
    const savings = await account('Savings', 'EUR');
    const { transaction } = await created({
      kind: 'transfer',
      accountId: joint,
      toAccountId: wise,
      amount: '2000',
      toAmount: '2186',
    });
    expect(transaction).toMatchObject({
      kind: 'transfer',
      amount: '2000',
      currency: 'EUR',
      toAccountId: wise,
      toAmount: '2186',
      toCurrency: 'USD',
    });
    expect(count('txn_part')).toBe(0);

    // Between accounts of one currency the same amount arrives.
    const same = await created({
      kind: 'transfer',
      accountId: joint,
      toAccountId: savings,
      amount: '5000',
    });
    expect(same.transaction.toAmount).toBe('5000');
    const differs = await create({
      kind: 'transfer',
      accountId: joint,
      toAccountId: savings,
      amount: '5000',
      toAmount: '4000',
    });
    expect(differs.statusCode).toBe(400);
    const missing = await create({
      kind: 'transfer',
      accountId: joint,
      toAccountId: wise,
      amount: '5000',
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.fields.toAmount).toBeDefined();
  });

  it('refuses a transfer to the same account', async () => {
    const joint = await account('Joint', 'EUR');
    const response = await create({
      kind: 'transfer',
      accountId: joint,
      toAccountId: joint,
      amount: '2000',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.toAccountId).toBe(
      'Choose two different accounts.',
    );
  });

  it('refuses what does not fit the kind', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ kind: 'expense', amount: '0' }, 'amount'],
      [{ kind: 'income', amount: '-100' }, 'amount'],
      [{ kind: 'income', amount: '100', envelopeId: groceries }, 'envelopeId'],
      [{ kind: 'income', amount: '100', merchant: 'Boss' }, 'merchant'],
      [
        { kind: 'income', amount: '100', categoryId: category('Groceries') },
        'categoryId',
      ],
      [
        { kind: 'expense', amount: '100', categoryId: category('Salary') },
        'categoryId',
      ],
      [{ kind: 'expense', amount: '100', toAccountId: joint }, 'toAccountId'],
      [{ kind: 'expense', amount: '100', memberId: 99 }, 'memberId'],
      [{ kind: 'expense', amount: '100', date: '2026-02-30' }, 'date'],
      [{ kind: 'expense', amount: '100', date: '1999-12-31' }, 'date'],
      [{ kind: 'expense', amount: '1.5' }, 'amount'],
      [{ kind: 'expense', amount: '100', clientId: 'x' }, 'clientId'],
    ];
    for (const [payload, field] of cases) {
      const response = await create({ accountId: joint, ...payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.fields[field], field).toBeDefined();
    }
    const unknown = await create({
      kind: 'expense',
      accountId: 99,
      amount: '1',
    });
    expect(unknown.json().error.fields.accountId).toBeDefined();
    expect(count('txn')).toBe(0);
  });

  it('saves income with an income category', async () => {
    const joint = await account('Joint', 'EUR');
    const { transaction } = await created({
      kind: 'income',
      accountId: joint,
      amount: '350000',
      categoryId: category('Salary'),
    });
    expect(transaction).toMatchObject({
      kind: 'income',
      categoryId: category('Salary'),
    });
  });

  it('refuses a date after today in the family time zone', async () => {
    const joint = await account('Joint', 'EUR');
    const tomorrow = await create({
      kind: 'expense',
      accountId: joint,
      amount: '100',
      date: '2026-10-16',
    });
    expect(tomorrow.statusCode).toBe(400);
    expect(tomorrow.json().error.fields.date).toBe(
      'A date cannot be in the future.',
    );
    const { transaction } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '100',
    });
    const moved = await call('PATCH', `/api/transactions/${transaction.id}`, {
      date: '2026-10-16',
    });
    expect(moved.statusCode).toBe(400);
  });

  it('refuses a transaction on an account deactivated before its date', async () => {
    const joint = await account('Joint', 'EUR');
    const cash = await account('Cash', 'EUR');
    const { transaction } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '100',
      date: '2026-10-10',
    });
    now = Date.parse('2026-10-12T10:00:00.000Z');
    const closed = await call('POST', `/api/accounts/${joint}/deactivate`);
    expect(closed.statusCode, closed.body).toBe(200);
    now = Date.parse('2026-10-15T10:00:00.000Z');

    const after = await create({
      kind: 'expense',
      accountId: joint,
      amount: '100',
      date: '2026-10-13',
    });
    expect(after.statusCode).toBe(400);
    expect(after.json().error.fields.accountId).toBe(
      'This account was closed before that date.',
    );
    const transfer = await create({
      kind: 'transfer',
      accountId: cash,
      toAccountId: joint,
      amount: '100',
    });
    expect(transfer.json().error.fields.toAccountId).toBeDefined();
    // The day it closed and before still take transactions (history).
    for (const date of ['2026-10-12', '2026-10-01']) {
      const response = await create({
        kind: 'expense',
        accountId: joint,
        amount: '100',
        date,
      });
      expect(response.statusCode, date).toBe(201);
    }
    // A saved one stays editable, but cannot move past the closing.
    const note = await call('PATCH', `/api/transactions/${transaction.id}`, {
      note: 'Old',
    });
    expect(note.statusCode).toBe(200);
    const moved = await call('PATCH', `/api/transactions/${transaction.id}`, {
      date: '2026-10-14',
    });
    expect(moved.statusCode).toBe(400);
  });

  it('writes one revision per PATCH and one with every field on DELETE', async () => {
    const joint = await account('Joint', 'EUR');
    const cash = await account('Cash', 'EUR');
    const groceries = await envelope('Groceries');
    const { transaction } = await created({
      kind: 'expense',
      accountId: joint,
      amount: '2380',
      merchant: 'REWE',
      envelopeId: groceries,
    });
    const id = transaction.id;
    const blair = await signIn(2);

    const first = await call(
      'PATCH',
      `/api/transactions/${id}`,
      { categoryId: category('Groceries'), note: 'Weekly' },
      blair,
    );
    expect(first.statusCode, first.body).toBe(200);
    const second = await call('PATCH', `/api/transactions/${id}`, {
      amount: '2500',
      accountId: cash,
    });
    expect(second.statusCode, second.body).toBe(200);
    // Sending the stored values changes nothing and records nothing.
    const same = await call('PATCH', `/api/transactions/${id}`, {
      amount: '2500',
    });
    expect(same.statusCode).toBe(200);

    expect(revisions(id)).toEqual([
      {
        action: 'update',
        changedBy: 2,
        changes: {
          categoryId: [null, category('Groceries')],
          note: [null, 'Weekly'],
        },
      },
      {
        action: 'update',
        changedBy: 1,
        changes: {
          accountId: [joint, cash],
          amount: ['2380', '2500'],
          envelopeAmount: ['2380', '2500'],
        },
      },
    ]);
    const read = await call('GET', `/api/transactions/${id}`);
    expect(read.json().revisions).toHaveLength(2);
    expect(read.json().revisions[0]).toMatchObject({
      action: 'update',
      changedBy: 2,
      changedAt: now,
    });
    expect(read.json().transaction).toMatchObject({ updatedBy: 1 });

    const kind = await call('PATCH', `/api/transactions/${id}`, {
      kind: 'income',
    });
    expect(kind.statusCode).toBe(400);

    const deleted = await call('DELETE', `/api/transactions/${id}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(count('txn')).toBe(0);
    expect(count('txn_part')).toBe(0);
    const last = revisions(id)[2];
    expect(last).toMatchObject({ action: 'delete', changedBy: 1 });
    expect(last?.changes).toMatchObject({
      kind: ['expense', null],
      date: ['2026-10-15', null],
      accountId: [cash, null],
      amount: ['2500', null],
      memberId: [1, null],
      merchant: ['REWE', null],
      note: ['Weekly', null],
      categoryId: [category('Groceries'), null],
      envelopeId: [groceries, null],
      envelopeAmount: ['2500', null],
      createdBy: [1, null],
    });
    expect((await call('GET', `/api/transactions/${id}`)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/transactions/${id}`)).statusCode).toBe(
      404,
    );
  });

  it('keeps an account with a transaction from being deleted', async () => {
    const joint = await account('Joint', 'EUR');
    const wise = await account('Wise $', 'USD');
    await created({
      kind: 'transfer',
      accountId: joint,
      toAccountId: wise,
      amount: '2000',
      toAmount: '2186',
    });
    for (const id of [joint, wise]) {
      const response = await call('DELETE', `/api/accounts/${id}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('conflict');
    }
  });

  it('keeps an account a rule is limited to from being deleted', async () => {
    const joint = await account('Joint', 'EUR');
    const rule = await call('POST', '/api/rules', {
      pattern: 'REWE',
      categoryId: category('Groceries'),
      accountId: joint,
    });
    expect(rule.statusCode, rule.body).toBe(201);
    const response = await call('DELETE', `/api/accounts/${joint}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(
      'Rule 1 is limited to this account. Change or delete the rule first.',
    );
  });

  it('relabels transaction amounts with the account currency', async () => {
    const joint = await account('Joint', 'EUR');
    const wise = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    rate('EUR', 'JPY', '2026-10-01', '160');
    const expense = await created({
      kind: 'expense',
      accountId: joint,
      amount: '2350',
      envelopeId: groceries,
    });
    const manual = await created({
      kind: 'expense',
      accountId: joint,
      amount: '1000',
      envelopeId: groceries,
    });
    await call('PATCH', `/api/transactions/${manual.transaction.id}`, {
      envelopeAmount: '999',
    });
    const transfer = await created({
      kind: 'transfer',
      accountId: wise,
      toAccountId: joint,
      amount: '1000',
      toAmount: '915',
    });
    // A revision recorded on this account is relabelled with it.
    await call('PATCH', `/api/transactions/${expense.transaction.id}`, {
      amount: '2360',
    });

    const preview = await call('POST', `/api/accounts/${joint}/currency`, {
      currency: 'JPY',
    });
    expect(preview.json()).toMatchObject({
      requiresConfirmation: true,
      transactionCount: 3,
    });
    const relabelled = await call('POST', `/api/accounts/${joint}/currency`, {
      currency: 'JPY',
      confirm: true,
    });
    expect(relabelled.statusCode, relabelled.body).toBe(200);

    const read = async (id: number) =>
      (await call('GET', `/api/transactions/${id}`)).json();
    const relabelledExpense = await read(expense.transaction.id);
    // ¥24 at 160 ¥ per € is €0.15; the stored amount is recomputed.
    expect(relabelledExpense.transaction).toMatchObject({
      currency: 'JPY',
      amount: '24',
      envelopeAmount: '15',
    });
    expect(relabelledExpense.revisions[0].changes.amount).toEqual(['24', '24']);
    expect((await read(manual.transaction.id)).transaction).toMatchObject({
      amount: '10',
      envelopeAmount: '999',
      envelopeAmountManual: true,
    });
    // Each side of a transfer on its own account.
    expect((await read(transfer.transaction.id)).transaction).toMatchObject({
      amount: '1000',
      toAmount: '9',
      toCurrency: 'JPY',
    });
    const part = database
      .prepare('SELECT amount FROM txn_part WHERE txn_id = ?')
      .get(expense.transaction.id);
    expect(part).toEqual({ amount: 24n });
  });

  it('refuses a relabel that would round a transaction amount to zero', async () => {
    const joint = await account('Joint', 'EUR');
    await created({ kind: 'expense', accountId: joint, amount: '40' });
    const response = await call('POST', `/api/accounts/${joint}/currency`, {
      currency: 'JPY',
      confirm: true,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.currency).toBe(
      'An amount would round to zero in that currency.',
    );
    const row = database.prepare('SELECT currency FROM account').get();
    expect(row).toEqual({ currency: 'EUR' });
  });

  it('requests a backfill for a transaction before the earliest snapshot', async () => {
    const wise = await account('Wise $', 'USD', {
      openingBalance: '10000',
      openingDate: '2026-10-01',
    });
    await rates.idle();
    const asked = () =>
      fetch.mock.calls.flatMap(([request]) =>
        request.currencies.some((currency) => currency.code === 'USD')
          ? [request.from]
          : [],
      );
    expect(asked().every((from) => from > '2026-06-01')).toBe(true);
    await created({
      kind: 'expense',
      accountId: wise,
      amount: '500',
      date: '2026-06-01',
    });
    await rates.idle();
    // Two weeks of margin before the date, as for snapshots.
    expect(asked()).toContain('2026-05-18');
  });

  it('refuses a request without a session or a profile', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: jsonHeaders,
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
    for (const [method, url] of [
      ['GET', '/api/transactions/1'],
      ['PATCH', '/api/transactions/1'],
      ['DELETE', '/api/transactions/1'],
    ] as const) {
      const refused = await app.inject({
        method,
        url,
        headers: jsonHeaders,
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      expect(refused.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  /** A device signed in again as a member (1 Alex, 2 Blair). */
  async function signIn(memberId: number): Promise<string> {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, 'user-agent': `Device-${memberId}/1.0` },
      payload: { password },
    });
    expect(signedIn.statusCode).toBe(200);
    const cookie = cookieHeader(signedIn);
    const profile = await call(
      'POST',
      '/api/auth/profile',
      { memberId, remember: true },
      cookie,
    );
    expect(profile.statusCode).toBe(200);
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
    return cookie;
  }
});

/** A feed `fetch` that records each request and answers no rates. */
function answerNothing() {
  return vi.fn<(request: FeedRequest) => Promise<FeedRate[]>>(() =>
    Promise.resolve([]),
  );
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
