import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { apiRouteTable } from './routeTable.js';

/**
 * Linking an expense to an envelope from the envelope's page (spec 3a,
 * TASK-51): `GET /api/envelopes/:id/candidates` and
 * `POST /api/envelopes/:id/links`.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** A parsed JSON answer, read loosely by the tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('candidates and links of an envelope', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;
  let blair: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-env-links-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    now = Date.parse('2026-10-15T10:00:00.000Z');
    const clock = { now: () => new Date(now) };
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock,
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
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, 'user-agent': 'Blair-iPad/1.0' },
      payload: { password },
    });
    blair = cookieHeader(signedIn);
    await call(
      'POST',
      '/api/auth/profile',
      { memberId: 2, remember: true },
      blair,
    );
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
  });

  afterEach(async () => {
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

  async function account(name: string, currency = 'EUR'): Promise<number> {
    const response = await call('POST', '/api/accounts', {
      name,
      type: 'bank',
      currency,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().account.id;
  }

  async function envelope(
    name: string,
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount: '40000',
      mode: 'carry_over',
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

  async function detail(id: number): Promise<Json> {
    const response = await call('GET', `/api/envelopes/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  function category(name: string): number {
    const row = database
      .prepare('SELECT id FROM category WHERE name = ?')
      .get(name) as { id: bigint };
    return Number(row.id);
  }

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

  async function expense(
    accountId: number,
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId,
      amount: '2000',
      date: '2026-10-03',
      merchant: 'Corner shop',
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().transaction.id;
  }

  async function candidates(envelopeId: number, q?: string): Promise<Json[]> {
    const query = q === undefined ? '' : `?q=${encodeURIComponent(q)}`;
    const response = await call(
      'GET',
      `/api/envelopes/${envelopeId}/candidates${query}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json().candidates;
  }

  const ids = (list: Json[]) => list.map((item) => item.transactionId);

  function link(envelopeId: number, transactionId: number, cookie = alex) {
    return call(
      'POST',
      `/api/envelopes/${envelopeId}/links`,
      { transactionId },
      cookie,
    );
  }

  async function read(id: number): Promise<Json> {
    const response = await call('GET', `/api/transactions/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  function rate(base: string, quote: string, date: string, value: string) {
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES (?, ?, ?, ?, 'Test rates', 0)`,
      )
      .run(base, quote, date, value);
  }

  function activeLinks(txnId: number): number {
    return Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS n FROM plan_link
             WHERE txn_id = ? AND detached_at IS NULL`,
          )
          .get(txnId) as { n: bigint }
      ).n,
    );
  }

  function part(txnId: number) {
    const row = database
      .prepare(
        `SELECT envelope_id AS envelopeId, envelope_amount AS envelopeAmount
         FROM txn_part WHERE txn_id = ?`,
      )
      .get(txnId) as {
      envelopeId: bigint | null;
      envelopeAmount: bigint | null;
    };
    return {
      envelopeId: row.envelopeId === null ? null : Number(row.envelopeId),
      envelopeAmount: row.envelopeAmount,
    };
  }

  function revisionCount(txnId: number): number {
    return Number(
      (
        database
          .prepare('SELECT COUNT(*) AS n FROM txn_revision WHERE txn_id = ?')
          .get(txnId) as { n: bigint }
      ).n,
    );
  }

  // --- 1: the candidates -------------------------------------------------

  it('lists only the month’s expenses and refunds that are in no envelope and no wish', async () => {
    const joint = await account('Joint');
    const savings = await account('Savings');
    const dollars = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    const holiday = await envelope('Holiday');
    const w = await wish();

    const free = await expense(joint, {
      merchant: 'Hardware store',
      note: 'Screws',
      amount: '1234',
      date: '2026-10-05',
    });
    const first = await expense(joint, { date: '2026-10-01' });
    const last = await expense(joint, { date: '2026-10-14' });
    const refund = await expense(joint, {
      amount: '-500',
      date: '2026-10-10',
      merchant: 'Return desk',
    });
    // Another currency is still a candidate.
    const foreign = await expense(dollars, {
      amount: '999',
      date: '2026-10-12',
      merchant: 'Diner',
    });
    // Left out: charged to this or another envelope.
    await expense(joint, { envelopeId: groceries });
    await expense(joint, { envelopeId: holiday });
    // Left out: linked to a wish.
    const planned = await expense(joint, { merchant: 'Tyre shop' });
    expect(
      (await call('POST', `/api/wishes/${w}/links`, { transactionId: planned }))
        .statusCode,
    ).toBe(201);
    // Left out: a transfer, an income, a draft.
    await call('POST', '/api/transactions', {
      kind: 'transfer',
      accountId: joint,
      toAccountId: savings,
      amount: '2500',
      date: '2026-10-03',
    });
    await expense(joint, { kind: 'income', merchant: undefined });
    database
      .prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
           source, created_by, created_at, updated_by, updated_at)
         VALUES ('expense', 'draft', '2026-10-03', ?, 900, 1, 'typed', 1, 0,
           1, 0)`,
      )
      .run(joint);
    database
      .prepare(
        `INSERT INTO txn_part (txn_id, position, amount)
         VALUES ((SELECT MAX(id) FROM txn), 1, 900)`,
      )
      .run();
    // Left out: another month.
    await expense(joint, { date: '2026-09-30' });
    const november = await expense(joint);
    database
      .prepare("UPDATE txn SET date = '2026-11-01' WHERE id = ?")
      .run(november);

    const answer = await call('GET', `/api/envelopes/${groceries}/candidates`);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json().month).toBe('2026-10');
    // The shop of the expenses charged to the envelope fits, so it is first.
    expect(ids(answer.json().candidates)).toEqual([
      last,
      first,
      foreign,
      refund,
      free,
    ]);
    expect(answer.json().candidates.map((item: Json) => item.fits)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(answer.json().candidates[4]).toEqual({
      transactionId: free,
      merchant: 'Hardware store',
      note: 'Screws',
      date: '2026-10-05',
      accountId: joint,
      accountName: 'Joint',
      categoryName: null,
      amount: '1234',
      currency: 'EUR',
      fits: false,
    });
    expect(answer.json().candidates[2]).toMatchObject({
      currency: 'USD',
      amount: '999',
    });
    expect(answer.json().candidates[3]).toMatchObject({ amount: '-500' });
    // The list is the same for every envelope.
    expect(ids(await candidates(holiday))).toEqual(
      ids(answer.json().candidates),
    );
  });

  it('narrows the list by merchant, note or amount, and finds nothing for other words', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const tyres = await expense(joint, {
      merchant: 'Tyre shop',
      note: 'Four winter tyres',
      amount: '48000',
    });
    const bread = await expense(joint, {
      merchant: 'Bäckerei Müller',
      note: 'Cake',
      amount: '3280',
    });

    expect(ids(await candidates(groceries, 'müller'))).toEqual([bread]);
    expect(ids(await candidates(groceries, 'winter'))).toEqual([tyres]);
    expect(ids(await candidates(groceries, '32.80'))).toEqual([bread]);
    expect(await candidates(groceries, 'zeppelin')).toEqual([]);
    expect(ids(await candidates(groceries, ''))).toHaveLength(2);
  });

  it('answers 404 for an envelope that is not there and 400 for a search that is too long', async () => {
    const groceries = await envelope('Groceries');
    expect(
      (await call('GET', '/api/envelopes/999/candidates')).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/api/envelopes/abc/candidates')).statusCode,
    ).toBe(404);
    const long = await call(
      'GET',
      `/api/envelopes/${groceries}/candidates?q=${'a'.repeat(201)}`,
    );
    expect(long.statusCode).toBe(400);
  });

  it('takes the month from the family time zone, not from UTC', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    // 23:30 UTC on 31 October is already 1 November in Berlin.
    now = Date.parse('2026-10-31T23:30:00.000Z');
    const october = await expense(joint, { date: '2026-10-20' });
    const answer = await call('GET', `/api/envelopes/${groceries}/candidates`);
    expect(answer.json().month).toBe('2026-11');
    expect(ids(answer.json().candidates)).not.toContain(october);
    expect(answer.json().candidates).toEqual([]);
  });

  it('puts the expenses of the envelope’s default category in Fits, first', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries', {
      defaultCategoryId: category('Groceries'),
    });
    const plain = await expense(joint, {
      merchant: 'Amazon',
      date: '2026-10-09',
    });
    const fitting = await expense(joint, {
      merchant: 'Rewe',
      date: '2026-10-04',
      categoryId: category('Groceries'),
    });
    const wrong = await expense(joint, {
      merchant: 'ÖBB',
      date: '2026-10-08',
      categoryId: category('Transport'),
    });

    const list = await candidates(groceries);
    expect(ids(list)).toEqual([fitting, plain, wrong]);
    expect(list.map((item) => item.fits)).toEqual([true, false, false]);
    expect(list[0]!.categoryName).toBe('Groceries');
  });

  it('puts the expenses of a category that defaults to the envelope in Fits', async () => {
    const joint = await account('Joint');
    const pets = await envelope('Pets');
    const other = await envelope('Other');
    const plain = await expense(joint, {
      merchant: 'Amazon',
      date: '2026-10-09',
    });
    const fitting = await expense(joint, {
      merchant: 'Pet shop',
      date: '2026-10-04',
      categoryId: category('Shopping'),
    });
    // Set after adding: a default would charge the new expense to Pets.
    database
      .prepare('UPDATE category SET default_envelope_id = ? WHERE id = ?')
      .run(pets, category('Shopping'));
    const list = await candidates(pets);
    expect(ids(list)).toEqual([fitting, plain]);
    expect(list.map((item) => item.fits)).toEqual([true, false]);
    // The category defaults to another envelope, so nothing fits here.
    expect((await candidates(other)).every((item) => !item.fits)).toBe(true);
  });

  it('puts an expense of a merchant already charged to the envelope in Fits', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const holiday = await envelope('Holiday');
    await expense(joint, {
      merchant: 'Rewe Markt',
      date: '2026-09-02',
      envelopeId: groceries,
    });
    await expense(joint, {
      merchant: 'Hotel',
      date: '2026-09-03',
      envelopeId: holiday,
    });
    const same = await expense(joint, {
      merchant: 'REWE MARKT',
      date: '2026-10-04',
    });
    const different = await expense(joint, {
      merchant: 'Hotel',
      date: '2026-10-06',
    });
    const noMerchant = await expense(joint, {
      merchant: undefined,
      note: 'Cash',
      date: '2026-10-07',
    });

    const list = await candidates(groceries);
    expect(ids(list)).toEqual([same, noMerchant, different]);
    expect(list.map((item) => item.fits)).toEqual([true, false, false]);
    // The same merchant fits the other envelope by its own history only.
    const other = await candidates(holiday);
    expect(
      other.filter((item) => item.fits).map((item) => item.transactionId),
    ).toEqual([different]);
  });

  it('keeps each group newest first and has no Fits for an envelope without hints', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries', {
      defaultCategoryId: category('Groceries'),
    });
    const bare = await envelope('Bare');
    const old = await expense(joint, {
      date: '2026-10-01',
      categoryId: category('Groceries'),
    });
    const recent = await expense(joint, {
      date: '2026-10-13',
      categoryId: category('Groceries'),
    });
    const plainOld = await expense(joint, { date: '2026-10-02' });
    const plainNew = await expense(joint, { date: '2026-10-14' });
    expect(ids(await candidates(groceries))).toEqual([
      recent,
      old,
      plainNew,
      plainOld,
    ]);
    expect((await candidates(bare)).every((item) => !item.fits)).toBe(true);
  });

  // --- 2: linking --------------------------------------------------------

  it('links an expense, answers 201 with the envelope detail and writes one revision by the member', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const txn = await expense(joint, { amount: '12000' });

    const response = await link(groceries, txn, blair);
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.envelope).toMatchObject({ id: groceries, name: 'Groceries' });
    expect(body.expenses).toHaveLength(1);
    expect(body.expenses[0]).toMatchObject({ transactionId: txn });
    expect(body.month.month).toBe('2026-10');
    expect(body.month.spent).toBe('12000');
    // The same figures as a fresh read.
    expect((await detail(groceries)).month).toEqual(body.month);

    expect(part(txn)).toEqual({
      envelopeId: groceries,
      envelopeAmount: 12000n,
    });
    expect(activeLinks(txn)).toBe(0);
    const { transaction, revisions } = await read(txn);
    expect(transaction).toMatchObject({
      envelopeId: groceries,
      envelopeAmount: '12000',
      updatedBy: 2,
      updatedAt: now,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ action: 'update', changedBy: 2 });
    expect(revisions[0].changes).toMatchObject({
      envelopeId: [null, groceries],
    });

    // It is off the list, and linking it again is refused.
    expect(await candidates(groceries)).toEqual([]);
    expect((await link(groceries, txn)).statusCode).toBe(409);
    expect(revisionCount(txn)).toBe(1);
  });

  it('links a refund as a negative amount', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const bought = await expense(joint, { amount: '12000' });
    const refund = await expense(joint, {
      amount: '-2500',
      date: '2026-10-09',
    });
    expect((await link(groceries, bought)).statusCode).toBe(201);
    const response = await link(groceries, refund);
    expect(response.statusCode, response.body).toBe(201);
    expect(part(refund).envelopeAmount).toBe(-2500n);
    expect(response.json().month.spent).toBe('9500');
  });

  it('converts the amount of an expense in another currency, and leaves it empty until a rate exists', async () => {
    const wise = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    const withRate = await expense(wise, { amount: '2339' });
    rate('USD', 'EUR', '2026-10-02', '0.9149');
    const response = await link(groceries, withRate);
    expect(response.statusCode, response.body).toBe(201);
    // $23.39 × 0.9149 = €21.399… → €21.40.
    const { transaction } = await read(withRate);
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
    expect(response.json().month.spent).toBe('2140');

    database.prepare("DELETE FROM rate WHERE base = 'USD'").run();
    const pending = await expense(wise, { amount: '1000', date: '2026-10-04' });
    const second = await link(groceries, pending);
    expect(second.statusCode, second.body).toBe(201);
    expect(part(pending)).toEqual({
      envelopeId: groceries,
      envelopeAmount: null,
    });
    expect((await read(pending)).transaction.envelopeRate).toBeNull();
    expect(
      second.json().month.incomplete ?? second.json().envelope.incomplete,
    ).toBeTruthy();
  });

  it('keeps the other fields of the expense', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const txn = await expense(joint, {
      amount: '4210',
      merchant: 'Rewe',
      note: 'Weekly shop',
      categoryId: category('Groceries'),
    });
    expect((await link(groceries, txn)).statusCode).toBe(201);
    expect((await read(txn)).transaction).toMatchObject({
      amount: '4210',
      merchant: 'Rewe',
      note: 'Weekly shop',
      date: '2026-10-03',
      accountId: joint,
      envelopeId: groceries,
    });
  });

  // --- 3: refusals -------------------------------------------------------

  it('answers 409 changed for an expense that is gone, planned, linked or of another month', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const holiday = await envelope('Holiday');
    const w = await wish();

    const boxed = await expense(joint, { envelopeId: holiday });
    const wished = await expense(joint);
    expect(
      (await call('POST', `/api/wishes/${w}/links`, { transactionId: wished }))
        .statusCode,
    ).toBe(201);
    const september = await expense(joint, { date: '2026-09-30' });
    const income = await expense(joint, {
      kind: 'income',
      merchant: undefined,
    });
    const savings = await account('Savings');
    const transfer = (
      await call('POST', '/api/transactions', {
        kind: 'transfer',
        accountId: joint,
        toAccountId: savings,
        amount: '2500',
        date: '2026-10-03',
      })
    ).json().transaction.id;

    for (const id of [boxed, wished, september, income, transfer, 9999]) {
      const response = await link(groceries, id);
      expect(response.statusCode, `${id} ${response.body}`).toBe(409);
      expect(response.json().error.code).toBe('changed');
    }
    expect(part(boxed).envelopeId).toBe(Number(holiday));
    expect(part(september).envelopeId).toBeNull();
    expect(activeLinks(wished)).toBe(1);
    expect(part(wished).envelopeId).toBeNull();
    expect(revisionCount(september)).toBe(0);
    expect(revisionCount(boxed)).toBe(0);
    expect((await detail(groceries)).expenses).toEqual([]);
  });

  it('answers 409 when an expense was put in an envelope after the list was read', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const holiday = await envelope('Holiday');
    const txn = await expense(joint);
    expect(ids(await candidates(groceries))).toEqual([txn]);
    const patched = await call('PATCH', `/api/transactions/${txn}`, {
      envelopeId: holiday,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const response = await link(groceries, txn);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('changed');
    expect(part(txn).envelopeId).toBe(Number(holiday));
    expect(await candidates(groceries)).toEqual([]);
  });

  it('answers 409 changed for an archived envelope', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const txn = await expense(joint);
    const archived = await call('PATCH', `/api/envelopes/${groceries}`, {
      archived: true,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const response = await link(groceries, txn);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('changed');
    expect(part(txn).envelopeId).toBeNull();
    expect(revisionCount(txn)).toBe(0);
  });

  it('answers 404 for an envelope that is not there and 400 for a bad body', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const txn = await expense(joint);

    expect((await link(999, txn)).statusCode).toBe(404);
    expect(
      (await call('POST', '/api/envelopes/abc/links', { transactionId: txn }))
        .statusCode,
    ).toBe(404);
    for (const body of [
      {},
      { transactionId: 'x' },
      { transactionId: 0 },
      { transactionId: -3 },
      { transactionId: 1.5 },
      { transactionId: null },
    ]) {
      const response = await call(
        'POST',
        `/api/envelopes/${groceries}/links`,
        body,
      );
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('validation');
    }
    expect(part(txn).envelopeId).toBeNull();
    expect(revisionCount(txn)).toBe(0);
  });

  // --- 3: sessions and origin --------------------------------------------

  it('answers both routes with 401 without a session, session_locked when locked, and refuses a foreign origin', async () => {
    const listed = apiRouteTable(app).map(
      ({ method, url }) => `${method} ${url}`,
    );
    // The route table lists only the collection route; these are named.
    expect(listed).toContain('GET /api/envelopes');
    const routes = [
      { method: 'GET', url: '/api/envelopes/:id/candidates' },
      { method: 'POST', url: '/api/envelopes/:id/links' },
    ] as const;
    const id = await envelope('Groceries');
    database.prepare('UPDATE device SET lock_on_reopen = 1').run();
    for (const route of routes) {
      const url = route.url.replace(':id', String(id));
      const anonymous = await app.inject({
        method: route.method,
        url,
        headers: jsonHeaders,
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });
      expect(anonymous.statusCode, `${route.method} ${url}`).toBe(401);
      expect(anonymous.json().error.code).toBe('unauthenticated');
    }
    // Away for more than five minutes: both say session_locked.
    now += 6 * 60_000;
    for (const route of routes) {
      const url = route.url.replace(':id', String(id));
      const locked = await call(route.method, url, {});
      expect(locked.statusCode, `${route.method} ${url}`).toBe(401);
      expect(locked.json().error.code).toBe('session_locked');
    }
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
    const refused = await app.inject({
      method: 'POST',
      url: `/api/envelopes/${id}/links`,
      headers: { 'content-type': 'application/json', cookie: alex },
      payload: { transactionId: 1 },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('forbidden_state');
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/envelopes/${id}/links`,
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        cookie: alex,
      },
      payload: { transactionId: 1 },
    });
    expect(foreign.statusCode).toBe(403);
  });
});

/** The session cookies of a response, as a `Cookie` header. */
function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
