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

  it('suggests nothing for an expense saved with only an amount', async () => {
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
    // No merchant: not sure of anything, even with history to count.
    expect(byId.get(bare)?.suggestion).toBeNull();
    expect(byId.get(pay)?.suggestion).toBeNull();
    expect(byId.get(bare)).toMatchObject({
      kind: 'expense',
      amount: '1000',
      merchant: null,
    });
    for (let i = 0; i < 3; i += 1) {
      await expense({
        categoryId: category('Groceries'),
        merchant: `Shop ${i}`,
      });
    }
    expect(await suggestionFor(bare)).toBeUndefined();
  });

  it('suggests nothing for a merchant never labelled before', async () => {
    await expense({ categoryId: category('Transport'), merchant: 'Metro' });
    const fresh = await expense({ merchant: 'Kiosk' });
    expect(await suggestionFor(fresh)).toBeUndefined();
  });

  it('does not suggest the default category of the envelope', async () => {
    const treats = await post('/api/envelopes', {
      name: 'Treats',
      currency: 'EUR',
      monthlyAmount: '1000',
      mode: 'reset',
      defaultCategoryId: category('Leisure'),
    });
    // Saving with an envelope would fill the category, so attach it after.
    const target = await expense({ merchant: 'Cinema' });
    await call('PATCH', `/api/transactions/${target}`, { envelopeId: treats });
    expect(await suggestionFor(target)).toBeUndefined();
  });

  it('suggests the category a rule gives', async () => {
    const shell = await expense({ merchant: 'Shell' });
    await post('/api/rules', {
      pattern: 'shell, esso',
      categoryId: category('Transport'),
    });
    expect(await suggestionFor(shell)).toBe('Transport');

    // A rule limited to another account does not match.
    const limited = await expense({ merchant: 'Lidl' });
    await post('/api/rules', {
      pattern: 'lidl',
      categoryId: category('Groceries'),
      accountId: cash,
    });
    expect(await suggestionFor(limited)).toBeUndefined();
  });

  it('suggests the category most used with the same merchant key', async () => {
    const target = await expense({ merchant: 'Shell', date: '2026-10-14' });
    // The same key with other case and spaces; the rule-less history wins.
    for (const [merchant, name] of [
      ['  SHELL ', 'Travel'],
      ['shell', 'Travel'],
      ['Shell', 'Transport'],
    ] as const) {
      await expense({ merchant, categoryId: category(name), accountId: cash });
    }
    // Other merchants, however common, do not count.
    for (let i = 0; i < 4; i += 1) {
      await expense({
        merchant: `Other ${i}`,
        categoryId: category('Health'),
      });
    }
    expect(await suggestionFor(target)).toBe('Travel');

    // A rule beats the history.
    await post('/api/rules', {
      pattern: 'shell',
      categoryId: category('Fees and taxes'),
    });
    expect(await suggestionFor(target)).toBe('Fees and taxes');
  });

  it('proposes only active categories of the row kind', async () => {
    const target = await expense({ merchant: 'Shell' });
    await expense({
      merchant: 'Shell',
      categoryId: category('Transport'),
      accountId: cash,
    });
    expect(await suggestionFor(target)).toBe('Transport');
    await call('PATCH', `/api/categories/${category('Transport')}`, {
      archived: true,
    });
    expect(await suggestionFor(target)).toBeUndefined();
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
    expect(await suggestionFor(plain)).toBeUndefined();
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
