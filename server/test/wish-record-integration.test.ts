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
 * Record a wish as an expense (spec 3a, TASK-42): Design 3 (the amounts),
 * Design 4 (record and unrecord), Design 5 (Undo), Design 6 (the history
 * line) and O9.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** A parsed JSON answer, read loosely by the tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('recording a wish as an expense', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;
  let blair: string;
  let rates: RatesService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-wish-record-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    now = Date.parse('2026-10-15T10:00:00.000Z');
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

  /** A wish of October 2026 in euros, in Transport, unless told otherwise. */
  async function wish(
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/wishes', {
      month: '2026-10',
      name: 'Winter tyres',
      amount: '48000',
      currency: 'EUR',
      categoryId: category('Transport'),
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

  function record(id: number, body: Record<string, unknown>, cookie = alex) {
    return call(
      'POST',
      `/api/wishes/${id}/record`,
      { keepOpen: false, clientId: randomUUID(), ...body },
      cookie,
    );
  }

  /** A record that must succeed; answers the whole body. */
  async function recorded(
    id: number,
    body: Record<string, unknown>,
    cookie = alex,
  ): Promise<Json> {
    const response = await record(id, body, cookie);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }

  function unrecord(id: number, body: Record<string, unknown>, cookie = alex) {
    return call('POST', `/api/wishes/${id}/unrecord`, body, cookie);
  }

  async function read(id: number): Promise<{
    transaction: Json;
    revisions: Json[];
  }> {
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

  function count(table: string): number {
    return Number(
      (
        database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: bigint;
        }
      ).n,
    );
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

  // --- 2, 3 and 8: the amount, the expense and the link ------------------

  it('records the wish’s amount as a confirmed expense with its category, name, today and no envelope', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const answer = await recorded(w, { accountId: joint, amount: '48000' });

    expect(answer.transaction).toMatchObject({
      kind: 'expense',
      status: 'confirmed',
      date: '2026-10-15',
      accountId: joint,
      currency: 'EUR',
      amount: '48000',
      note: 'Winter tyres',
      merchant: null,
      categoryId: category('Transport'),
      envelopeId: null,
      envelopeAmount: null,
      createdBy: 1,
      countsFor: {
        type: 'wish',
        id: w,
        name: 'Winter tyres',
        linkAmount: '48000',
        linkAmountManual: false,
        madeHow: 'recorded',
        madeBy: 1,
      },
    });
    expect(answer.previousState).toBe('open');
    // Keep open off: the wish is done, with the spending on it.
    expect(answer.wish).toMatchObject({
      state: 'done',
      spent: '48000',
      left: '0',
      expenseCount: 1,
    });
    expect(linkRow(answer.transaction.id)).toMatchObject({
      amount: 48000n,
      manual: 0n,
      month: '2026-10',
      madeHow: 'recorded',
      madeBy: 1n,
    });
    // The wish's page lists it as recorded from the wish.
    expect((await wishRead(w)).expenses[0]).toMatchObject({
      transactionId: answer.transaction.id,
      madeHow: 'recorded',
      madeBy: 'Alex',
      linkAmount: '48000',
    });
  });

  it('keeps the wish open when asked to, and keeps a done wish done', async () => {
    const joint = await account('Joint', 'EUR');
    const open = await wish();
    const kept = await recorded(open, {
      accountId: joint,
      amount: '10000',
      keepOpen: true,
    });
    expect(kept.previousState).toBe('open');
    expect(kept.wish).toMatchObject({ state: 'open', spent: '10000' });

    // A done wish stays done and Undo would give back "done".
    const done = await wish({ name: 'Done wish' });
    await call('PATCH', `/api/wishes/${done}`, { state: 'done' });
    const again = await recorded(done, { accountId: joint, amount: '500' });
    expect(again.previousState).toBe('done');
    expect(again.wish.state).toBe('done');
  });

  it('uses the wish’s category even when it has a default envelope, and takes no envelope', async () => {
    const joint = await account('Joint', 'EUR');
    const groceries = await envelope('Groceries');
    const patched = await call(
      'PATCH',
      `/api/categories/${category('Transport')}`,
      { defaultEnvelopeId: groceries },
    );
    expect(patched.statusCode, patched.body).toBe(200);
    const w = await wish();
    const answer = await recorded(w, { accountId: joint, amount: '48000' });
    expect(answer.transaction).toMatchObject({
      categoryId: category('Transport'),
      envelopeId: null,
      envelopeAmount: null,
    });
    const current = await call('GET', `/api/envelopes/${groceries}`);
    expect(current.json().envelope.current.spent).toBe('0');
    expect(
      database.prepare('SELECT envelope_id AS e FROM txn_part').get(),
    ).toEqual({ e: null });
  });

  it('takes the merchant, date and category the sheet sent, and has no category for a wish with none', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish({ categoryId: null });
    const none = await recorded(w, {
      accountId: joint,
      amount: '1000',
      keepOpen: true,
    });
    expect(none.transaction.categoryId).toBeNull();

    const sent = await recorded(w, {
      accountId: joint,
      amount: '2000',
      keepOpen: true,
      merchant: '  Tyre shop ',
      date: '2026-10-03',
      categoryId: category('Shopping'),
    });
    expect(sent.transaction).toMatchObject({
      merchant: 'Tyre shop',
      date: '2026-10-03',
      categoryId: category('Shopping'),
      note: 'Winter tyres',
    });
    expect(sent.wish.spent).toBe('3000');
  });

  it('refuses a date outside the wish’s month with 400 on date and creates nothing', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    // Before the month and a year back: only the month rule applies.
    for (const date of ['2026-09-30', '2025-10-15']) {
      const response = await record(w, {
        accountId: joint,
        amount: '1000',
        date,
      });
      expect(response.statusCode, `${date}: ${response.body}`).toBe(400);
      const error = response.json().error;
      expect(error.code).toBe('invalid');
      expect(error.fields.date).toBe('Choose a date in the wish’s month.');
    }
    // After the month (and after today): refused too, on the same field.
    const later = await record(w, {
      accountId: joint,
      amount: '1000',
      date: '2026-11-01',
    });
    expect(later.statusCode, later.body).toBe(400);
    expect(later.json().error.fields.date).toBeTruthy();
    expect(count('txn')).toBe(0);
    expect(count('txn_part')).toBe(0);
    expect(count('plan_link')).toBe(0);
    expect(count('txn_revision')).toBe(0);
    expect(await wishRead(w)).toMatchObject({ state: 'open', spent: '0' });

    // The first day of the month is inside it.
    const first = await recorded(w, {
      accountId: joint,
      amount: '1000',
      keepOpen: true,
      date: '2026-10-01',
    });
    expect(first.transaction.date).toBe('2026-10-01');
    expect(count('txn')).toBe(1);
  });

  it('records a wish of an earlier month with a date in its month, and refuses today for it', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish({ month: '2026-08', name: 'August trip' });
    // No date: today is 15 October, outside August.
    const noDate = await record(w, { accountId: joint, amount: '1000' });
    expect(noDate.statusCode, noDate.body).toBe(400);
    expect(noDate.json().error.fields.date).toBe(
      'Choose a date in the wish’s month.',
    );
    expect(count('txn')).toBe(0);

    const answer = await recorded(w, {
      accountId: joint,
      amount: '48000',
      date: '2026-08-31',
    });
    expect(answer.transaction).toMatchObject({
      date: '2026-08-31',
      note: 'August trip',
      countsFor: { type: 'wish', id: w, linkAmount: '48000' },
    });
    expect(linkRow(answer.transaction.id)).toMatchObject({
      amount: 48000n,
      month: '2026-08',
      madeHow: 'recorded',
    });
    expect(answer.wish).toMatchObject({ state: 'done', spent: '48000' });
    expect(count('txn')).toBe(1);
  });

  it('records a wish whose category was archived when no categoryId is sent, and refuses an archived one that is sent', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const archived = await call(
      'PATCH',
      `/api/categories/${category('Transport')}`,
      { archived: true },
    );
    expect(archived.statusCode, archived.body).toBe(200);

    // The sheet sends no categoryId when the member left it at the wish's.
    const answer = await recorded(w, {
      accountId: joint,
      amount: '48000',
      keepOpen: true,
    });
    expect(answer.transaction.categoryId).toBe(category('Transport'));
    expect(answer.wish).toMatchObject({ spent: '48000' });

    // Choosing the archived category anew is still refused.
    const chosen = await record(w, {
      accountId: joint,
      amount: '1000',
      keepOpen: true,
      categoryId: category('Transport'),
    });
    expect(chosen.statusCode, chosen.body).toBe(400);
    expect(chosen.json().error.code).toBe('invalid');
    expect(count('txn')).toBe(1);
  });

  it('counts what is left: a second record of the rest finishes the wish', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    await recorded(w, { accountId: joint, amount: '18000', keepOpen: true });
    const rest = await recorded(w, { accountId: joint, amount: '30000' });
    expect(rest.wish).toMatchObject({
      state: 'done',
      spent: '48000',
      left: '0',
      expenseCount: 2,
    });
  });

  it('refuses a bad body with 400 and writes nothing', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const bad: Array<Record<string, unknown>> = [
      { accountId: joint, amount: '0' },
      { accountId: joint, amount: '-100' },
      { accountId: joint, amount: '12.5' },
      { accountId: 9999, amount: '1000' },
      { accountId: joint, amount: '1000', date: '2030-01-01' },
      { accountId: joint, amount: '1000', categoryId: 9999 },
      { accountId: joint, amount: '1000', envelopeId: 1 },
      { accountId: joint, amount: '1000', clientId: 'nope' },
    ];
    for (const body of bad) {
      const response = await record(w, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('invalid');
    }
    expect(count('txn')).toBe(0);
    expect(count('plan_link')).toBe(0);
    expect((await wishRead(w)).state).toBe('open');
  });

  it('answers 404 to a missing or deleted wish and needs a session', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    expect(
      (await record(9999, { accountId: joint, amount: '1000' })).statusCode,
    ).toBe(404);
    await call('DELETE', `/api/wishes/${w}`);
    expect(
      (await record(w, { accountId: joint, amount: '1000' })).statusCode,
    ).toBe(404);
    const anonymous = await app.inject({
      method: 'POST',
      url: `/api/wishes/${w}/record`,
      headers: jsonHeaders,
      payload: {
        accountId: joint,
        amount: '1000',
        keepOpen: false,
        clientId: randomUUID(),
      },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(count('txn')).toBe(0);
  });

  // --- 10: a dropped wish -----------------------------------------------

  it('does not record a dropped wish: 409 wish_not_open and nothing saved', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    await call('PATCH', `/api/wishes/${w}`, { state: 'dropped' });
    const response = await record(w, { accountId: joint, amount: '1000' });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('wish_not_open');
    expect(count('txn')).toBe(0);
    expect(count('plan_link')).toBe(0);
    expect((await wishRead(w)).state).toBe('dropped');
  });

  // --- 4: another currency ----------------------------------------------

  it('saves the expense in the account’s currency and the link in the wish’s, at the amount the sheet showed', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('EUR', 'USD', '2026-10-14', '1.093');
    // The sheet showed €480.00 as 480 * 1.093 = $524.64.
    const answer = await recorded(w, { accountId: wise, amount: '52464' });
    expect(answer.transaction).toMatchObject({
      currency: 'USD',
      amount: '52464',
      envelopeId: null,
      countsFor: { type: 'wish', linkAmount: '48000', linkCurrency: 'EUR' },
    });
    expect(answer.wish).toMatchObject({
      spent: '48000',
      left: '0',
      state: 'done',
      incomplete: false,
    });
    expect(linkRow(answer.transaction.id)).toMatchObject({
      amount: 48000n,
      manual: 0n,
    });
  });

  it('converts the amount anew when the member typed another one', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('EUR', 'USD', '2026-10-14', '1.093');
    const answer = await recorded(w, {
      accountId: wise,
      amount: '50000',
      keepOpen: true,
    });
    expect(answer.transaction.amount).toBe('50000');
    // $500.00 at 1 / 1.093 is €457.46, not the €480.00 of the wish.
    const linked = BigInt(answer.transaction.countsFor.linkAmount);
    expect(linked).toBeGreaterThan(45700n);
    expect(linked).toBeLessThan(45800n);
    expect(linked).not.toBe(48000n);
  });

  it('shows what is left as the amount to count when the wish was part spent', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    rate('EUR', 'USD', '2026-10-14', '1.093');
    await recorded(w, {
      accountId: wise,
      amount: '10930',
      keepOpen: true,
    });
    expect((await wishRead(w)).left).toBe('38000');
    // What is left, €380.00, shown as $415.34.
    const rest = await recorded(w, { accountId: wise, amount: '41534' });
    expect(rest.transaction.countsFor.linkAmount).toBe('38000');
    expect(rest.wish).toMatchObject({
      spent: '48000',
      left: '0',
      state: 'done',
    });
  });

  // --- 9: idempotence and a missing rate --------------------------------

  it('saves once for a clientId, and answers 200 to the same retry', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const body = {
      accountId: joint,
      amount: '48000',
      clientId: randomUUID(),
    };
    const first = await record(w, body);
    expect(first.statusCode, first.body).toBe(201);
    const second = await record(w, body);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().transaction.id).toBe(first.json().transaction.id);
    expect(second.json().wish).toMatchObject({ state: 'done', spent: '48000' });
    expect(count('txn')).toBe(1);
    expect(count('plan_link')).toBe(1);
    expect(
      (await read(first.json().transaction.id)).revisions.filter(
        (revision) => revision.action === 'update',
      ),
    ).toHaveLength(1);
  });

  it('answers 409 when the same clientId comes with another body, and after the expense was deleted', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const clientId = randomUUID();
    const first = await record(w, {
      accountId: joint,
      amount: '1000',
      keepOpen: true,
      clientId,
    });
    expect(first.statusCode).toBe(201);
    const changed = await record(w, {
      accountId: joint,
      amount: '2000',
      keepOpen: true,
      clientId,
    });
    expect(changed.statusCode, changed.body).toBe(409);
    expect(changed.json().error.code).toBe('conflict');
    expect(count('txn')).toBe(1);

    const deleted = await call(
      'DELETE',
      `/api/transactions/${first.json().transaction.id}`,
    );
    expect(deleted.statusCode, deleted.body).toBe(200);
    const again = await record(w, {
      accountId: joint,
      amount: '1000',
      keepOpen: true,
      clientId,
    });
    expect(again.statusCode, again.body).toBe(409);
    expect(count('txn')).toBe(0);
  });

  it('saves the link with a null amount while no rate exists, and fills it once one arrives', async () => {
    const wise = await account('Wise $', 'USD');
    const w = await wish();
    const answer = await recorded(w, {
      accountId: wise,
      amount: '52464',
      keepOpen: true,
    });
    const id = answer.transaction.id;
    expect(answer.transaction.countsFor).toMatchObject({
      type: 'wish',
      linkAmount: null,
      linkAmountManual: false,
    });
    expect(answer.wish).toMatchObject({ spent: '0', incomplete: true });
    expect(linkRow(id)?.amount).toBeNull();

    rate('EUR', 'USD', '2026-10-14', '1.093');
    expect(fillPendingLinkAmounts(database)).toBe(1);
    expect((await read(id)).transaction.countsFor.linkAmount).toBe('48000');
    expect(await wishRead(w)).toMatchObject({
      spent: '48000',
      incomplete: false,
    });
  });

  // --- 6: history --------------------------------------------------------

  it('writes one history entry that says it was recorded from the wish, by whom', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const answer = await recorded(
      w,
      { accountId: joint, amount: '48000' },
      blair,
    );
    const { revisions } = await read(answer.transaction.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      action: 'update',
      changedBy: 2,
      changes: {
        link: [
          null,
          {
            kind: 'wish',
            wishId: w,
            name: 'Winter tyres',
            madeHow: 'recorded',
          },
        ],
      },
    });
    expect(answer.transaction.createdBy).toBe(2);
    expect(answer.transaction.countsFor).toMatchObject({
      madeBy: 2,
      madeHow: 'recorded',
    });
  });

  // --- 8 and 10: unrecord ------------------------------------------------

  it('takes a recording back: the expense and its link go, with a delete revision, and the wish gets its state back', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const answer = await recorded(w, { accountId: joint, amount: '48000' });
    const id = answer.transaction.id;
    expect((await wishRead(w)).state).toBe('done');

    const response = await unrecord(w, {
      transactionId: id,
      state: answer.previousState,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().wish).toMatchObject({
      id: w,
      state: 'open',
      spent: '0',
      left: '48000',
      expenseCount: 0,
    });
    expect(count('txn')).toBe(0);
    expect(count('plan_link')).toBe(0);
    expect(count('txn_part')).toBe(0);
    const deleted = database
      .prepare(
        `SELECT action, changes FROM txn_revision
         WHERE txn_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(id) as { action: string; changes: string };
    expect(deleted.action).toBe('delete');
    expect(JSON.parse(deleted.changes)).toMatchObject({
      amount: ['48000', null],
    });
    // The account balance has no trace of it.
    const accountNow = await call('GET', `/api/accounts/${joint}`);
    expect(accountNow.statusCode, accountNow.body).toBe(200);
  });

  it('gives back a wish that was open and kept open, and one that was done', async () => {
    const joint = await account('Joint', 'EUR');
    const open = await wish();
    const kept = await recorded(open, {
      accountId: joint,
      amount: '1000',
      keepOpen: true,
    });
    const undone = await unrecord(open, {
      transactionId: kept.transaction.id,
      state: kept.previousState,
    });
    expect(undone.json().wish).toMatchObject({ state: 'open', spent: '0' });

    const done = await wish({ name: 'Done wish' });
    await call('PATCH', `/api/wishes/${done}`, { state: 'done' });
    const again = await recorded(done, { accountId: joint, amount: '500' });
    const back = await unrecord(done, {
      transactionId: again.transaction.id,
      state: again.previousState,
    });
    expect(back.json().wish).toMatchObject({ state: 'done', spent: '0' });
  });

  it('answers 409 changed when the expense is no longer linked to the wish as recorded', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const other = await wish({ name: 'Bike' });
    const answer = await recorded(w, { accountId: joint, amount: '48000' });
    const id = answer.transaction.id;
    const body = { transactionId: id, state: 'open' };

    // Moved to another wish by a member.
    const moved = await call('PATCH', `/api/transactions/${id}`, {
      wishId: other,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    for (const target of [w, other]) {
      const response = await unrecord(target, body);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('changed');
    }
    expect(count('txn')).toBe(1);

    // Unlinked altogether.
    await call('PATCH', `/api/transactions/${id}`, { wishId: null });
    expect((await unrecord(w, body)).statusCode).toBe(409);
    // A link a member made is not a recording.
    await call('PATCH', `/api/transactions/${id}`, { wishId: w });
    expect(linkRow(id)?.madeHow).toBe('member');
    expect((await unrecord(w, body)).statusCode).toBe(409);
    // An expense that is gone.
    expect(
      (await unrecord(w, { transactionId: 9999, state: 'open' })).statusCode,
    ).toBe(409);
    expect(count('txn')).toBe(1);
    expect((await wishRead(w)).state).toBe('done');
  });

  it('answers 409 changed to a second Undo and 404 for a deleted wish', async () => {
    const joint = await account('Joint', 'EUR');
    const w = await wish();
    const answer = await recorded(w, { accountId: joint, amount: '48000' });
    const body = { transactionId: answer.transaction.id, state: 'open' };
    expect((await unrecord(w, body)).statusCode).toBe(200);
    const second = await unrecord(w, body);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('changed');

    const gone = await wish({ name: 'Gone' });
    const made = await recorded(gone, { accountId: joint, amount: '500' });
    await call('DELETE', `/api/wishes/${gone}`);
    expect(
      (
        await unrecord(gone, {
          transactionId: made.transaction.id,
          state: 'open',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await unrecord(w, { transactionId: 'x', state: 'open' })).statusCode,
    ).toBe(400);
    expect(
      (await unrecord(w, { transactionId: 1, state: 'bogus' })).statusCode,
    ).toBe(400);
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
