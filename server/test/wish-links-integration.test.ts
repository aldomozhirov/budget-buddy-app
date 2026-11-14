import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { fillPendingLinkAmounts } from '../src/domain/wishLinks.js';
import type { FeedRate, FeedRequest, RateFeed } from '../src/rates/feed.js';
import { createRatesService, type RatesService } from '../src/rates/service.js';

/**
 * Links from a transaction to a wish (spec 3a, TASK-41): PLN-14, O1, O3, O5,
 * O9 and O13, the money of Design 3 and the history of Design 6.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** A parsed JSON answer, read loosely by the tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('wish links on transactions', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;
  let blair: string;
  let rates: RatesService;
  let answer: (request: FeedRequest) => FeedRate[];
  let fetch: ReturnType<typeof makeFetch>;

  function makeFetch() {
    return vi.fn<(request: FeedRequest) => Promise<FeedRate[]>>((request) =>
      Promise.resolve(answer(request)),
    );
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-wish-links-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    now = Date.parse('2026-10-15T10:00:00.000Z');
    const clock = { now: () => new Date(now) };
    answer = () => [];
    fetch = makeFetch();
    const feed: RateFeed = {
      id: 'test',
      source: 'Test rates',
      covers: ({ code }) => code !== 'EUR',
      targetDate: (_now, today) => today,
      fetch,
    };
    rates = createRatesService({
      database,
      clock,
      feeds: [feed],
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

  async function account(name: string, currency: string): Promise<number> {
    const response = await call('POST', '/api/accounts', {
      name,
      type: 'bank',
      currency,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().account.id;
  }

  async function envelope(name: string, currency = 'EUR'): Promise<number> {
    const response = await call('POST', '/api/envelopes', {
      name,
      currency,
      monthlyAmount: '40000',
      mode: 'carry_over',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

  async function envelopeCurrent(id: number): Promise<Json> {
    const response = await call('GET', `/api/envelopes/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().envelope.current;
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

  async function patch(
    id: number,
    body: Record<string, unknown>,
    cookie = alex,
  ) {
    return call('PATCH', `/api/transactions/${id}`, body, cookie);
  }

  /** A PATCH that must succeed; answers the transaction. */
  async function patched(
    id: number,
    body: Record<string, unknown>,
    cookie = alex,
  ): Promise<Json> {
    const response = await patch(id, body, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().transaction;
  }

  async function read(id: number): Promise<Json> {
    const response = await call('GET', `/api/transactions/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().transaction;
  }

  function rate(base: string, quote: string, date: string, value: string) {
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES (?, ?, ?, ?, 'Test rates', 0)`,
      )
      .run(base, quote, date, value);
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
      changes: JSON.parse(row.changes) as Json,
      changedBy: Number(row.changedBy),
    }));
  }

  function lastRevision(txnId: number) {
    return revisions(txnId).at(-1)!;
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
    return database
      .prepare(
        `SELECT category_id AS categoryId, envelope_id AS envelopeId,
           envelope_amount AS envelopeAmount,
           envelope_amount_manual AS envelopeAmountManual
         FROM txn_part WHERE txn_id = ?`,
      )
      .get(txnId) as {
      categoryId: bigint | null;
      envelopeId: bigint | null;
      envelopeAmount: bigint | null;
      envelopeAmountManual: bigint | null;
    };
  }

  function linkRow(txnId: number) {
    return database
      .prepare(
        `SELECT amount, amount_manual AS manual, month, made_how AS madeHow,
           made_by AS madeBy FROM plan_link
         WHERE txn_id = ? AND detached_at IS NULL`,
      )
      .get(txnId) as
      | {
          amount: bigint | null;
          manual: bigint;
          month: string;
          madeHow: string;
          madeBy: bigint | null;
        }
      | undefined;
  }

  const tyres = (id: number, name = 'Winter tyres', madeHow = 'member') => ({
    kind: 'wish',
    wishId: id,
    name,
    madeHow,
  });

  // --- 1 -----------------------------------------------------------------

  it('counts an expense for a wish of its month and adds it to what was spent', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint, { amount: '12000' });

    const after = await patched(txn, { wishId: w });
    expect(after.countsFor).toMatchObject({
      type: 'wish',
      id: w,
      name: 'Winter tyres',
      linkAmount: '12000',
      linkAmountManual: false,
      linkCurrency: 'EUR',
      madeHow: 'member',
      madeBy: 1,
    });
    expect(await wishRead(w)).toMatchObject({
      spent: '12000',
      left: '36000',
      expenseCount: 1,
    });
    expect((await wishRead(w)).expenses[0]).toMatchObject({
      transactionId: txn,
      linkAmount: '12000',
      madeHow: 'member',
      madeBy: 'Alex',
    });
    expect(linkRow(txn)).toMatchObject({ month: '2026-10', amount: 12000n });
  });

  it('refuses a wish of another month and leaves the expense as it was', async () => {
    const joint = await account('Joint', 'EUR');
    const november = await wish({ month: '2026-11' });
    const txn = await expense(joint);
    const response = await patch(txn, { wishId: november });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('validation');
    expect(response.json().error.fields?.wishId).toBeTruthy();
    expect(activeLinks(txn)).toBe(0);
    expect(revisions(txn)).toHaveLength(0);
    expect((await read(txn)).countsFor).toEqual({ type: 'none' });

    // A wish that does not exist is refused the same way.
    const missing = await patch(txn, { wishId: 9999 });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('validation');
  });

  it('links a refund as a negative amount that subtracts from what was spent', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const bought = await expense(joint, { amount: '12000' });
    const refund = await expense(joint, {
      amount: '-2500',
      date: '2026-10-09',
    });
    await patched(bought, { wishId: w });
    const linked = await patched(refund, { wishId: w });
    expect(linked.countsFor).toMatchObject({ linkAmount: '-2500' });
    expect(await wishRead(w)).toMatchObject({
      spent: '9500',
      left: '38500',
      expenseCount: 2,
    });
  });

  it('keeps a link when other fields change and when the date stays in the month', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint);
    await patched(txn, { wishId: w }, blair);
    const before = revisions(txn).length;
    const note = await patched(txn, { note: 'Fitting' });
    expect(note.countsFor).toMatchObject({ type: 'wish', madeBy: 2 });
    const date = await patched(txn, { date: '2026-10-12' });
    expect(date.countsFor).toMatchObject({ type: 'wish', madeBy: 2 });
    // Neither revision records a link change.
    for (const revision of revisions(txn).slice(before)) {
      expect(revision.changes).not.toHaveProperty('link');
    }
    // Repeating the same wish changes nothing and writes nothing.
    const count = revisions(txn).length;
    await patched(txn, { wishId: w });
    expect(revisions(txn)).toHaveLength(count);
    // Neither does null on an expense that has no link.
    const bare = await expense(joint);
    await patched(bare, { wishId: null });
    expect(revisions(bare)).toHaveLength(0);
  });

  // --- 2 -----------------------------------------------------------------

  it('takes the expense out of its envelope when a wish is chosen', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const txn = await expense(joint, {
      amount: '3000',
      envelopeId: groceries,
      categoryId: category('Groceries'),
    });
    expect((await read(txn)).countsFor).toMatchObject({
      type: 'envelope',
      id: groceries,
      name: 'Groceries',
    });
    const before = await envelopeCurrent(groceries);
    expect(before.spent).toBe('3000');

    const after = await patched(txn, { wishId: w });
    expect(after).toMatchObject({
      envelopeId: null,
      envelopeAmount: null,
      categoryId: category('Groceries'),
    });
    expect(after.countsFor).toMatchObject({ type: 'wish', id: w });
    const envelopeAfter = await envelopeCurrent(groceries);
    expect(envelopeAfter.spent).toBe('0');
    expect(BigInt(envelopeAfter.closing) - BigInt(before.closing)).toBe(3000n);
    expect(part(txn)).toMatchObject({
      envelopeId: null,
      envelopeAmount: null,
    });
    expect((await wishRead(w)).spent).toBe('3000');
  });

  it('clears a typed envelope amount with the envelope', async () => {
    const wise = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000', envelopeId: groceries });
    await patched(txn, { envelopeAmount: '1700' });
    expect(part(txn).envelopeAmountManual).toBe(1n);
    await patched(txn, { wishId: w });
    expect(part(txn)).toMatchObject({
      envelopeId: null,
      envelopeAmount: null,
    });
    expect(Number(part(txn).envelopeAmountManual ?? 0n)).toBe(0);
    expect(lastRevision(txn).changes).toMatchObject({
      envelopeId: [groceries, null],
      link: [null, tyres(w)],
    });
  });

  // --- 3 -----------------------------------------------------------------

  it('answers 400, not 500, to a wish with a typed envelope amount on an expense in another currency', async () => {
    const wise = await account('Wise $', 'USD');
    const groceries = await envelope('Groceries');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000', envelopeId: groceries });
    const before = await read(txn);
    const revisionsBefore = revisions(txn).length;

    const response = await patch(txn, { wishId: w, envelopeAmount: '1700' });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('validation');
    expect(response.json().error.fields?.envelopeAmount).toBeTruthy();
    // Nothing changed: the expense still counts for its envelope.
    expect(await read(txn)).toEqual(before);
    expect(activeLinks(txn)).toBe(0);
    expect(revisions(txn)).toHaveLength(revisionsBefore);
    expect(part(txn)).toMatchObject({
      envelopeId: BigInt(groceries),
      envelopeAmount: 1800n,
    });
    expect((await envelopeCurrent(groceries)).spent).toBe('1800');

    // The same on an expense already linked: the link stays as it was.
    await patched(txn, { wishId: w });
    const linked = await read(txn);
    const again = await patch(txn, { wishId: w, envelopeAmount: '1700' });
    expect(again.statusCode, again.body).toBe(400);
    expect(await read(txn)).toEqual(linked);
  });

  it('removes the link when an envelope is chosen, whatever the category', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const txn = await expense(joint, {
      amount: '3000',
      categoryId: category('Transport'),
    });
    await patched(txn, { wishId: w });
    const after = await patched(txn, { envelopeId: groceries });
    expect(after).toMatchObject({
      envelopeId: groceries,
      envelopeAmount: '3000',
      categoryId: category('Transport'),
    });
    expect(after.countsFor).toMatchObject({
      type: 'envelope',
      id: groceries,
    });
    expect(activeLinks(txn)).toBe(0);
    expect((await wishRead(w)).spent).toBe('0');
    expect((await envelopeCurrent(groceries)).spent).toBe('3000');
    expect(lastRevision(txn).changes).toMatchObject({
      link: [tyres(w), null],
      envelopeId: [null, groceries],
    });
  });

  it('removes the link when the date leaves the month (O3), by whoever made it', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint, { categoryId: category('Transport') });
    await patched(txn, { wishId: w }, blair);
    const after = await patched(txn, { date: '2026-09-30' });
    expect(after.categoryId).toBe(category('Transport'));
    expect(after.countsFor).toEqual({ type: 'none' });
    expect(activeLinks(txn)).toBe(0);
    expect((await wishRead(w)).spent).toBe('0');
    const revision = lastRevision(txn);
    expect(revision.changedBy).toBe(1);
    expect(revision.changes.link).toEqual([tyres(w), null]);
    expect(revision.changes).not.toHaveProperty('envelopeId');
    expect(revision.changes.date).toEqual(['2026-10-03', '2026-09-30']);
    // Moving back into the month does not bring the link back.
    expect((await patched(txn, { date: '2026-10-03' })).countsFor.type).toBe(
      'none',
    );
  });

  it('removes the link when neither is chosen, and leaves the envelope alone with a plain null', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const txn = await expense(joint, { categoryId: category('Groceries') });
    await patched(txn, { wishId: w });
    // A null envelope while linked changes neither side.
    const unchanged = await patched(txn, { envelopeId: null });
    expect(unchanged.countsFor.type).toBe('wish');
    const none = await patched(txn, { wishId: null });
    expect(none).toMatchObject({
      envelopeId: null,
      categoryId: category('Groceries'),
    });
    expect(none.countsFor).toEqual({ type: 'none' });
    expect(lastRevision(txn).changes.link).toEqual([tyres(w), null]);
    expect((await envelopeCurrent(groceries)).spent).toBe('0');
  });

  // --- 4 & 13 ------------------------------------------------------------

  it('logs each change with who made it so the four lines of UI-TXN-10 can be shown', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const txn = await expense(joint, { envelopeId: groceries });

    // "Moved from the E envelope to the wish W", by Blair.
    await patched(txn, { wishId: w }, blair);
    let revision = lastRevision(txn);
    expect(revision).toMatchObject({ action: 'update', changedBy: 2 });
    expect(revision.changes).toMatchObject({
      link: [null, tyres(w)],
      envelopeId: [groceries, null],
      linkAmount: [null, '2000'],
    });

    // "Charged to E; link to W removed", by Alex.
    await patched(txn, { envelopeId: groceries });
    revision = lastRevision(txn);
    expect(revision.changedBy).toBe(1);
    expect(revision.changes).toMatchObject({
      link: [tyres(w), null],
      envelopeId: [null, groceries],
    });

    // "Linked to the wish W", by Alex.
    await patched(txn, { envelopeId: null });
    await patched(txn, { wishId: w });
    revision = lastRevision(txn);
    expect(revision.changedBy).toBe(1);
    expect(revision.changes.link).toEqual([null, tyres(w)]);
    expect(revision.changes).not.toHaveProperty('envelopeId');

    // "Link to W removed" with no envelope change.
    await patched(txn, { wishId: null }, blair);
    revision = lastRevision(txn);
    expect(revision.changedBy).toBe(2);
    expect(revision.changes.link).toEqual([tyres(w), null]);
    expect(revision.changes).not.toHaveProperty('envelopeId');
  });

  it('keeps the wish name as it was when linked, after a rename', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint);
    await patched(txn, { wishId: w });
    await call('PATCH', `/api/wishes/${w}`, { name: 'Summer tyres' });
    // The name logged is the wish's name at the time of the change.
    await patched(txn, { wishId: null });
    expect(lastRevision(txn).changes.link).toEqual([
      tyres(w, 'Summer tyres'),
      null,
    ]);
    // An older revision keeps the name it was written with.
    expect(revisions(txn)[0]!.changes.link).toEqual([null, tyres(w)]);
  });

  it('moves a link between wishes and logs both', async () => {
    const joint = await account('Joint', 'EUR');
    const w1 = await wish();
    const w2 = await wish({ name: 'Bike light' });
    const txn = await expense(joint, { amount: '2000' });
    await patched(txn, { wishId: w1 });
    const after = await patched(txn, { wishId: w2 }, blair);
    expect(after.countsFor).toMatchObject({
      type: 'wish',
      id: w2,
      name: 'Bike light',
      madeBy: 2,
      madeHow: 'member',
    });
    expect(activeLinks(txn)).toBe(1);
    expect((await wishRead(w1)).spent).toBe('0');
    expect((await wishRead(w2)).spent).toBe('2000');
    const revision = lastRevision(txn);
    expect(revision.changedBy).toBe(2);
    expect(revision.changes.link).toEqual([tyres(w1), tyres(w2, 'Bike light')]);
  });

  it('writes a delete revision that still says what a deleted expense counted for', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint, { amount: '2000' });
    await patched(txn, { wishId: w });
    const deleted = await call('DELETE', `/api/transactions/${txn}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    const revision = lastRevision(txn);
    expect(revision.action).toBe('delete');
    expect(revision.changes.link).toEqual([tyres(w), null]);
    expect(revision.changes.linkAmount).toEqual(['2000', null]);
    expect(activeLinks(txn)).toBe(0);
    expect((await wishRead(w)).spent).toBe('0');
    expect((await wishRead(w)).expenseCount).toBe(0);
  });

  // --- 5 -----------------------------------------------------------------

  it('does not link a transfer, an income or a draft', async () => {
    const joint = await account('Joint', 'EUR');
    const other = await account('Savings', 'EUR');
    const w = await wish();
    const transfer = (
      await call('POST', '/api/transactions', {
        kind: 'transfer',
        accountId: joint,
        toAccountId: other,
        amount: '2500',
        date: '2026-10-03',
      })
    ).json().transaction.id as number;
    const income = await expense(joint, {
      kind: 'income',
      merchant: undefined,
    });
    database
      .prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
           source, created_by, created_at, updated_by, updated_at)
         VALUES ('expense', 'draft', '2026-10-03', ?, 900, 1, 'typed', 1, 0,
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
        `INSERT INTO txn_part (txn_id, position, amount) VALUES (?, 1, 900)`,
      )
      .run(draft);

    for (const id of [transfer, income, draft]) {
      const response = await patch(id, { wishId: w });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('validation');
      expect(activeLinks(id)).toBe(0);
    }
    expect((await wishRead(w)).spent).toBe('0');
    expect((await read(transfer)).countsFor).toEqual({ type: 'none' });
    expect((await read(income)).countsFor).toEqual({ type: 'none' });
  });

  it('does not link an expense that stops being one: a kind cannot change, so the wish stays refused', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const income = await expense(joint, {
      kind: 'income',
      merchant: undefined,
    });
    const kind = await patch(income, { kind: 'expense', wishId: w });
    expect(kind.statusCode).toBe(400);
    expect(activeLinks(income)).toBe(0);
  });

  // --- 6 -----------------------------------------------------------------

  it('says what a transaction counts for, and for a link how and by whom', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const bare = await expense(joint);
    const boxed = await expense(joint, { envelopeId: groceries });
    const linked = await expense(joint);
    await patched(linked, { wishId: w }, blair);

    expect((await read(bare)).countsFor).toEqual({ type: 'none' });
    expect((await read(boxed)).countsFor).toEqual({
      type: 'envelope',
      id: groceries,
      name: 'Groceries',
    });
    expect((await read(linked)).countsFor).toEqual({
      type: 'wish',
      id: w,
      name: 'Winter tyres',
      linkAmount: '2000',
      linkAmountManual: false,
      linkCurrency: 'EUR',
      madeHow: 'member',
      madeBy: 2,
    });
    // The wish's current name is read, not the one logged.
    await call('PATCH', `/api/wishes/${w}`, { name: 'Tyres' });
    expect((await read(linked)).countsFor.name).toBe('Tyres');
  });

  it('shows the rate of a converted link, and none for a typed or equal one', async () => {
    const wise = await account('Wise $', 'USD');
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const converted = await expense(wise, { amount: '2000' });
    const same = await expense(joint, { amount: '2000' });
    expect((await patched(converted, { wishId: w })).countsFor).toMatchObject({
      linkAmount: '1800',
      rate: { from: 'USD', to: 'EUR', rate: '0.9', date: '2026-10-01' },
    });
    expect((await patched(same, { wishId: w })).countsFor).not.toHaveProperty(
      'rate',
    );
    const typed = await patched(converted, { linkAmount: '1750' });
    expect(typed.countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });
    expect(typed.countsFor).not.toHaveProperty('rate');
  });

  // --- 7 -----------------------------------------------------------------

  it('stores the amount in the wish currency at the rate of the expense date, rounded once, and negative for a refund', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    // 2355 * 0.9 = 2119.5, which rounds away from zero.
    const bought = await expense(wise, { amount: '2355' });
    const refund = await expense(wise, { amount: '-2355', date: '2026-10-05' });
    expect((await patched(bought, { wishId: w })).countsFor.linkAmount).toBe(
      '2120',
    );
    expect((await patched(refund, { wishId: w })).countsFor.linkAmount).toBe(
      '-2120',
    );
    expect(await wishRead(w)).toMatchObject({ spent: '0', incomplete: false });
    // A later rate does not change a stored amount.
    rate('USD', 'EUR', '2026-10-03', '0.5');
    expect(fillPendingLinkAmounts(database)).toBe(0);
    expect((await read(bought)).countsFor.linkAmount).toBe('2120');
  });

  it('uses the nearest earlier rate and converts between currencies of other decimals', async () => {
    const yen = await account('Yen', 'JPY');
    const w = await wish();
    // Only EUR to JPY is stored; JPY to EUR is its inverse.
    rate('EUR', 'JPY', '2026-09-28', '160');
    const txn = await expense(yen, { amount: '3500' });
    const linked = await patched(txn, { wishId: w });
    // 3500 yen is 21.875 euro: 2188 cent.
    expect(linked.countsFor).toMatchObject({ linkAmount: '2188' });
  });

  it('leaves the amount null while no rate exists, and fills it when one is stored', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    const txn = await expense(wise, { amount: '2000' });
    const linked = await patched(txn, { wishId: w });
    expect(linked.countsFor).toMatchObject({
      type: 'wish',
      linkAmount: null,
      linkAmountManual: false,
    });
    expect(linked.countsFor).not.toHaveProperty('rate');
    expect(await wishRead(w)).toMatchObject({ spent: '0', incomplete: true });
    expect(fillPendingLinkAmounts(database)).toBe(0);

    rate('USD', 'EUR', '2026-10-01', '0.9');
    expect(fillPendingLinkAmounts(database)).toBe(1);
    expect((await read(txn)).countsFor).toMatchObject({
      linkAmount: '1800',
      rate: { rate: '0.9' },
    });
    expect(await wishRead(w)).toMatchObject({
      spent: '1800',
      incomplete: false,
    });
    // Run twice, it fills nothing more.
    expect(fillPendingLinkAmounts(database)).toBe(0);
  });

  it('never replaces an amount typed by hand while the rate was missing', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    const typed = await patched(txn, { linkAmount: '1750' });
    expect(typed.countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });
    rate('USD', 'EUR', '2026-10-01', '0.9');
    expect(fillPendingLinkAmounts(database)).toBe(0);
    expect((await read(txn)).countsFor.linkAmount).toBe('1750');
  });

  it('fills a pending link when the rates service stores rates for it', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    answer = (request) =>
      request.currencies.some(({ code }) => code === 'USD')
        ? daysFrom(request.from, request.to).map((date) => ({
            base: 'USD',
            quote: 'EUR',
            date,
            rate: '0.9',
          }))
        : [];
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    await rates.idle();
    expect((await read(txn)).countsFor.linkAmount).toBe('1800');
    expect((await wishRead(w)).spent).toBe('1800');
  });

  it('makes the rates service price a wish currency no account uses, back to the link dates', async () => {
    const joint = await account('Joint', 'EUR');
    const june = await wish({ month: '2026-06', currency: 'USD' });
    answer = (request) =>
      request.currencies.some(({ code }) => code === 'USD')
        ? daysFrom(request.from, request.to).map((date) => ({
            base: 'EUR',
            quote: 'USD',
            date,
            rate: '1.2',
          }))
        : [];
    const usdRequests = () =>
      fetch.mock.calls.flatMap(([request]) =>
        request.currencies.some(({ code }) => code === 'USD') ? [request] : [],
      );

    await rates.refreshToday();
    // Only the wish uses dollars; the daily fetch asks for them.
    expect(usdRequests().length).toBeGreaterThan(0);
    expect(usdRequests().every((request) => request.from > '2026-06-01')).toBe(
      true,
    );

    const txn = await expense(joint, { amount: '2000', date: '2026-06-01' });
    await patched(txn, { wishId: june });
    await rates.idle();
    // Two weeks of margin before the expense's date, as for snapshots.
    expect(usdRequests().map((request) => request.from)).toContain(
      '2026-05-18',
    );
    expect((await read(txn)).countsFor).toMatchObject({
      linkCurrency: 'USD',
      linkAmount: '2400',
    });
    expect((await wishRead(june)).spent).toBe('2400');
  });

  it('stops asking for the currency of a deleted wish', async () => {
    await account('Joint', 'EUR');
    const w = await wish({ currency: 'USD' });
    await call('DELETE', `/api/wishes/${w}`);
    fetch.mockClear();
    await rates.refreshToday();
    expect(
      fetch.mock.calls.some(([request]) =>
        request.currencies.some(({ code }) => code === 'USD'),
      ),
    ).toBe(false);
  });

  // --- 8 -----------------------------------------------------------------

  it('sums the stored link amounts, and detaches the links of a deleted wish with a revision on each expense', async () => {
    const joint = await account('Joint', 'EUR');
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const a = await expense(joint, { amount: '12000' });
    const b = await expense(wise, { amount: '2000' });
    const c = await expense(joint, { amount: '-1000', date: '2026-10-08' });
    await patched(a, { wishId: w });
    await patched(b, { wishId: w });
    await patched(c, { wishId: w });
    expect(await wishRead(w)).toMatchObject({
      spent: '12800',
      left: '35200',
      expenseCount: 3,
    });

    const deleted = await call('DELETE', `/api/wishes/${w}`, undefined, blair);
    expect(deleted.statusCode, deleted.body).toBe(204);
    const rows = database
      .prepare(
        `SELECT txn_id AS id, detached_at AS at, detached_reason AS reason
         FROM plan_link ORDER BY id`,
      )
      .all() as Array<{ id: bigint; at: bigint; reason: string }>;
    expect(rows).toHaveLength(3);
    const deletedAt = (
      database
        .prepare('SELECT deleted_at AS at FROM wish WHERE id = ?')
        .get(w) as {
        at: bigint;
      }
    ).at;
    for (const row of rows) {
      expect(row.reason).toBe('wish_deleted');
      expect(row.at).toBe(deletedAt);
    }
    for (const id of [a, b, c]) {
      expect(activeLinks(id)).toBe(0);
      expect((await read(id)).countsFor).toEqual({ type: 'none' });
      const revision = lastRevision(id);
      expect(revision).toMatchObject({ action: 'update', changedBy: 2 });
      expect(revision.changes.link).toEqual([tyres(w), null]);
    }
    // The amount converted and the kept row are not changed by the detach.
    expect(
      (
        database
          .prepare('SELECT amount FROM plan_link WHERE txn_id = ?')
          .get(b) as { amount: bigint }
      ).amount,
    ).toBe(1800n);
  });

  it('does not touch the links of a wish that has none, and logs nothing for it', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const other = await wish({ name: 'Other' });
    const txn = await expense(joint);
    await patched(txn, { wishId: other });
    const before = revisions(txn).length;
    await call('DELETE', `/api/wishes/${w}`);
    expect(revisions(txn)).toHaveLength(before);
    expect(activeLinks(txn)).toBe(1);
  });

  // --- 9 -----------------------------------------------------------------

  it('lets a member type the converted amount, then recomputes it when amount, date, account or wish change', async () => {
    const wise = await account('Wise $', 'USD');
    const pound = await account('Pound', 'GBP');
    const w = await wish();
    const w2 = await wish({ name: 'Bike light' });
    rate('USD', 'EUR', '2026-10-01', '0.9');
    rate('GBP', 'EUR', '2026-10-01', '1.2');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });

    const typed = await patched(txn, { linkAmount: '1750' }, blair);
    expect(typed.countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });
    expect(linkRow(txn)).toMatchObject({ amount: 1750n, manual: 1n });
    const revision = lastRevision(txn);
    expect(revision.changedBy).toBe(2);
    expect(revision.changes).toEqual({
      linkAmount: ['1800', '1750'],
      linkAmountManual: [false, true],
      linkWish: { wishId: w, name: 'Winter tyres' },
    });
    expect((await wishRead(w)).spent).toBe('1750');

    // Other edits keep it.
    expect((await patched(txn, { note: 'x' })).countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });

    // The amount.
    expect((await patched(txn, { amount: '3000' })).countsFor).toMatchObject({
      linkAmount: '2700',
      linkAmountManual: false,
    });
    expect(lastRevision(txn).changes).toMatchObject({
      linkAmount: ['1750', '2700'],
      linkAmountManual: [true, false],
      linkWish: { wishId: w },
    });

    // The date.
    await patched(txn, { linkAmount: '2500' });
    rate('USD', 'EUR', '2026-10-06', '0.8');
    expect(
      (await patched(txn, { date: '2026-10-07' })).countsFor,
    ).toMatchObject({ linkAmount: '2400', linkAmountManual: false });

    // The account.
    await patched(txn, { linkAmount: '2500' });
    expect((await patched(txn, { accountId: pound })).countsFor).toMatchObject({
      linkAmount: '3600',
      linkAmountManual: false,
    });

    // The wish.
    await patched(txn, { linkAmount: '2500' });
    const moved = await patched(txn, { wishId: w2 });
    expect(moved.countsFor).toMatchObject({
      id: w2,
      linkAmount: '3600',
      linkAmountManual: false,
    });
    expect(lastRevision(txn).changes).toMatchObject({
      link: [tyres(w), tyres(w2, 'Bike light')],
      linkAmount: ['2500', '3600'],
      linkAmountManual: [true, false],
    });
  });

  it('recomputes the converted amount when the request sends null, and lets a typed value win over a change of amount', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    await patched(txn, { linkAmount: '1750' });
    const reset = await patched(txn, { linkAmount: null });
    expect(reset.countsFor).toMatchObject({
      linkAmount: '1800',
      linkAmountManual: false,
    });
    expect(lastRevision(txn).changes).toMatchObject({
      linkAmount: ['1750', '1800'],
      linkAmountManual: [true, false],
    });
    const both = await patched(txn, { amount: '3000', linkAmount: '2600' });
    expect(both.countsFor).toMatchObject({
      linkAmount: '2600',
      linkAmountManual: true,
    });
  });

  it('saves a typed amount sent with another change, and logs it', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    const typed = await patched(txn, { linkAmount: '1750', note: 'Fitting' });
    expect(typed.countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });
    expect(lastRevision(txn).changes).toMatchObject({
      note: [null, 'Fitting'],
      linkAmount: ['1800', '1750'],
      linkAmountManual: [false, true],
      linkWish: { wishId: w, name: 'Winter tyres' },
    });
  });

  it('clears a typed amount and logs it when the account changes into the wish currency', async () => {
    const wise = await account('Wise $', 'USD');
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    await patched(txn, { linkAmount: '1750' });
    expect(linkRow(txn)).toMatchObject({ amount: 1750n, manual: 1n });

    const moved = await patched(txn, { accountId: joint }, blair);
    // Same currency as the wish: the amount is the expense's own.
    expect(moved.countsFor).toMatchObject({
      type: 'wish',
      id: w,
      linkAmount: '2000',
      linkAmountManual: false,
      linkCurrency: 'EUR',
    });
    expect(moved.countsFor).not.toHaveProperty('rate');
    expect(linkRow(txn)).toMatchObject({ amount: 2000n, manual: 0n });
    const revision = lastRevision(txn);
    expect(revision.changedBy).toBe(2);
    expect(revision.changes).toMatchObject({
      accountId: [wise, joint],
      linkAmount: ['1750', '2000'],
      linkAmountManual: [true, false],
      linkWish: { wishId: w, name: 'Winter tyres' },
    });
    expect((await wishRead(w)).spent).toBe('2000');
    // And a typed amount is refused there from now on.
    expect((await patch(txn, { linkAmount: '1500' })).statusCode).toBe(400);
  });

  it('logs a recomputed amount after a change of the expense amount', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    await patched(txn, { amount: '3000' });
    expect(lastRevision(txn).changes).toMatchObject({
      amount: ['2000', '3000'],
      linkAmount: ['1800', '2700'],
      linkWish: { wishId: w, name: 'Winter tyres' },
    });
    expect((await read(txn)).countsFor.linkAmount).toBe('2700');
  });

  it('can type an amount for a link that has no rate yet', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    const typed = await patched(txn, { linkAmount: '1750' });
    expect(typed.countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });
    expect(lastRevision(txn).changes).toMatchObject({
      linkAmount: [null, '1750'],
      linkAmountManual: [false, true],
    });
  });

  it('refuses a typed link amount that makes no sense', async () => {
    const wise = await account('Wise $', 'USD');
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const foreign = await expense(wise, { amount: '2000' });
    const home = await expense(joint, { amount: '2000' });
    const unlinked = await expense(wise, { amount: '2000' });
    await patched(foreign, { wishId: w });
    await patched(home, { wishId: w });

    for (const [id, linkAmount] of [
      [foreign, '-100'],
      [foreign, '0'],
      [home, '1500'],
      [unlinked, '1500'],
    ] as const) {
      const response = await patch(id, { linkAmount });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('validation');
    }
    expect((await read(foreign)).countsFor.linkAmount).toBe('1800');
    expect((await read(home)).countsFor.linkAmount).toBe('2000');
    // Not a number, or out of the 64-bit range.
    for (const linkAmount of ['1.5', 'abc', '9223372036854775808']) {
      expect((await patch(foreign, { linkAmount })).statusCode).toBe(400);
    }
    // A refund's typed amount is negative.
    const refund = await expense(wise, { amount: '-2000' });
    await patched(refund, { wishId: w });
    expect((await patch(refund, { linkAmount: '100' })).statusCode).toBe(400);
    expect(
      (await patched(refund, { linkAmount: '-1500' })).countsFor.linkAmount,
    ).toBe('-1500');
  });

  // --- 10 ----------------------------------------------------------------

  it('restores the links of a deleted wish that still qualify and lists the others', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const w2 = await wish({ name: 'Bike light' });
    const [kept, dated, boxed, taken, recorded, gone] = [
      await expense(joint, { merchant: 'A' }),
      await expense(joint, { merchant: 'B' }),
      await expense(joint, { merchant: 'C' }),
      await expense(joint, { merchant: 'D' }),
      await expense(joint, { merchant: 'E' }),
      await expense(joint, { merchant: 'F' }),
    ] as [number, number, number, number, number, number];
    for (const id of [kept, dated, boxed, taken, recorded, gone]) {
      await patched(id, { wishId: w });
    }
    // One made by "Record as expense", which no route does yet.
    database
      .prepare(
        `UPDATE plan_link SET made_how = 'recorded', made_by = NULL
         WHERE txn_id = ?`,
      )
      .run(recorded);
    expect((await call('DELETE', `/api/wishes/${w}`)).statusCode).toBe(204);

    await patched(dated, { date: '2026-09-20' });
    await patched(boxed, { envelopeId: groceries });
    await patched(taken, { wishId: w2 });
    expect((await call('DELETE', `/api/transactions/${gone}`)).statusCode).toBe(
      200,
    );
    now += 60_000;

    const restored = await call('POST', `/api/wishes/${w}/restore`, {}, blair);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().notRestored).toEqual([dated, boxed, taken]);
    expect(restored.json().wish).toMatchObject({
      id: w,
      spent: '4000',
      expenseCount: 2,
    });

    for (const id of [kept, recorded]) {
      expect((await read(id)).countsFor).toMatchObject({
        type: 'wish',
        id: w,
        linkAmount: '2000',
      });
      const revision = lastRevision(id);
      expect(revision).toMatchObject({ action: 'update', changedBy: 2 });
      expect(revision.changes.link).toEqual([null, tyres(w)]);
      expect(revision.changes).not.toHaveProperty('envelopeId');
    }
    expect((await read(dated)).countsFor).toEqual({ type: 'none' });
    expect((await read(boxed)).countsFor.type).toBe('envelope');
    expect((await read(taken)).countsFor).toMatchObject({ id: w2 });
    for (const id of [dated, boxed, taken]) {
      // The last revision is the user's change, not a reattach.
      expect(lastRevision(id).changedBy).toBe(1);
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS n FROM plan_link
             WHERE txn_id = ? AND wish_id = ? AND detached_at IS NOT NULL`,
          )
          .get(id, w),
      ).toEqual({ n: 1n });
    }
    // At most one active link per transaction held.
    for (const id of [kept, dated, boxed, taken, recorded]) {
      expect(activeLinks(id)).toBeLessThanOrEqual(1);
    }
  });

  it('restores nothing twice, and a wish with no links answers an empty list', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const empty = await wish({ name: 'Empty' });
    const txn = await expense(joint);
    await patched(txn, { wishId: w });
    await call('DELETE', `/api/wishes/${w}`);
    await call('DELETE', `/api/wishes/${empty}`);
    expect(
      (await call('POST', `/api/wishes/${empty}/restore`)).json().notRestored,
    ).toEqual([]);
    expect(
      (await call('POST', `/api/wishes/${w}/restore`)).json().notRestored,
    ).toEqual([]);
    const count = revisions(txn).length;
    const again = await call('POST', `/api/wishes/${w}/restore`);
    expect(again.statusCode).toBe(409);
    expect(revisions(txn)).toHaveLength(count);
    expect(activeLinks(txn)).toBe(1);
  });

  it('recomputes a reattached link from the expense as it is at restore', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint, { amount: '2000' });
    await patched(txn, { wishId: w });
    expect(linkRow(txn)).toMatchObject({ amount: 2000n });
    await call('DELETE', `/api/wishes/${w}`);
    // While the wish is deleted the expense is edited; nothing counts for it.
    const edited = await patched(txn, { amount: '3000' });
    expect(edited.countsFor).toEqual({ type: 'none' });
    now += 60_000;

    const restored = await call('POST', `/api/wishes/${w}/restore`, {}, blair);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().notRestored).toEqual([]);
    expect(linkRow(txn)).toMatchObject({ amount: 3000n, manual: 0n });
    expect((await read(txn)).countsFor).toMatchObject({
      type: 'wish',
      id: w,
      linkAmount: '3000',
      linkAmountManual: false,
    });
    expect(await wishRead(w)).toMatchObject({ spent: '3000', left: '45000' });
    const revision = lastRevision(txn);
    expect(revision).toMatchObject({ action: 'update', changedBy: 2 });
    expect(revision.changes.link).toEqual([null, tyres(w)]);
    expect(revision.changes.linkAmount).toEqual([null, '3000']);
  });

  it('clears a typed link amount at restore and converts the changed expense anew', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    await patched(txn, { linkAmount: '1750' });
    expect(linkRow(txn)).toMatchObject({ amount: 1750n, manual: 1n });
    await call('DELETE', `/api/wishes/${w}`);
    await patched(txn, { amount: '3000' });
    now += 60_000;

    const restored = await call('POST', `/api/wishes/${w}/restore`, {}, blair);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().notRestored).toEqual([]);
    // 3000 * 0.9: the typed 1750 does not survive the delete and restore.
    expect(linkRow(txn)).toMatchObject({ amount: 2700n, manual: 0n });
    expect((await read(txn)).countsFor).toMatchObject({
      linkAmount: '2700',
      linkAmountManual: false,
      rate: { from: 'USD', to: 'EUR', rate: '0.9' },
    });
    expect((await wishRead(w)).spent).toBe('2700');
    const revision = lastRevision(txn);
    expect(revision.changedBy).toBe(2);
    expect(revision.changes.link).toEqual([null, tyres(w)]);
    expect(revision.changes.linkAmount).toEqual([null, '2700']);
    // The restore logs the new link as computed, not as typed by hand.
    expect(revision.changes.linkAmountManual?.[1] ?? false).toBe(false);
  });

  it('leaves a restored link without an amount when its expense has no rate yet', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    await patched(txn, { linkAmount: '1750' });
    await call('DELETE', `/api/wishes/${w}`);
    // The rate of the expense's day is gone, so the stored typed amount
    // must not come back either.
    database.prepare('DELETE FROM rate').run();
    now += 60_000;
    const restored = await call('POST', `/api/wishes/${w}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(linkRow(txn)).toMatchObject({ amount: null, manual: 0n });
    expect(await wishRead(w)).toMatchObject({ spent: '0', incomplete: true });
  });

  it('reattaches only the links of the latest delete', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const first = await expense(joint, { merchant: 'First' });
    const second = await expense(joint, { merchant: 'Second' });
    await patched(first, { wishId: w });
    await call('DELETE', `/api/wishes/${w}`);
    now += 60_000;
    await call('POST', `/api/wishes/${w}/restore`);
    await patched(first, { wishId: null });
    await patched(second, { wishId: w });
    now += 60_000;
    await call('DELETE', `/api/wishes/${w}`);
    now += 60_000;
    const restored = await call('POST', `/api/wishes/${w}/restore`);
    expect(restored.json().notRestored).toEqual([]);
    expect(activeLinks(first)).toBe(0);
    expect(activeLinks(second)).toBe(1);
  });

  // --- 11 ----------------------------------------------------------------

  it('recomputes the links of a wish whose currency changes, clears typed amounts and logs each', async () => {
    const joint = await account('Joint', 'EUR');
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    rate('EUR', 'USD', '2026-10-01', '1.2');
    const euro = await expense(joint, { amount: '2000' });
    const typed = await expense(wise, { amount: '2000' });
    const dollars = await expense(wise, { amount: '1000' });
    await patched(euro, { wishId: w });
    await patched(typed, { wishId: w });
    await patched(typed, { linkAmount: '1750' });
    await patched(dollars, { wishId: w });

    const changed = await call(
      'PATCH',
      `/api/wishes/${w}`,
      { currency: 'USD' },
      blair,
    );
    expect(changed.statusCode, changed.body).toBe(200);
    // 2000 euro at 1.2, and the dollar expenses count as they are.
    expect(changed.json().wish).toMatchObject({
      currency: 'USD',
      spent: '5400',
    });
    expect((await read(euro)).countsFor).toMatchObject({
      linkAmount: '2400',
      linkCurrency: 'USD',
    });
    expect((await read(typed)).countsFor).toMatchObject({
      linkAmount: '2000',
      linkAmountManual: false,
    });
    expect(linkRow(typed)).toMatchObject({ manual: 0n });

    const euroRevision = lastRevision(euro);
    expect(euroRevision).toMatchObject({ action: 'update', changedBy: 2 });
    expect(euroRevision.changes).toMatchObject({
      linkAmount: ['2000', '2400'],
      linkWish: { wishId: w },
    });
    expect(lastRevision(typed).changes).toMatchObject({
      linkAmount: ['1750', '2000'],
      linkAmountManual: [true, false],
      linkWish: { wishId: w },
    });
    // The dollar expense's amount is the same in the new currency.
    expect(lastRevision(dollars).changes).toMatchObject({
      linkAmount: ['900', '1000'],
    });

    // Saving the same currency, or another field, recomputes nothing.
    // The typed expense is in the wish's new currency now, so type on the
    // euro one.
    await patched(euro, { linkAmount: '2500' });
    const count = revisions(euro).length;
    await call('PATCH', `/api/wishes/${w}`, { currency: 'USD', name: 'New' });
    await call('PATCH', `/api/wishes/${w}`, { note: 'x' });
    expect(revisions(euro)).toHaveLength(count);
    expect((await read(euro)).countsFor).toMatchObject({
      linkAmount: '2500',
      linkAmountManual: true,
    });
  });

  it('leaves the amounts null when the new currency has no rate, and asks for its rates', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint, { amount: '2000' });
    await patched(txn, { wishId: w });
    const changed = await call('PATCH', `/api/wishes/${w}`, {
      currency: 'GBP',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().wish).toMatchObject({ spent: '0', incomplete: true });
    expect((await read(txn)).countsFor).toMatchObject({
      linkAmount: null,
      linkCurrency: 'GBP',
    });
    expect(lastRevision(txn).changes).toMatchObject({
      linkAmount: ['2000', null],
    });
    await rates.idle();
    expect(
      fetch.mock.calls.some(([request]) =>
        request.currencies.some(({ code }) => code === 'GBP'),
      ),
    ).toBe(true);
    // A rate that arrives fills it.
    rate('EUR', 'GBP', '2026-10-01', '0.85');
    expect(fillPendingLinkAmounts(database)).toBe(1);
    expect((await read(txn)).countsFor.linkAmount).toBe('1700');
  });

  // --- 12 ----------------------------------------------------------------

  it('refuses a wish and an envelope together with 400 invalid', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const w = await wish();
    const txn = await expense(joint);
    const both = await patch(txn, { wishId: w, envelopeId: groceries });
    expect(both.statusCode, both.body).toBe(400);
    expect(both.json().error.code).toBe('invalid');
    expect(activeLinks(txn)).toBe(0);
    expect(part(txn).envelopeId).toBeNull();
    expect(revisions(txn)).toHaveLength(0);
    // One of them null is a plain choice.
    const wishOnly = await patch(txn, { wishId: w, envelopeId: null });
    expect(wishOnly.statusCode, wishOnly.body).toBe(200);
    const envelopeOnly = await patch(txn, {
      wishId: null,
      envelopeId: groceries,
    });
    expect(envelopeOnly.statusCode, envelopeOnly.body).toBe(200);
    expect(envelopeOnly.json().transaction.countsFor.type).toBe('envelope');
  });

  it('answers 409 wish_not_open for a dropped or deleted wish, and accepts a done one', async () => {
    const joint = await account('Joint', 'EUR');
    const dropped = await wish({ name: 'Dropped' });
    const deleted = await wish({ name: 'Deleted' });
    const done = await wish({ name: 'Done' });
    await call('PATCH', `/api/wishes/${dropped}`, { state: 'dropped' });
    await call('DELETE', `/api/wishes/${deleted}`);
    await call('PATCH', `/api/wishes/${done}`, { state: 'done' });
    const txn = await expense(joint);

    for (const id of [dropped, deleted]) {
      const response = await patch(txn, { wishId: id });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('wish_not_open');
    }
    expect(activeLinks(txn)).toBe(0);
    expect(revisions(txn)).toHaveLength(0);

    const linked = await patched(txn, { wishId: done });
    expect(linked.countsFor).toMatchObject({ type: 'wish', id: done });
    expect((await wishRead(done)).spent).toBe('2000');
    // A wish brought back is open again.
    await call('PATCH', `/api/wishes/${dropped}`, { state: 'open' });
    expect((await patched(txn, { wishId: dropped })).countsFor.id).toBe(
      dropped,
    );
  });

  it('keeps the link of a wish dropped later, and shows it', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const txn = await expense(joint);
    await patched(txn, { wishId: w });
    await call('PATCH', `/api/wishes/${w}`, { state: 'dropped' });
    expect((await read(txn)).countsFor).toMatchObject({ type: 'wish', id: w });
    expect((await wishRead(w)).spent).toBe('2000');
  });

  // --- 14 ----------------------------------------------------------------

  it('never fills an envelope into a linked expense when it is labelled from Needs a category', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    await call('PATCH', `/api/categories/${category('Groceries')}`, {
      defaultEnvelopeId: groceries,
    });
    const w = await wish();
    const linked = await expense(joint, { merchant: 'Edeka' });
    await patched(linked, { wishId: w });
    // The same expense without a link does get the default envelope.
    const bare = await expense(joint, { merchant: 'Rewe' });

    const labelled = await call('POST', '/api/transactions/label', {
      items: [
        { id: linked, categoryId: category('Groceries') },
        { id: bare, categoryId: category('Groceries') },
      ],
    });
    expect(labelled.statusCode, labelled.body).toBe(200);
    const [first, second] = labelled.json().labelled as Json[];
    expect(first).toMatchObject({
      id: linked,
      categoryId: category('Groceries'),
      filledEnvelopeId: null,
    });
    expect(second).toMatchObject({ id: bare, filledEnvelopeId: groceries });
    expect(part(linked)).toMatchObject({
      categoryId: BigInt(category('Groceries')),
      envelopeId: null,
      envelopeAmount: null,
    });
    expect((await read(linked)).countsFor).toMatchObject({
      type: 'wish',
      id: w,
    });
    expect(activeLinks(linked)).toBe(1);
    expect((await envelopeCurrent(groceries)).spent).toBe('2000');
    expect((await wishRead(w)).spent).toBe('2000');
  });

  it('creates a transaction with no link, and refuses a wish on the Add form', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const groceries = await envelope('Groceries');
    await call('PATCH', `/api/categories/${category('Groceries')}`, {
      defaultEnvelopeId: groceries,
    });
    const bare = await expense(joint);
    expect(activeLinks(bare)).toBe(0);
    expect((await read(bare)).countsFor).toEqual({ type: 'none' });
    // A category's default envelope fills on create, and then it counts there.
    const filled = await expense(joint, { categoryId: category('Groceries') });
    expect(activeLinks(filled)).toBe(0);
    expect((await read(filled)).countsFor).toMatchObject({
      type: 'envelope',
      id: groceries,
    });
    const response = await call('POST', '/api/transactions', {
      kind: 'expense',
      accountId: joint,
      amount: '1000',
      wishId: w,
    });
    expect(response.statusCode).toBe(400);
    expect(
      (
        database.prepare('SELECT COUNT(*) AS n FROM plan_link').get() as {
          n: bigint;
        }
      ).n,
    ).toBe(0n);
  });

  // --- 15 ----------------------------------------------------------------

  it('recomputes the non-typed link amounts of an account whose currency is relabelled (ACC-5)', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    rate('GBP', 'EUR', '2026-10-01', '1.2');
    const converted = await expense(wise, { amount: '2000' });
    const typed = await expense(wise, { amount: '2000', date: '2026-10-04' });
    await patched(converted, { wishId: w });
    await patched(typed, { wishId: w });
    await patched(typed, { linkAmount: '1750' });
    expect((await wishRead(w)).spent).toBe('3550');

    const relabelled = await call('POST', `/api/accounts/${wise}/currency`, {
      currency: 'GBP',
      confirm: true,
    });
    expect(relabelled.statusCode, relabelled.body).toBe(200);
    expect((await read(converted)).countsFor).toMatchObject({
      linkAmount: '2400',
      linkAmountManual: false,
    });
    expect((await read(typed)).countsFor).toMatchObject({
      linkAmount: '1750',
      linkAmountManual: true,
    });
    expect((await wishRead(w)).spent).toBe('4150');

    // Relabelling to the wish's own currency makes the amounts equal.
    const euro = await call('POST', `/api/accounts/${wise}/currency`, {
      currency: 'EUR',
      confirm: true,
    });
    expect(euro.statusCode, euro.body).toBe(200);
    expect((await read(converted)).countsFor.linkAmount).toBe('2000');
    expect((await read(typed)).countsFor.linkAmount).toBe('1750');
  });

  it('leaves a link amount null when the relabelled currency has no rate yet', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('USD', 'EUR', '2026-10-01', '0.9');
    const txn = await expense(wise, { amount: '2000' });
    await patched(txn, { wishId: w });
    const relabelled = await call('POST', `/api/accounts/${wise}/currency`, {
      currency: 'CHF',
      confirm: true,
    });
    expect(relabelled.statusCode, relabelled.body).toBe(200);
    expect((await read(txn)).countsFor.linkAmount).toBeNull();
    rate('CHF', 'EUR', '2026-10-01', '1.05');
    expect(fillPendingLinkAmounts(database)).toBe(1);
    expect((await read(txn)).countsFor.linkAmount).toBe('2100');
  });

  // --- access ------------------------------------------------------------

  it('refuses a link change without a session', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/transactions/1',
      headers: jsonHeaders,
      payload: { wishId: 1 },
    });
    expect(response.statusCode).toBe(401);
  });
});

/** Every day from `from` to `to`, counted without the code under test. */
function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let time = Date.parse(`${from}T00:00:00Z`);
    time <= Date.parse(`${to}T00:00:00Z`);
    time += 86_400_000
  ) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
