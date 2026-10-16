import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

/** "Needs a category" and labelling (spec 2 task 14; CAT-7, O7, O8). */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

interface Row {
  id: number;
  kind: string;
  amount: string;
  merchant: string | null;
  suggestion: { categoryId: number; categoryName: string } | null;
}

interface Waiting {
  transactions: Row[];
  nextCursor: string | null;
  count: number;
}

describe('needs a category', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let alex: string;
  let joint: number;
  let cash: number;
  let groceriesEnvelope: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-label-'));
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
    joint = await post('/api/accounts', {
      name: 'Joint',
      type: 'bank',
      currency: 'EUR',
    });
    cash = await post('/api/accounts', {
      name: 'Cash',
      type: 'cash',
      currency: 'EUR',
    });
    groceriesEnvelope = await post('/api/envelopes', {
      name: 'Groceries',
      currency: 'EUR',
      monthlyAmount: '40000',
      mode: 'carry_over',
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function call(
    method: 'GET' | 'POST' | 'PATCH',
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

  async function post(url: string, payload: object): Promise<number> {
    const response = await call('POST', url, payload);
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    return (body.account ?? body.envelope ?? body.transaction ?? body.rule).id;
  }

  function category(name: string): number {
    const row = database
      .prepare('SELECT id FROM category WHERE name = ?')
      .get(name) as { id: bigint };
    return Number(row.id);
  }

  /** An expense; `date` defaults to a few days ago. */
  function expense(payload: Record<string, unknown>): Promise<number> {
    return post('/api/transactions', {
      kind: 'expense',
      date: '2026-10-12',
      accountId: joint,
      amount: '1000',
      ...payload,
    });
  }

  async function waiting(query = ''): Promise<Waiting> {
    const response = await call(
      'GET',
      `/api/transactions/needs-category${query}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  async function suggestionFor(id: number): Promise<string | undefined> {
    const row = (await waiting()).transactions.find((item) => item.id === id);
    expect(row, `#${id} waits`).toBeDefined();
    return row?.suggestion?.categoryName;
  }

  async function label(items: object[]) {
    return call('POST', '/api/transactions/label', { items });
  }

  function stored(id: number) {
    return database
      .prepare(
        `SELECT p.category_id AS categoryId, p.envelope_id AS envelopeId,
                p.envelope_amount AS envelopeAmount
           FROM txn_part p WHERE p.txn_id = ?`,
      )
      .get(id) as {
      categoryId: bigint | null;
      envelopeId: bigint | null;
      envelopeAmount: bigint | null;
    };
  }

  it('lists an expense saved with only an amount, with a suggestion, on an empty history', async () => {
    const bare = await expense({});
    const pay = await post('/api/transactions', {
      kind: 'income',
      accountId: joint,
      amount: '5000',
    });
    const body = await waiting();
    expect(body.count).toBe(2);
    expect(body.nextCursor).toBeNull();
    const byId = new Map(body.transactions.map((row) => [row.id, row]));
    // The first active category of the row's kind (3.6, last step).
    expect(byId.get(bare)?.suggestion?.categoryName).toBe('Groceries');
    expect(byId.get(pay)?.suggestion?.categoryName).toBe('Salary');
    expect(byId.get(bare)).toMatchObject({
      kind: 'expense',
      amount: '1000',
      merchant: null,
    });
  });

  it('skips archived categories and has none when a kind has no active one', async () => {
    const bare = await expense({});
    await call('PATCH', `/api/categories/${category('Groceries')}`, {
      archived: true,
    });
    expect(await suggestionFor(bare)).toBe('Eating out');
    for (const name of ['Salary', 'Other income']) {
      await call('PATCH', `/api/categories/${category(name)}`, {
        archived: true,
      });
    }
    const pay = await post('/api/transactions', {
      kind: 'income',
      accountId: joint,
      amount: '5000',
    });
    const row = (await waiting()).transactions.find((item) => item.id === pay);
    expect(row?.suggestion).toBeNull();
  });

  it('follows the chain of 3.6 step by step', async () => {
    // Shell on the joint account, paid by Alex, into the Treats envelope.
    const treats = await post('/api/envelopes', {
      name: 'Treats',
      currency: 'EUR',
      monthlyAmount: '1000',
      mode: 'reset',
      defaultCategoryId: category('Leisure'),
    });
    // Saving with an envelope would fill the category, so attach it after.
    const target = await expense({ merchant: 'Shell', date: '2026-10-14' });
    await call('PATCH', `/api/transactions/${target}`, { envelopeId: treats });
    // 6. Nothing to go on but the list: the first active category.
    // (Its envelope's default is step 3, so use a row without an envelope.)
    const plain = await expense({ merchant: 'Kiosk', date: '2026-10-14' });
    expect(await suggestionFor(plain)).toBe('Groceries');

    // 5. The family's most used in the last 90 days.
    for (let i = 0; i < 3; i += 1) {
      await expense({
        accountId: cash,
        memberId: 2,
        categoryId: category('Transport'),
        merchant: `Other ${i}`,
      });
    }
    await expense({
      accountId: cash,
      memberId: 2,
      categoryId: category('Health'),
      merchant: 'Pharmacy',
    });
    expect(await suggestionFor(plain)).toBe('Transport');

    // An old one is outside the window and counts for nothing.
    for (let i = 0; i < 5; i += 1) {
      await expense({
        accountId: cash,
        date: '2026-04-01',
        categoryId: category('Shopping'),
        merchant: `Old ${i}`,
      });
    }
    expect(await suggestionFor(plain)).toBe('Transport');

    // 4. The payer's most used on that account beats the family's.
    for (let i = 0; i < 2; i += 1) {
      await expense({
        categoryId: category('Eating out'),
        merchant: `Lunch ${i}`,
      });
    }
    expect(await suggestionFor(plain)).toBe('Eating out');

    // 3. The default category of its envelope beats the payer's habit.
    expect(await suggestionFor(target)).toBe('Leisure');

    // 2. The same merchant key (case and spaces folded) beats that.
    await expense({
      merchant: '  SHELL ',
      categoryId: category('Travel'),
      accountId: cash,
    });
    expect(await suggestionFor(target)).toBe('Travel');

    // 1. A rule beats the history.
    await post('/api/rules', {
      pattern: 'shell, esso',
      categoryId: category('Fees and taxes'),
    });
    expect(await suggestionFor(target)).toBe('Fees and taxes');

    // A rule limited to another account does not match.
    const limited = await expense({ merchant: 'Esso', date: '2026-10-14' });
    await post('/api/rules', {
      pattern: 'esso',
      categoryId: category('Gifts'),
      accountId: cash,
      placement: 'first',
    });
    expect(await suggestionFor(limited)).toBe('Fees and taxes');
  });

  it('counts confirmed transactions only and leaves out transfers', async () => {
    const plain = await expense({ date: '2026-10-14' });
    const other = await post('/api/accounts', {
      name: 'Savings',
      type: 'bank',
      currency: 'EUR',
    });
    await post('/api/transactions', {
      kind: 'transfer',
      accountId: joint,
      toAccountId: other,
      amount: '2500',
    });
    // A draft inserted directly: it is not listed and it does not count.
    database
      .prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
           source, created_by, created_at, updated_by, updated_at)
         VALUES ('expense', 'draft', '2026-10-13', ?, 900, 1, 'typed', 1, 0,
           1, 0)`,
      )
      .run(joint);
    const draft = Number(
      (
        database.prepare('SELECT MAX(id) AS id FROM txn').get() as {
          id: bigint;
        }
      ).id,
    );
    database
      .prepare(
        `INSERT INTO txn_part (txn_id, position, amount, category_id)
         VALUES (?, 1, 900, ?)`,
      )
      .run(draft, category('Travel'));
    const body = await waiting();
    expect(body.count).toBe(1);
    expect(body.transactions.map((row) => row.id)).toEqual([plain]);
    expect(await suggestionFor(plain)).toBe('Groceries');
  });

  it('pages by date and id, fifty at a time, with the whole count', async () => {
    const made: number[] = [];
    for (let i = 0; i < 52; i += 1) {
      made.push(await expense({ date: i < 30 ? '2026-10-14' : '2026-10-13' }));
    }
    const first = await waiting();
    expect(first.count).toBe(52);
    expect(first.transactions).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await waiting(`?cursor=${first.nextCursor}`);
    expect(second.transactions).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const all = [...first.transactions, ...second.transactions].map(
      (row) => row.id,
    );
    expect(new Set(all).size).toBe(52);
    expect(all).toEqual(
      [...made].sort((a, b) => {
        const day = (id: number) => (made.indexOf(id) < 30 ? 1 : 0);
        return day(b) - day(a) || b - a;
      }),
    );
    expect(
      (await call('GET', '/api/transactions/needs-category?cursor=x'))
        .statusCode,
    ).toBe(400);
  });

  it('labels an expense with no envelope and gives it the default envelope, and the undo puts both back', async () => {
    await call('PATCH', `/api/categories/${category('Groceries')}`, {
      defaultEnvelopeId: groceriesEnvelope,
    });
    const bare = await expense({ merchant: 'Edeka' });

    const done = await label([{ id: bare, categoryId: category('Groceries') }]);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toEqual({
      labelled: [
        {
          id: bare,
          categoryId: category('Groceries'),
          filledEnvelopeId: groceriesEnvelope,
          filledEnvelopeName: 'Groceries',
        },
      ],
      skipped: [],
      count: 0,
    });
    expect(stored(bare)).toMatchObject({
      categoryId: BigInt(category('Groceries')),
      envelopeId: BigInt(groceriesEnvelope),
      envelopeAmount: 1000n,
    });

    const undone = await label([
      { id: bare, categoryId: null, takeBackEnvelopeId: groceriesEnvelope },
    ]);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({ count: 1, skipped: [] });
    expect(stored(bare)).toEqual({
      categoryId: null,
      envelopeId: null,
      envelopeAmount: null,
    });
    expect((await waiting()).transactions.map((row) => row.id)).toEqual([bare]);
  });

  it('keeps an envelope the expense already has and an undo without one', async () => {
    await call('PATCH', `/api/categories/${category('Groceries')}`, {
      defaultEnvelopeId: groceriesEnvelope,
    });
    const treats = await post('/api/envelopes', {
      name: 'Treats',
      currency: 'EUR',
      monthlyAmount: '1000',
      mode: 'reset',
    });
    const kept = await expense({ envelopeId: treats });
    const done = await label([{ id: kept, categoryId: category('Groceries') }]);
    expect(done.json().labelled[0].filledEnvelopeId).toBeNull();
    expect(stored(kept).envelopeId).toBe(BigInt(treats));
    await label([{ id: kept, categoryId: null }]);
    expect(stored(kept)).toMatchObject({
      categoryId: null,
      envelopeId: BigInt(treats),
    });
  });

  it('labels several at once, income included, and writes a revision for each', async () => {
    const a = await expense({ merchant: 'A' });
    const b = await expense({ merchant: 'B' });
    const pay = await post('/api/transactions', {
      kind: 'income',
      accountId: joint,
      amount: '5000',
    });
    const done = await label([
      { id: a, categoryId: category('Transport') },
      { id: b, categoryId: category('Health') },
      { id: pay, categoryId: category('Salary') },
    ]);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().count).toBe(0);
    const revisions = database
      .prepare(
        `SELECT txn_id AS id, action, changes, changed_by AS by
           FROM txn_revision WHERE txn_id IN (?, ?, ?) ORDER BY id`,
      )
      .all(a, b, pay) as Array<{
      id: bigint;
      action: string;
      changes: string;
      by: bigint;
    }>;
    expect(revisions.map((row) => Number(row.id))).toEqual([a, b, pay]);
    expect(JSON.parse(revisions[0]!.changes)).toEqual({
      categoryId: [null, category('Transport')],
    });
    expect(revisions.every((row) => row.action === 'update')).toBe(true);
    expect(revisions.every((row) => row.by === 1n)).toBe(true);
    const updated = database
      .prepare('SELECT updated_by AS by FROM txn WHERE id = ?')
      .get(a) as { by: bigint };
    expect(updated.by).toBe(1n);
  });

  it('refuses a wrong category and leaves nothing half done', async () => {
    const a = await expense({});
    const pay = await post('/api/transactions', {
      kind: 'income',
      accountId: joint,
      amount: '5000',
    });
    const mismatch = await label([
      { id: a, categoryId: category('Transport') },
      { id: pay, categoryId: category('Transport') },
    ]);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('validation');
    expect(stored(a).categoryId).toBeNull();

    await call('PATCH', `/api/categories/${category('Health')}`, {
      archived: true,
    });
    expect(
      (await label([{ id: a, categoryId: category('Health') }])).statusCode,
    ).toBe(400);
    expect((await label([{ id: a, categoryId: 99999 }])).statusCode).toBe(400);

    const other = await post('/api/accounts', {
      name: 'Savings',
      type: 'bank',
      currency: 'EUR',
    });
    const move = await post('/api/transactions', {
      kind: 'transfer',
      accountId: joint,
      toAccountId: other,
      amount: '2500',
    });
    const transfer = await label([
      { id: a, categoryId: category('Transport') },
      { id: move, categoryId: category('Transport') },
    ]);
    expect(transfer.statusCode).toBe(400);
    expect(stored(a).categoryId).toBeNull();
    expect(
      (
        await label([
          { id: a, categoryId: 1 },
          { id: a, categoryId: 2 },
        ])
      ).statusCode,
    ).toBe(400);
  });

  it('skips rows that are gone or no longer wait, and changes the rest', async () => {
    const a = await expense({});
    const b = await expense({ categoryId: category('Health') });
    const done = await label([
      { id: a, categoryId: category('Transport') },
      { id: b, categoryId: category('Transport') },
      { id: 424242, categoryId: category('Transport') },
      { id: 424243, categoryId: null },
    ]);
    expect(done.statusCode, done.body).toBe(200);
    const body = done.json();
    expect(body.labelled.map((row: { id: number }) => row.id)).toEqual([a]);
    expect(body.skipped).toEqual([b, 424242, 424243]);
    expect(stored(b).categoryId).toBe(BigInt(category('Health')));
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
