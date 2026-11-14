import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

/**
 * Linking an expense to a wish from the wish's page (spec 3a, TASK-44):
 * `GET /api/wishes/:id/candidates` (Design 4, O2) and
 * `POST /api/wishes/:id/links` (PLN-10).
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** A parsed JSON answer, read loosely by the tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('candidates and links of a wish', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let alex: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-wish-cands-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    const clock = { now: () => new Date('2026-10-15T10:00:00.000Z') };
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
  ) {
    return app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie: alex },
      ...(method === 'GET' ? {} : { payload: payload ?? {} }),
    });
  }

  async function account(name: string): Promise<number> {
    const response = await call('POST', '/api/accounts', {
      name,
      type: 'bank',
      currency: 'EUR',
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

  async function expense(
    accountId: number,
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId,
      amount: '2000',
      date: '2026-10-03',
      merchant: 'Tyre shop',
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().transaction.id;
  }

  async function candidates(wishId: number, q?: string): Promise<Json[]> {
    const query = q === undefined ? '' : `?q=${encodeURIComponent(q)}`;
    const response = await call(
      'GET',
      `/api/wishes/${wishId}/candidates${query}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json().candidates;
  }

  const ids = (list: Json[]) => list.map((item) => item.transactionId);

  function link(wishId: number, transactionId: number) {
    return call('POST', `/api/wishes/${wishId}/links`, { transactionId });
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

  // --- 1 -----------------------------------------------------------------

  it('lists only the month’s unplanned expenses', async () => {
    const joint = await account('Joint');
    const savings = await account('Savings');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const other = await wish({ name: 'Bike' });

    const free = await expense(joint, {
      merchant: 'Hardware store',
      note: 'Screws',
      amount: '1234',
      date: '2026-10-05',
    });
    const first = await expense(joint, { date: '2026-10-01' });
    const last = await expense(joint, { date: '2026-10-14' });
    // Left out: charged to an envelope.
    await expense(joint, { envelopeId: groceries });
    // Left out: linked to another wish, and to this one already.
    const elsewhere = await expense(joint, { merchant: 'Bike shop' });
    expect((await link(other, elsewhere)).statusCode).toBe(201);
    const here = await expense(joint, { merchant: 'Linked shop' });
    expect((await link(w, here)).statusCode).toBe(201);
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
    // The clock is in October, so a later date is moved in directly.
    const november = await expense(joint);
    database
      .prepare("UPDATE txn SET date = '2026-11-01' WHERE id = ?")
      .run(november);

    const answer = await call('GET', `/api/wishes/${w}/candidates`);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json().month).toBe('2026-10');
    // Newest first.
    expect(ids(answer.json().candidates)).toEqual([last, free, first]);
    expect(answer.json().candidates[1]).toEqual({
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
    // A link to any wish takes an expense off every list.
    expect(ids(await candidates(other))).toEqual([last, free, first]);
  });

  it('narrows the list by merchant, note or amount, and finds nothing for other words', async () => {
    const joint = await account('Joint');
    const w = await wish();
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

    expect(ids(await candidates(w, 'müller'))).toEqual([bread]);
    expect(ids(await candidates(w, 'winter'))).toEqual([tyres]);
    expect(ids(await candidates(w, '32.80'))).toEqual([bread]);
    expect(ids(await candidates(w, 'tyre shop'))).toEqual([tyres]);
    expect(await candidates(w, 'zeppelin')).toEqual([]);
    expect(ids(await candidates(w, ''))).toHaveLength(2);
  });

  it('answers 404 for a wish that is not there and 400 for a search that is too long', async () => {
    const w = await wish();
    expect((await call('GET', '/api/wishes/999/candidates')).statusCode).toBe(
      404,
    );
    const long = await call(
      'GET',
      `/api/wishes/${w}/candidates?q=${'a'.repeat(201)}`,
    );
    expect(long.statusCode).toBe(400);
  });

  // --- 2 and 6 -----------------------------------------------------------

  it('puts the expenses of the wish’s category in Fits, first', async () => {
    const joint = await account('Joint');
    const w = await wish({ categoryId: category('Transport') });
    const plain = await expense(joint, {
      merchant: 'Amazon',
      date: '2026-10-09',
    });
    const fitting = await expense(joint, {
      merchant: 'ÖBB',
      date: '2026-10-04',
      categoryId: category('Transport'),
    });
    const wrong = await expense(joint, {
      merchant: 'Rewe',
      date: '2026-10-08',
      categoryId: category('Groceries'),
    });

    const list = await candidates(w);
    expect(ids(list)).toEqual([fitting, plain, wrong]);
    expect(list.map((item) => item.fits)).toEqual([true, false, false]);
    expect(list[0]!.categoryName).toBe('Transport');
  });

  it('puts an expense of a merchant already linked to the wish in Fits', async () => {
    const joint = await account('Joint');
    const w = await wish();
    const linked = await expense(joint, {
      merchant: 'Tyre Shop',
      date: '2026-10-02',
    });
    expect((await link(w, linked)).statusCode).toBe(201);
    const same = await expense(joint, {
      merchant: 'TYRE SHOP',
      date: '2026-10-04',
    });
    const different = await expense(joint, {
      merchant: 'Amazon',
      date: '2026-10-06',
    });
    const noMerchant = await expense(joint, {
      merchant: undefined,
      note: 'Cash',
      date: '2026-10-07',
    });

    const list = await candidates(w);
    expect(ids(list)).toEqual([same, noMerchant, different]);
    expect(list.map((item) => item.fits)).toEqual([true, false, false]);
  });

  it('has no Fits for a wish without a category or links, and none for a merchant linked to another wish', async () => {
    const joint = await account('Joint');
    const w = await wish();
    const other = await wish({ name: 'Bike' });
    const bike = await expense(joint, { merchant: 'Bike shop' });
    expect((await link(other, bike)).statusCode).toBe(201);
    await expense(joint, {
      merchant: 'Bike shop',
      categoryId: category('Transport'),
    });
    await expense(joint, { merchant: 'Amazon' });

    const list = await candidates(w);
    expect(list).toHaveLength(2);
    expect(list.every((item) => item.fits === false)).toBe(true);
  });

  // --- 7 -----------------------------------------------------------------

  it('links an expense, logs it in its history and takes it off the list', async () => {
    const joint = await account('Joint');
    const w = await wish();
    const txn = await expense(joint, { amount: '12000' });

    const response = await link(w, txn);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().wish).toMatchObject({
      id: w,
      spent: '12000',
      left: '36000',
      expenseCount: 1,
    });
    expect(response.json().wish.expenses[0]).toMatchObject({
      transactionId: txn,
      madeHow: 'member',
    });
    expect(activeLinks(txn)).toBe(1);
    expect(await candidates(w)).toEqual([]);

    const read = await call('GET', `/api/transactions/${txn}`);
    expect(read.json().transaction.countsFor).toMatchObject({
      type: 'wish',
      id: w,
      madeHow: 'member',
      madeBy: 1,
    });
    const revisions = read.json().revisions as Json[];
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ action: 'update', changedBy: 1 });
    expect(revisions[0]!.changes.link).toEqual([
      null,
      { kind: 'wish', wishId: w, name: 'Winter tyres', madeHow: 'member' },
    ]);
  });

  it('answers 409 for an expense that is no longer unplanned or is of another month', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const other = await wish({ name: 'Bike' });

    const boxed = await expense(joint, { envelopeId: groceries });
    const taken = await expense(joint);
    expect((await link(other, taken)).statusCode).toBe(201);
    const again = await expense(joint);
    expect((await link(w, again)).statusCode).toBe(201);
    const september = await expense(joint, { date: '2026-09-30' });
    const income = await expense(joint, {
      kind: 'income',
      merchant: undefined,
    });

    for (const id of [boxed, taken, again, september, income, 9999]) {
      const response = await link(w, id);
      expect(response.statusCode, `${id} ${response.body}`).toBe(409);
      expect(response.json().error.code).toBe('changed');
    }
    expect(activeLinks(boxed)).toBe(0);
    expect(activeLinks(september)).toBe(0);
    expect(activeLinks(taken)).toBe(1);
    expect((await wishRead(w)).expenseCount).toBe(1);
    expect((await wishRead(other)).expenseCount).toBe(1);
  });

  it('answers 409 when an expense was planned after the list was read', async () => {
    const joint = await account('Joint');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const txn = await expense(joint);
    expect(ids(await candidates(w))).toEqual([txn]);

    const patched = await call('PATCH', `/api/transactions/${txn}`, {
      envelopeId: groceries,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const response = await link(w, txn);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('changed');
    expect(await candidates(w)).toEqual([]);
  });

  it('answers 409 for a dropped wish, 404 for a wish that is not there and 400 for a bad body', async () => {
    const joint = await account('Joint');
    const w = await wish();
    const txn = await expense(joint);

    expect((await link(999, txn)).statusCode).toBe(404);
    expect((await call('POST', `/api/wishes/${w}/links`, {})).statusCode).toBe(
      400,
    );
    expect(
      (await call('POST', `/api/wishes/${w}/links`, { transactionId: 'x' }))
        .statusCode,
    ).toBe(400);

    const dropped = await call('PATCH', `/api/wishes/${w}`, {
      state: 'dropped',
    });
    expect(dropped.statusCode, dropped.body).toBe(200);
    const response = await link(w, txn);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('wish_not_open');
    expect(activeLinks(txn)).toBe(0);
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
