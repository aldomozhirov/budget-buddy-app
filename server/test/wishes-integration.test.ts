import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrateDatabase, migrationVersion } from '../src/db/migrate.js';
import { apiRouteTable } from './routeTable.js';

/** The wish routes of spec 3a (TASK-38): data model, rules, API, Undo. */
const drizzleFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

describe('wishes API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;
  let blair: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-wishes-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = Date.parse('2026-10-15T10:00:00.000Z');
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
    });
    await migrateDatabase(database, {
      backupDir: directory,
      migrationsFolder: drizzleFolder,
    });
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

  /** Adds a wish through the API and returns it. */
  async function add(overrides: Record<string, unknown> = {}, cookie = alex) {
    const response = await call(
      'POST',
      '/api/wishes',
      {
        month: '2026-10',
        name: 'Winter tyres',
        amount: '48000',
        currency: 'EUR',
        ...overrides,
      },
      cookie,
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json().wish;
  }

  /** A confirmed expense of 120.00 EUR linked to a wish, directly. */
  function linkExpense(wishId: number, linkAmount: bigint | null) {
    const account = database
      .prepare(
        `INSERT INTO account (name, type, currency, created_by, created_at,
           updated_by, updated_at) VALUES ('Joint', 'bank', 'EUR', 1, 1, 1, 1)`,
      )
      .run();
    const txn = database
      .prepare(
        `INSERT INTO txn (kind, date, account_id, amount, merchant, note,
           member_id, created_by, created_at, updated_by, updated_at)
         VALUES ('expense', '2026-10-10', ?, -12000, 'Tyre shop', 'Fitting',
           1, 1, 1, 1, 1)`,
      )
      .run(account.lastInsertRowid);
    database
      .prepare(
        `INSERT INTO plan_link (txn_id, kind, wish_id, month, amount,
           made_how, made_by, made_at)
         VALUES (?, 'wish', ?, '2026-10', ?, 'member', 2, 1)`,
      )
      .run(txn.lastInsertRowid, wishId, linkAmount);
    return Number(txn.lastInsertRowid);
  }

  it('adds a wish and keeps the typed expression and integer minor units', async () => {
    const wish = await add({
      amount: '35700',
      expression: '282 + 75',
      note: '  Set of four  ',
    });
    expect(wish).toMatchObject({
      month: '2026-10',
      name: 'Winter tyres',
      amount: '35700',
      expression: '282 + 75',
      currency: 'EUR',
      note: 'Set of four',
      state: 'open',
      spent: '0',
      left: '35700',
      over: '0',
      under: '0',
      incomplete: false,
      expenseCount: 0,
      expenses: [],
      createdBy: 1,
      createdByName: 'Alex',
      updatedBy: 1,
    });
    const row = database
      .prepare('SELECT typeof(amount) AS type, expression FROM wish')
      .get() as { type: string; expression: string };
    expect(row).toEqual({ type: 'integer', expression: '282 + 75' });
  });

  it('lets any member change, tick off, reopen, drop, bring back and delete, and stamps who and when', async () => {
    const { id } = await add();
    now += 60_000;
    const renamed = await call(
      'PATCH',
      `/api/wishes/${id}`,
      { name: 'Tyres', amount: '50000', note: null },
      blair,
    );
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().wish).toMatchObject({
      name: 'Tyres',
      amount: '50000',
      createdByName: 'Alex',
      updatedByName: 'Blair',
      updatedAt: now,
    });
    expect(renamed.json().wish.createdAt).toBeLessThan(now);

    for (const state of ['done', 'open', 'dropped', 'open']) {
      const response = await call(
        'PATCH',
        `/api/wishes/${id}`,
        { state },
        blair,
      );
      expect(response.json().wish.state).toBe(state);
    }
    const deleted = await call('DELETE', `/api/wishes/${id}`, {}, blair);
    expect(deleted.statusCode).toBe(204);
    const row = database
      .prepare('SELECT deleted_by, deleted_at, updated_by FROM wish')
      .get() as { deleted_by: bigint; deleted_at: bigint; updated_by: bigint };
    expect(row).toEqual({
      deleted_by: 2n,
      deleted_at: BigInt(now),
      updated_by: 2n,
    });
  });

  it('keeps a category that a wish uses from being deleted, even when the wish is deleted', async () => {
    const category = await call('POST', '/api/categories', {
      name: 'Tyres',
      kind: 'expense',
    });
    expect(category.statusCode, category.body).toBe(201);
    const categoryId = category.json().category.id;
    const { id } = await add({ categoryId });
    await call('DELETE', `/api/wishes/${id}`);
    const refused = await call('DELETE', `/api/categories/${categoryId}`);
    expect(refused.statusCode, refused.body).toBe(409);
  });

  it('answers 409 changed when the wish no longer has the expected state, and runs the Undo calls', async () => {
    const { id } = await add();
    const done = await call('PATCH', `/api/wishes/${id}`, {
      state: 'done',
      expect: { state: 'open' },
    });
    expect(done.statusCode).toBe(200);
    // Drop expects an open wish, which it no longer is.
    const stale = await call('PATCH', `/api/wishes/${id}`, {
      state: 'dropped',
      expect: { state: 'open' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('changed');
    // Undo of the tick off: back to the previous state, expecting done.
    const undone = await call('PATCH', `/api/wishes/${id}`, {
      state: 'open',
      expect: { state: 'done' },
    });
    expect(undone.json().wish.state).toBe('open');
    const again = await call('PATCH', `/api/wishes/${id}`, {
      state: 'open',
      expect: { state: 'done' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('hides a deleted wish everywhere and restores it unchanged', async () => {
    const { id } = await add({ expression: '480', note: 'Keep' });
    const before = (await call('GET', `/api/wishes/${id}`)).json().wish;
    expect((await call('DELETE', `/api/wishes/${id}`)).statusCode).toBe(204);
    expect((await call('GET', `/api/wishes/${id}`)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `/api/wishes/${id}`, { name: 'x' })).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/wishes/${id}`)).statusCode).toBe(404);
    const list = (await call('GET', '/api/wishes?month=2026-10')).json();
    expect(list.wishes).toEqual([]);
    expect(list.counts).toEqual({ total: 0, open: 0 });
    expect((await call('GET', '/api/home')).json().wishes).toEqual({ open: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM wish').get()).toEqual({
      n: 1n,
    });

    const restored = await call('POST', `/api/wishes/${id}/restore`, {}, blair);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().notRestored).toEqual([]);
    const after = restored.json().wish;
    expect({ ...after, updatedBy: 0, updatedByName: '' }).toEqual({
      ...before,
      updatedBy: 0,
      updatedByName: '',
      updatedAt: after.updatedAt,
    });
    expect((await call('POST', `/api/wishes/${id}/restore`)).statusCode).toBe(
      409,
    );
  });

  it('lists a month in the order of O12 with counts and the total of wishes not dropped', async () => {
    const first = await add({ name: 'First' });
    now += 1000;
    const second = await add({ name: 'Second', amount: '1000' });
    now += 1000;
    const third = await add({ name: 'Third', amount: '2000' });
    now += 1000;
    const fourth = await add({ name: 'Fourth', amount: '4000' });
    await call('PATCH', `/api/wishes/${first.id}`, { state: 'done' });
    await call('PATCH', `/api/wishes/${third.id}`, { state: 'dropped' });
    await add({ month: '2026-11', name: 'Next month' });

    const list = (await call('GET', '/api/wishes')).json();
    expect(list.month).toBe('2026-10');
    expect(list.wishes.map((wish: { name: string }) => wish.name)).toEqual([
      'Second',
      'Fourth',
      'First',
      'Third',
    ]);
    expect(list.counts).toEqual({ total: 4, open: 2 });
    // 48000 + 1000 + 4000, the dropped one left out.
    expect(list.total).toEqual({
      amount: '53000',
      currency: 'EUR',
      incomplete: false,
      estimated: false,
    });
    expect(second.id).not.toBe(fourth.id);
    const empty = (await call('GET', '/api/wishes?month=2026-09')).json();
    expect(empty.counts).toEqual({ total: 0, open: 0 });
    expect(empty.total.amount).toBeNull();
  });

  it('converts the total per currency at the rate of the first day, or the latest rate for a coming month', async () => {
    const insertRate = database.prepare(
      `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
       VALUES (?, ?, ?, ?, 'test', 0)`,
    );
    insertRate.run('EUR', 'USD', '2026-10-01', '1.25');
    insertRate.run('EUR', 'USD', '2026-10-12', '2');
    await add({ name: 'In euro', amount: '1000' });
    await add({ name: 'In dollars', amount: '1250', currency: 'USD' });
    await add({ name: 'In dollars too', amount: '1250', currency: 'USD' });
    const list = (await call('GET', '/api/wishes?month=2026-10')).json();
    // 2500 USD at 1.25 on the 1st is 2000 EUR; 1000 EUR; rounded once.
    expect(list.total).toMatchObject({ amount: '3000', incomplete: false });

    await add({
      month: '2026-12',
      name: 'Coming',
      amount: '1000',
      currency: 'USD',
    });
    const coming = (await call('GET', '/api/wishes?month=2026-12')).json();
    // The latest stored rate is 2, marked estimated.
    expect(coming.total).toMatchObject({
      amount: '500',
      estimated: true,
      incomplete: false,
    });

    await add({ name: 'In pounds', amount: '1000', currency: 'GBP' });
    const missing = (await call('GET', '/api/wishes?month=2026-10')).json();
    expect(missing.total).toMatchObject({ amount: '3000', incomplete: true });
  });

  it('reports what was spent from the linked expenses and leaves out a link with no amount', async () => {
    const { id } = await add({ amount: '48000' });
    linkExpense(id, 12000n);
    linkExpense(id, null);
    const wish = (await call('GET', `/api/wishes/${id}`)).json().wish;
    expect(wish).toMatchObject({
      spent: '12000',
      left: '36000',
      over: '0',
      incomplete: true,
      expenseCount: 2,
    });
    expect(wish.expenses[0]).toMatchObject({
      merchant: 'Tyre shop',
      note: 'Fitting',
      date: '2026-10-10',
      accountName: 'Joint',
      amount: '-12000',
      currency: 'EUR',
      madeHow: 'member',
      madeBy: 'Blair',
    });
    const list = (await call('GET', '/api/wishes')).json();
    expect(list.wishes[0].expenses).toHaveLength(2);

    const small = await add({ name: 'Small', amount: '5000' });
    linkExpense(small.id, 12000n);
    await call('PATCH', `/api/wishes/${small.id}`, { state: 'done' });
    expect(
      (await call('GET', `/api/wishes/${small.id}`)).json().wish,
    ).toMatchObject({
      spent: '12000',
      left: '-7000',
      over: '7000',
      under: '0',
    });
    const big = await add({ name: 'Big', amount: '20000' });
    linkExpense(big.id, 12000n);
    await call('PATCH', `/api/wishes/${big.id}`, { state: 'done' });
    expect(
      (await call('GET', `/api/wishes/${big.id}`)).json().wish,
    ).toMatchObject({ left: '8000', under: '8000', over: '0' });
  });

  it('allows one active link per transaction', () => {
    const { id } = {
      id: Number(
        database
          .prepare(
            `INSERT INTO wish (month, name, amount, currency, created_by, created_at,
         updated_by, updated_at) VALUES ('2026-10', 'A', 100, 'EUR', 1, 1, 1, 1)`,
          )
          .run().lastInsertRowid,
      ),
    };
    const txnId = linkExpense(id, 12000n);
    const insert = () =>
      database
        .prepare(
          `INSERT INTO plan_link (txn_id, kind, wish_id, month, amount,
             made_how, made_by, made_at) VALUES (?, 'wish', ?, '2026-10', 1,
             'member', 1, 1)`,
        )
        .run(txnId, id);
    expect(insert).toThrow(/UNIQUE/u);
    database
      .prepare(
        `UPDATE plan_link SET detached_at = 5, detached_reason = 'wish_deleted'`,
      )
      .run();
    expect(insert).not.toThrow();
    expect(insert).toThrow(/UNIQUE/u);
  });

  it('moves an open wish of this month forward, and back for Undo, and refuses any other move', async () => {
    const wish = await add({ name: 'Move me' });
    const forward = await call('POST', `/api/wishes/${wish.id}/move`, {
      month: '2026-11',
      expect: { month: '2026-10' },
    });
    expect(forward.statusCode, forward.body).toBe(200);
    expect(forward.json().wish.month).toBe('2026-11');
    expect(
      (await call('GET', '/api/wishes?month=2026-10')).json().wishes,
    ).toEqual([]);
    expect(
      (await call('GET', '/api/wishes?month=2026-11')).json().wishes,
    ).toHaveLength(1);
    expect((await call('GET', '/api/home')).json().wishes).toEqual({ open: 0 });

    // A wish already in the next month does not move on.
    const twice = await call('POST', `/api/wishes/${wish.id}/move`, {
      month: '2026-12',
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error.code).toBe('invalid');
    // Undo expects the month it moved to.
    const stale = await call('POST', `/api/wishes/${wish.id}/move`, {
      month: '2026-10',
      expect: { month: '2026-10' },
    });
    expect(stale.statusCode).toBe(409);
    const back = await call('POST', `/api/wishes/${wish.id}/move`, {
      month: '2026-10',
      expect: { month: '2026-11' },
    });
    expect(back.json().wish.month).toBe('2026-10');

    const done = await add({ name: 'Done' });
    await call('PATCH', `/api/wishes/${done.id}`, { state: 'done' });
    const dropped = await add({ name: 'Dropped' });
    await call('PATCH', `/api/wishes/${dropped.id}`, { state: 'dropped' });
    const past = await add({ month: '2026-09', name: 'Past' });
    const future = await add({ month: '2026-12', name: 'Future' });
    for (const [id, month] of [
      [done.id, '2026-11'],
      [dropped.id, '2026-11'],
      [past.id, '2026-10'],
      [past.id, '2026-11'],
      [future.id, '2026-11'],
      [wish.id, '2026-12'],
      [wish.id, '2026-10'],
    ] as const) {
      const response = await call('POST', `/api/wishes/${id}/move`, { month });
      expect(response.statusCode, `${id} to ${month}`).toBe(400);
      expect(response.json().error.code).toBe('invalid');
    }
    expect(
      (await call('POST', '/api/wishes/999/move', { month: '2026-11' }))
        .statusCode,
    ).toBe(404);
  });

  it('counts the open wishes of the current month on Home', async () => {
    await add({ name: 'One' });
    const two = await add({ name: 'Two' });
    const three = await add({ name: 'Three' });
    await add({ month: '2026-11', name: 'Next' });
    await call('PATCH', `/api/wishes/${two.id}`, { state: 'done' });
    await call('PATCH', `/api/wishes/${three.id}`, { state: 'dropped' });
    expect((await call('GET', '/api/home')).json().wishes).toEqual({ open: 1 });
  });

  it('refuses what O7, O8, O11 and PLN-9 do not allow with 400 invalid', async () => {
    const category = database
      .prepare("SELECT id FROM category WHERE kind = 'expense' LIMIT 1")
      .get() as { id: bigint };
    const income = database
      .prepare("SELECT id FROM category WHERE kind = 'income' LIMIT 1")
      .get() as { id: bigint };
    const archived = database
      .prepare(
        `INSERT INTO category (name, kind, position, archived_at, created_at,
           updated_at) VALUES ('Old', 'expense', 99, 1, 1, 1)`,
      )
      .run();
    const bad: Array<[string, Record<string, unknown>]> = [
      ['name', { name: '   ' }],
      ['name', { name: 'x'.repeat(81) }],
      ['note', { note: 'x'.repeat(501) }],
      ['month', { month: '1999-12' }],
      ['month', { month: '2027-11' }],
      ['month', { month: '2026-13' }],
      ['categoryId', { categoryId: Number(income.id) }],
      ['categoryId', { categoryId: Number(archived.lastInsertRowid) }],
      ['categoryId', { categoryId: 9999 }],
      ['expression', { expression: 'x'.repeat(121) }],
      ['expression', { expression: '1; DROP TABLE wish' }],
      ['expression', { expression: 'abs(3)' }],
      ['amount', { amount: '0' }],
      ['amount', { amount: '-5' }],
      ['amount', { amount: '12.5' }],
      ['amount', { amount: '9223372036854775808' }],
      ['currency', { currency: 'ZZZ1' }],
      ['currency', { currency: 'XYZ' }],
    ];
    for (const [field, override] of bad) {
      const response = await call('POST', '/api/wishes', {
        month: '2026-10',
        name: 'Tyres',
        amount: '100',
        currency: 'EUR',
        ...override,
      });
      expect(response.statusCode, JSON.stringify(override)).toBe(400);
      expect(response.json().error.code).toBe('invalid');
      expect(response.json().error.fields).toHaveProperty(field);
    }
    expect(database.prepare('SELECT COUNT(*) AS n FROM wish').get()).toEqual({
      n: 0n,
    });

    // The edge values are fine.
    await add({
      month: '2000-01',
      name: 'x'.repeat(80),
      note: 'n'.repeat(500),
    });
    await add({
      month: '2027-10',
      expression: '(1 + 2) × 3 ÷ 4 − 5 * 6 / 7 . ,',
      categoryId: Number(category.id),
    });

    // An archived category stays on a wish that has it.
    const keeps = await add({ name: 'Keeps' });
    database
      .prepare('UPDATE wish SET category_id = ? WHERE id = ?')
      .run(archived.lastInsertRowid, keeps.id);
    const patch = await call('PATCH', `/api/wishes/${keeps.id}`, {
      categoryId: Number(archived.lastInsertRowid),
      note: 'ok',
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(
      (await call('PATCH', `/api/wishes/${keeps.id}`, { amount: '0' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', `/api/wishes/${keeps.id}`, {})).statusCode,
    ).toBe(400);
    expect((await call('GET', '/api/wishes?month=1999-01')).statusCode).toBe(
      400,
    );
  });

  it('stamps the member and time on a move, and 409s on a stale month or state', async () => {
    const wish = await add();
    now += 5000;
    const moved = await call(
      'POST',
      `/api/wishes/${wish.id}/move`,
      { month: '2026-11', expect: { state: 'open', month: '2026-10' } },
      blair,
    );
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().wish).toMatchObject({
      month: '2026-11',
      createdByName: 'Alex',
      updatedByName: 'Blair',
      updatedAt: now,
    });
    const staleState = await call('POST', `/api/wishes/${wish.id}/move`, {
      month: '2026-10',
      expect: { state: 'done' },
    });
    expect(staleState.statusCode).toBe(409);
    expect(staleState.json().error.code).toBe('changed');

    const staleMonth = await call('PATCH', `/api/wishes/${wish.id}`, {
      name: 'Renamed',
      expect: { month: '2026-10' },
    });
    expect(staleMonth.statusCode).toBe(409);
    expect(staleMonth.json().error.code).toBe('changed');
    expect((await call('GET', `/api/wishes/${wish.id}`)).json().wish.name).toBe(
      'Winter tyres',
    );
    const fresh = await call('PATCH', `/api/wishes/${wish.id}`, {
      name: 'Renamed',
      expect: { month: '2026-11' },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('answers 404 for an unknown, malformed or deleted wish on every route', async () => {
    const { id } = await add();
    await call('DELETE', `/api/wishes/${id}`);
    const calls: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, object]> =
      [
        ['GET', '/api/wishes/999', {}],
        ['GET', '/api/wishes/abc', {}],
        ['GET', '/api/wishes/0', {}],
        ['PATCH', '/api/wishes/999', { name: 'x' }],
        ['PATCH', '/api/wishes/abc', { name: 'x' }],
        ['DELETE', '/api/wishes/999', {}],
        ['DELETE', '/api/wishes/abc', {}],
        ['POST', '/api/wishes/999/restore', {}],
        ['POST', '/api/wishes/abc/restore', {}],
        ['POST', '/api/wishes/abc/move', { month: '2026-11' }],
        ['POST', `/api/wishes/${id}/move`, { month: '2026-11' }],
      ];
    for (const [method, url, payload] of calls) {
      const response = await call(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json().error.code).toBe('not_found');
    }
  });

  it('rejects a malformed body on move and a malformed month on the list', async () => {
    const { id } = await add();
    for (const body of [{}, { month: '2026-1' }, { month: '2026-13' }]) {
      const response = await call('POST', `/api/wishes/${id}/move`, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('invalid');
    }
    for (const month of ['2026-1', '2026-13', 'abc', '2027-11']) {
      const response = await call('GET', `/api/wishes?month=${month}`);
      expect(response.statusCode, month).toBe(400);
      expect(response.json().error.code).toBe('invalid');
    }
    expect((await call('GET', '/api/wishes?month=2027-10')).statusCode).toBe(
      200,
    );
  });

  it('clears the expression, category and note with null, and changes the currency', async () => {
    const category = database
      .prepare("SELECT id FROM category WHERE kind = 'expense' LIMIT 1")
      .get() as { id: bigint };
    const { id } = await add({
      expression: '282 + 75',
      categoryId: Number(category.id),
      note: 'Set',
    });
    expect(
      (await call('GET', `/api/wishes/${id}`)).json().wish.categoryName,
    ).toEqual(expect.any(String));
    const cleared = await call('PATCH', `/api/wishes/${id}`, {
      expression: null,
      categoryId: null,
      note: '   ',
      currency: 'usd',
      amount: '700',
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().wish).toMatchObject({
      expression: null,
      categoryId: null,
      categoryName: null,
      note: null,
      currency: 'USD',
      amount: '700',
    });
    for (const patch of [{ currency: 'XYZ' }, { categoryId: 9999 }]) {
      const refused = await call('PATCH', `/api/wishes/${id}`, patch);
      expect(refused.statusCode, JSON.stringify(patch)).toBe(400);
      expect(refused.json().error.code).toBe('invalid');
    }
    expect((await call('GET', `/api/wishes/${id}`)).json().wish.currency).toBe(
      'USD',
    );
  });

  it('subtracts a refund, leaves out a detached link, and shows the link amount in the wish currency', async () => {
    const { id } = await add({ amount: '48000' });
    linkExpense(id, 12000n);
    const refund = linkExpense(id, -2000n);
    const detached = linkExpense(id, 5000n);
    database
      .prepare(
        `UPDATE plan_link SET detached_at = 9, detached_reason = 'wish_deleted'
         WHERE txn_id = ?`,
      )
      .run(detached);
    const wish = (await call('GET', `/api/wishes/${id}`)).json().wish;
    expect(wish).toMatchObject({
      spent: '10000',
      left: '38000',
      incomplete: false,
      expenseCount: 2,
    });
    expect(
      wish.expenses.map((e: { transactionId: number }) => e.transactionId),
    ).not.toContain(detached);
    expect(wish.expenses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transactionId: refund, linkAmount: '-2000' }),
      ]),
    );
    // A deleted expense takes its link with it.
    database.prepare('DELETE FROM txn WHERE id = ?').run(refund);
    expect((await call('GET', `/api/wishes/${id}`)).json().wish).toMatchObject({
      spent: '12000',
      expenseCount: 1,
    });
  });

  it('uses the nearest earlier rate for the first day, and marks a coming month with no rate incomplete', async () => {
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES ('EUR', 'USD', '2026-09-28', '2', 'test', 0)`,
      )
      .run();
    await add({ name: 'Dollars', amount: '1000', currency: 'USD' });
    const october = (await call('GET', '/api/wishes?month=2026-10')).json();
    expect(october.total).toMatchObject({
      amount: '500',
      estimated: false,
      incomplete: false,
    });
    // Only dropped wishes: nothing to add, and no estimate to flag.
    const only = await add({ month: '2026-11', name: 'Dropped' });
    await call('PATCH', `/api/wishes/${only.id}`, { state: 'dropped' });
    const november = (await call('GET', '/api/wishes?month=2026-11')).json();
    expect(november.counts).toEqual({ total: 1, open: 0 });
    expect(november.total).toMatchObject({
      amount: null,
      estimated: false,
    });
    await add({ month: '2026-11', name: 'Pounds', currency: 'GBP' });
    const gbp = (await call('GET', '/api/wishes?month=2026-11')).json();
    expect(gbp.total).toMatchObject({ estimated: true, incomplete: true });
  });

  it('takes the current month in the family time zone', async () => {
    database.prepare("UPDATE family SET time_zone = 'Pacific/Auckland'").run();
    // 12:00 UTC on 31 October is 01:00 on 1 November in Auckland.
    now = Date.parse('2026-10-31T12:00:00.000Z');
    await add({ month: '2026-10', name: 'Old' });
    await add({ month: '2026-11', name: 'New' });
    expect((await call('GET', '/api/wishes')).json().month).toBe('2026-11');
    expect((await call('GET', '/api/home')).json().wishes).toEqual({ open: 1 });
    const forward = await call('POST', '/api/wishes/2/move', {
      month: '2026-12',
    });
    expect(forward.statusCode).toBe(200);
    const stale = await call('POST', '/api/wishes/1/move', {
      month: '2026-11',
    });
    expect(stale.statusCode).toBe(400);
  });

  it('answers every wish route with 401 without a session, session_locked when locked, and refuses a foreign origin', async () => {
    // The route table lists the collection route; the others are named.
    const listed = apiRouteTable(app).map(
      ({ method, url }) => `${method} ${url}`,
    );
    expect(listed).toContain('GET /api/wishes');
    expect(listed).toContain('POST /api/wishes');
    const routes = [
      { method: 'GET', url: '/api/wishes' },
      { method: 'POST', url: '/api/wishes' },
      { method: 'GET', url: '/api/wishes/:id' },
      { method: 'PATCH', url: '/api/wishes/:id' },
      { method: 'DELETE', url: '/api/wishes/:id' },
      { method: 'POST', url: '/api/wishes/:id/move' },
      { method: 'POST', url: '/api/wishes/:id/restore' },
    ];
    const { id } = await add();
    database.prepare('UPDATE device SET lock_on_reopen = 1').run();
    for (const route of routes) {
      const url = route.url.replace(':id', String(id));
      const method = route.method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      const anonymous = await app.inject({
        method,
        url,
        headers: jsonHeaders,
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      expect(anonymous.statusCode, `${method} ${url}`).toBe(401);
      expect(anonymous.json().error.code).toBe('unauthenticated');
    }
    // Away for more than five minutes: every route says session_locked.
    now += 6 * 60_000;
    for (const route of routes) {
      const url = route.url.replace(':id', String(id));
      const method = route.method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      const locked = await call(method, url, {});
      expect(locked.statusCode, `${method} ${url}`).toBe(401);
      expect(locked.json().error.code).toBe('session_locked');
    }
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
    for (const route of routes.filter(({ method }) => method !== 'GET')) {
      const url = route.url.replace(':id', String(id));
      const refused = await app.inject({
        method: route.method as 'POST' | 'PATCH' | 'DELETE',
        url,
        headers: { 'content-type': 'application/json', cookie: alex },
        payload: {},
      });
      expect(refused.statusCode, `${route.method} ${url}`).toBe(403);
      expect(refused.json().error.code).toBe('forbidden_state');
    }
  });
});

describe('wish and plan_link constraints', () => {
  let directory: string;
  let database: Database.Database;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-wish-schema-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, {
      backupDir: directory,
      migrationsFolder: drizzleFolder,
    });
    database.exec(`
      INSERT INTO family (id, password_hash, created_at) VALUES (1, 'x', 1);
      INSERT INTO member (id, name, created_at) VALUES (1, 'Alex', 1);
      INSERT INTO account (id, name, type, currency, created_by, created_at,
        updated_by, updated_at) VALUES (1, 'Joint', 'bank', 'EUR', 1, 1, 1, 1);
      INSERT INTO txn (id, kind, date, account_id, amount, member_id,
        created_by, created_at, updated_by, updated_at)
        VALUES (1, 'expense', '2026-10-10', 1, -500, 1, 1, 1, 1, 1);
    `);
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const insertWish = (extra: Record<string, unknown> = {}) => {
    const row = {
      month: '2026-10',
      name: 'A',
      amount: 100,
      currency: 'EUR',
      state: 'open',
      created_by: 1,
      created_at: 1,
      updated_by: 1,
      updated_at: 1,
      ...extra,
    };
    const columns = Object.keys(row);
    return database
      .prepare(
        `INSERT INTO wish (${columns.join(', ')})
         VALUES (${columns.map((c) => `@${c}`).join(', ')})`,
      )
      .run(row);
  };

  const insertLink = (extra: Record<string, unknown> = {}) => {
    const row = {
      txn_id: 1,
      kind: 'wish',
      wish_id: 1,
      month: '2026-10',
      amount: 500,
      amount_manual: 0,
      made_how: 'member',
      made_by: 1,
      made_at: 1,
      ...extra,
    };
    const columns = Object.keys(row);
    return database
      .prepare(
        `INSERT INTO plan_link (${columns.join(', ')})
         VALUES (${columns.map((c) => `@${c}`).join(', ')})`,
      )
      .run(row);
  };

  it('keeps the checks of the wish table in the schema', () => {
    expect(() => insertWish()).not.toThrow();
    const bad: Array<Record<string, unknown>> = [
      { amount: 0 },
      { amount: -1 },
      { state: 'archived' },
      { month: '2026-13' },
      { month: '26-10' },
      { deleted_at: 5 },
      { deleted_by: 1 },
      { created_by: 99 },
      { category_id: 99 },
    ];
    for (const extra of bad) {
      expect(() => insertWish(extra), JSON.stringify(extra)).toThrow(
        /CHECK|FOREIGN KEY/u,
      );
    }
    expect(() => insertWish({ deleted_at: 5, deleted_by: 1 })).not.toThrow();
  });

  it('keeps the checks of the link table in the schema', () => {
    insertWish();
    const bad: Array<Record<string, unknown>> = [
      { kind: 'due_payment' },
      { made_how: 'app' },
      { wish_id: null },
      { wish_id: 99 },
      { txn_id: 99 },
      { month: '2026-00' },
      { amount_manual: 2 },
      { amount: null, amount_manual: 1 },
      { detached_at: 5 },
      { detached_reason: 'wish_deleted' },
      { detached_at: 5, detached_reason: 'undone' },
    ];
    for (const extra of bad) {
      expect(() => insertLink(extra), JSON.stringify(extra)).toThrow(
        /CHECK|FOREIGN KEY|NOT NULL/u,
      );
    }
    // A link without an amount is allowed (rate missing), but not a typed one.
    expect(() => insertLink({ amount: null })).not.toThrow();
  });

  it('removes a link with its transaction, and keeps a wish that has links', () => {
    insertWish();
    insertLink();
    expect(() =>
      database.prepare('DELETE FROM wish WHERE id = 1').run(),
    ).toThrow(/FOREIGN KEY/u);
    database.prepare('DELETE FROM txn WHERE id = 1').run();
    expect(
      database.prepare('SELECT COUNT(*) AS n FROM plan_link').get(),
    ).toEqual({ n: 0n });
  });
});

describe('migration 0006: wishes', () => {
  let root: string;
  const databases: Database.Database[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'budget-buddy-wishes-migration-'));
  });

  afterEach(async () => {
    for (const database of databases) if (database.open) database.close();
    databases.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  /** A copy of the migrations folder as `main` had it before 0006. */
  async function previousMainMigrations(): Promise<string> {
    const folder = join(root, 'main-migrations');
    await mkdir(join(folder, 'meta'), { recursive: true });
    const journal = JSON.parse(
      await readFile(join(drizzleFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const kept = journal.entries.filter(({ tag }) => !tag.startsWith('0006_'));
    expect(kept).toHaveLength(6);
    for (const { tag } of kept) {
      await cp(join(drizzleFolder, `${tag}.sql`), join(folder, `${tag}.sql`));
    }
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: kept }),
    );
    return folder;
  }

  it('migrates a database made by the previous main through 0006 and keeps its rows', async () => {
    const dataDir = join(root, 'data');
    await mkdir(dataDir, { recursive: true });
    const old = new Database(join(dataDir, 'budget-buddy.sqlite'));
    old.pragma('journal_mode = WAL');
    old.pragma('foreign_keys = ON');
    expect(
      await migrateDatabase(old, {
        backupDir: join(root, 'old-backups'),
        migrationsFolder: await previousMainMigrations(),
      }),
    ).toBe(6);
    old.exec(`
      INSERT INTO family (id, password_hash, created_at)
        VALUES (1, 'x', 1);
      INSERT INTO member (id, name, created_at) VALUES (1, 'Alex', 1);
      INSERT INTO account (id, name, type, currency, created_by, created_at,
        updated_by, updated_at) VALUES (1, 'Joint', 'bank', 'EUR', 1, 1, 1, 1);
      INSERT INTO txn (id, kind, date, account_id, amount, member_id,
        created_by, created_at, updated_by, updated_at)
        VALUES (1, 'expense', '2026-10-10', 1, -500, 1, 1, 1, 1, 1);
    `);
    const before = old.prepare('SELECT * FROM txn').safeIntegers(true).all();
    old.close();

    const config = parseConfig({
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      BACKUP_DIR: join(root, 'backups'),
    });
    const database = await openDatabase(config);
    databases.push(database);
    expect(migrationVersion(database)).toBe(7);
    expect(
      database.prepare('SELECT * FROM txn').safeIntegers(true).all(),
    ).toEqual(before);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS n FROM wish').get()).toEqual({
      n: 0n,
    });
    expect(
      database.prepare('SELECT COUNT(*) AS n FROM plan_link').get(),
    ).toEqual({ n: 0n });
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
