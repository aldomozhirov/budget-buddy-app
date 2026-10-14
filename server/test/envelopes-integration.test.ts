import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { topUpEnvelopes } from '../src/domain/envelopes.js';

/** The envelope routes of spec 2 task 3 (ENV-1, ENV-3 to ENV-5, ENV-7). */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

describe('envelopes API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-envelopes-'));
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
      migrationsFolder,
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
    stayOpen();
  });

  /** Tests move the clock by days; do not lock the sessions meanwhile. */
  function stayOpen() {
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
  }

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
      // Unsafe requests carry a JSON body, an empty one for a delete.
      ...(method === 'GET' ? {} : { payload: payload ?? {} }),
    });
  }

  /** Creates an envelope and returns its id. */
  async function create(
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const response = await call('POST', '/api/envelopes', {
      name: 'Groceries',
      currency: 'EUR',
      monthlyAmount: '40000',
      mode: 'carry_over',
      startingBalance: '18760',
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().envelope.id;
  }

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
    stayOpen();
    return cookie;
  }

  /** Adds a confirmed expense with one part in an envelope, directly. */
  function expense(input: {
    envelopeId: number;
    date: string;
    amount: bigint;
    envelopeAmount?: bigint | null;
  }): void {
    const account =
      (database.prepare('SELECT id FROM account LIMIT 1').get() as
        { id: bigint } | undefined) ??
      database
        .prepare(
          `INSERT INTO account (name, type, currency, created_by, created_at,
             updated_by, updated_at) VALUES ('Joint', 'bank', 'EUR', 1, 1, 1, 1)`,
        )
        .run();
    const accountId =
      'id' in account ? account.id : BigInt(account.lastInsertRowid);
    const txn = database
      .prepare(
        `INSERT INTO txn (kind, date, account_id, amount, merchant, member_id,
           created_by, created_at, updated_by, updated_at)
         VALUES ('expense', ?, ?, ?, 'REWE', 1, 1, 1, 1, 1)`,
      )
      .run(input.date, accountId, input.amount);
    database
      .prepare(
        `INSERT INTO txn_part (txn_id, position, amount, envelope_id,
           envelope_amount) VALUES (?, 1, ?, ?, ?)`,
      )
      .run(
        txn.lastInsertRowid,
        input.amount,
        input.envelopeId,
        input.envelopeAmount === undefined
          ? input.amount
          : input.envelopeAmount,
      );
  }

  const count = (table: string, where = '1 = 1') =>
    Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
          .get() as { n: bigint }
      ).n,
    );

  it('creates an envelope with its first plan and reads it back with this month', async () => {
    const created = await call('POST', '/api/envelopes', {
      name: 'Groceries',
      currency: 'eur',
      monthlyAmount: '40000',
      mode: 'carry_over',
      startingBalance: '18760',
    });
    expect(created.statusCode).toBe(201);
    const envelope = created.json().envelope;
    expect(envelope).toMatchObject({
      name: 'Groceries',
      currency: 'EUR',
      startingBalance: '18760',
      startingMonth: '2026-10',
      archived: false,
      plan: {
        fromMonth: '2026-10',
        monthlyAmount: '40000',
        mode: 'carry_over',
      },
      pendingPlan: null,
      overspent: false,
      used: false,
      createdBy: 1,
      updatedBy: 1,
    });
    // O3: the starting balance is this month's balance; no top-up yet.
    expect(envelope.current).toMatchObject({
      month: '2026-10',
      opening: '18760',
      topUp: '0',
      spent: '0',
      closing: '18760',
      closed: false,
    });
    expect(
      database.prepare('SELECT topup_from_month AS m FROM envelope').get(),
    ).toEqual({ m: '2026-11' });

    const second = await create({ name: 'Fun', startingBalance: undefined });
    const list = (await call('GET', '/api/envelopes')).json().envelopes;
    expect(list.map((e: { name: string }) => e.name)).toEqual([
      'Groceries',
      'Fun',
    ]);
    expect(list[1].position).toBe(2);
    expect(list[1].current.closing).toBe('0');

    const detail = await call('GET', `/api/envelopes/${second}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      envelope: { id: second, name: 'Fun' },
      month: { month: '2026-10', closing: '0' },
      expenses: [],
      adjustments: [],
    });
    expect((await call('GET', '/api/envelopes/999')).statusCode).toBe(404);
  });

  it('shows the expenses and adjustments charged in a month, and the overspent mark', async () => {
    const id = await create({ startingBalance: '10000' });
    expense({ envelopeId: id, date: '2026-10-03', amount: 12000n });
    expense({
      envelopeId: id,
      date: '2026-10-04',
      amount: 500n,
      envelopeAmount: null,
    });
    // A part dated before the first month counts in it (O3).
    expense({ envelopeId: id, date: '2026-09-28', amount: 100n });
    await call('POST', `/api/envelopes/${id}/adjustments`, {
      amount: '-300',
      note: 'Cash in the jar',
    });
    const detail = (await call('GET', `/api/envelopes/${id}`)).json();
    expect(detail.envelope).toMatchObject({ overspent: true, used: true });
    expect(detail.month).toMatchObject({
      spent: '12100',
      adjustments: '-300',
      closing: '-2400',
      incomplete: true,
    });
    expect(
      detail.expenses.map(
        (e: { date: string; envelopeAmount: string | null }) => [
          e.date,
          e.envelopeAmount,
        ],
      ),
    ).toEqual([
      ['2026-10-04', null],
      ['2026-10-03', '12000'],
      ['2026-09-28', '100'],
    ]);
    expect(detail.expenses[0]).toMatchObject({
      merchant: 'REWE',
      accountCurrency: 'EUR',
      amount: '500',
      memberId: 1,
    });
    expect(detail.adjustments).toMatchObject([
      { amount: '-300', note: 'Cash in the jar', moveId: null },
    ]);

    const outside = await call('GET', `/api/envelopes/${id}?month=2026-09`);
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.fields.month).toBeDefined();
    expect(
      (await call('GET', `/api/envelopes/${id}?month=2026-11`)).statusCode,
    ).toBe(400);
    expect(
      (await call('GET', `/api/envelopes/${id}?month=2026-13`)).statusCode,
    ).toBe(400);
  });

  it('refuses a name clash in another case, also when renaming', async () => {
    await create({ name: 'Bäckerei' });
    const clash = await call('POST', '/api/envelopes', {
      name: 'BÄCKEREI',
      currency: 'EUR',
      monthlyAmount: '100',
      mode: 'reset',
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toMatchObject({
      code: 'conflict',
      fields: { name: expect.any(String) },
    });
    const other = await create({ name: 'Fun' });
    const rename = await call('PATCH', `/api/envelopes/${other}`, {
      name: 'bäckerei',
    });
    expect(rename.statusCode).toBe(409);
    // Its own name in another case is a rename, not a clash.
    const own = await call('PATCH', `/api/envelopes/${other}`, { name: 'FUN' });
    expect(own.statusCode).toBe(200);
    expect(own.json().envelope.name).toBe('FUN');
    expect(count('envelope')).toBe(2);
  });

  it('validates every input', async () => {
    const post = (payload: object) => call('POST', '/api/envelopes', payload);
    const valid = {
      name: 'Fun',
      currency: 'EUR',
      monthlyAmount: '100',
      mode: 'reset',
    };
    for (const [label, payload] of [
      ['decimal point', { ...valid, monthlyAmount: '12.5' }],
      ['negative monthly amount', { ...valid, monthlyAmount: '-100' }],
      [
        'above the 64-bit range',
        { ...valid, startingBalance: '9223372036854775808' },
      ],
      ['blank name', { ...valid, name: '   ' }],
      ['unknown mode', { ...valid, mode: 'keep' }],
      ['unknown field', { ...valid, color: 'red' }],
      ['unknown currency', { ...valid, currency: 'ZZZ9' }],
      ['missing category', { ...valid, defaultCategoryId: 999 }],
    ] as const) {
      const response = await post(payload);
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error.code, label).toBe('validation');
    }
    // An income category cannot be an envelope's default category.
    database
      .prepare(
        `INSERT INTO category (name, kind, position, created_at, updated_at)
         VALUES ('Pay', 'income', 99, 1, 1)`,
      )
      .run();
    const incomeId = (
      database.prepare("SELECT id FROM category WHERE name = 'Pay'").get() as {
        id: bigint;
      }
    ).id;
    const income = await post({
      ...valid,
      defaultCategoryId: Number(incomeId),
    });
    expect(income.statusCode).toBe(400);
    expect(income.json().error.fields.defaultCategoryId).toBeDefined();
    const empty = await call('PATCH', '/api/envelopes/1', {});
    expect(empty.statusCode).toBe(400);
    expect(count('envelope')).toBe(0);
  });

  it('keeps amounts above 2^53 exact', async () => {
    const big = '9007199254740993';
    const id = await create({ startingBalance: big, monthlyAmount: big });
    const { envelope } = (await call('GET', `/api/envelopes/${id}`)).json();
    expect(envelope.startingBalance).toBe(big);
    expect(envelope.plan.monthlyAmount).toBe(big);
    expect(envelope.current.closing).toBe(big);
  });

  it('takes a default category that is an active expense category', async () => {
    const category = Number(
      (
        database
          .prepare("SELECT id FROM category WHERE kind = 'expense' LIMIT 1")
          .get() as { id: bigint }
      ).id,
    );
    const id = await create({ defaultCategoryId: category });
    const patched = await call('PATCH', `/api/envelopes/${id}`, {
      defaultCategoryId: null,
    });
    expect(patched.json().envelope.defaultCategoryId).toBeNull();
    const set = await call('PATCH', `/api/envelopes/${id}`, {
      defaultCategoryId: category,
    });
    expect(set.json().envelope.defaultCategoryId).toBe(category);
    database
      .prepare('UPDATE category SET archived_at = 1 WHERE id = ?')
      .run(category);
    expect(
      (
        await call('PATCH', `/api/envelopes/${id}`, {
          defaultCategoryId: category,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('changes the currency while unused and relabels the amounts', async () => {
    const id = await create();
    const unconfirmed = await call('PATCH', `/api/envelopes/${id}`, {
      currency: 'JPY',
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json().error.fields.confirm).toBeDefined();
    expect(
      (await call('GET', `/api/envelopes/${id}`)).json().envelope.currency,
    ).toBe('EUR');

    const changed = await call('PATCH', `/api/envelopes/${id}`, {
      currency: 'JPY',
      confirm: true,
    });
    expect(changed.statusCode).toBe(200);
    // 187.60 and 400.00 relabelled to whole yen, rounded half away from zero.
    expect(changed.json().envelope).toMatchObject({
      currency: 'JPY',
      startingBalance: '188',
      plan: { monthlyAmount: '400' },
      current: { closing: '188' },
    });

    const unknown = await call('PATCH', `/api/envelopes/${id}`, {
      currency: 'ZZZ9',
      confirm: true,
    });
    expect(unknown.statusCode).toBe(400);
    // The same currency again is no change and needs no confirmation.
    const same = await call('PATCH', `/api/envelopes/${id}`, {
      currency: 'JPY',
    });
    expect(same.statusCode).toBe(200);
  });

  it('leaves every amount and the currency alone when a relabel overflows', async () => {
    // JPY has no decimals and BHD three: 10^17 yen would be 10^20 fils.
    const id = await create({
      currency: 'JPY',
      startingBalance: '100',
      monthlyAmount: '100000000000000000',
    });
    const refused = await call('PATCH', `/api/envelopes/${id}`, {
      currency: 'BHD',
      confirm: true,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.fields.currency).toBeDefined();
    expect(
      database
        .prepare(
          `SELECT e.currency, e.starting_balance AS balance,
             p.monthly_amount AS plan
           FROM envelope e JOIN envelope_plan p ON p.envelope_id = e.id`,
        )
        .get(),
    ).toEqual({ currency: 'JPY', balance: 100n, plan: 100000000000000000n });
  });

  it('relabels the top-ups made so far with the rest of an unused envelope', async () => {
    const id = await create();
    now = Date.parse('2026-11-02T10:00:00.000Z');
    topUpEnvelopes(database, '2026-11', now);
    const changed = await call('PATCH', `/api/envelopes/${id}`, {
      currency: 'JPY',
      confirm: true,
    });
    expect(changed.json().envelope.current).toMatchObject({
      topUp: '400',
      closing: '588',
    });
  });

  it('refuses a currency change once an expense or an adjustment exists', async () => {
    const withExpense = await create({ name: 'A' });
    expense({ envelopeId: withExpense, date: '2026-10-02', amount: 100n });
    const refused = await call('PATCH', `/api/envelopes/${withExpense}`, {
      currency: 'USD',
      confirm: true,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('conflict');

    const withAdjustment = await create({ name: 'B' });
    await call('POST', `/api/envelopes/${withAdjustment}/adjustments`, {
      amount: '100',
    });
    const refusedAgain = await call(
      'PATCH',
      `/api/envelopes/${withAdjustment}`,
      {
        currency: 'USD',
        confirm: true,
      },
    );
    expect(refusedAgain.statusCode).toBe(409);
    expect(
      (await call('GET', `/api/envelopes/${withAdjustment}`)).json().envelope
        .currency,
    ).toBe('EUR');
  });

  it('stores a change of the monthly amount or mode as next month’s plan (O4)', async () => {
    const id = await create();
    const first = await call('PATCH', `/api/envelopes/${id}`, {
      monthlyAmount: '55000',
    });
    expect(first.json().envelope).toMatchObject({
      plan: {
        fromMonth: '2026-10',
        monthlyAmount: '40000',
        mode: 'carry_over',
      },
      pendingPlan: {
        fromMonth: '2026-11',
        monthlyAmount: '55000',
        mode: 'carry_over',
      },
    });
    // A second change in the same month replaces the pending one and keeps
    // the field it does not name.
    const second = await call('PATCH', `/api/envelopes/${id}`, {
      mode: 'reset',
    });
    expect(second.json().envelope.pendingPlan).toMatchObject({
      monthlyAmount: '55000',
      mode: 'reset',
    });
    expect(count('envelope_plan', `envelope_id = ${id}`)).toBe(2);

    // The new plan applies from the next top-up, not before.
    now = Date.parse('2026-11-01T00:30:00.000Z');
    topUpEnvelopes(database, '2026-11', now);
    const november = (await call('GET', `/api/envelopes/${id}`)).json()
      .envelope;
    expect(november).toMatchObject({
      plan: { fromMonth: '2026-11', monthlyAmount: '55000', mode: 'reset' },
      pendingPlan: null,
      current: { topUp: '55000', topUpMode: 'reset', dropped: '18760' },
    });
  });

  it('drops the pending plan when the change is undone', async () => {
    const id = await create();
    await call('PATCH', `/api/envelopes/${id}`, { monthlyAmount: '55000' });
    const back = await call('PATCH', `/api/envelopes/${id}`, {
      monthlyAmount: '40000',
    });
    expect(back.json().envelope.pendingPlan).toBeNull();
    expect(count('envelope_plan', `envelope_id = ${id}`)).toBe(1);
  });

  it('archives and restores, topping up again from the month after the restore', async () => {
    const id = await create();
    expense({ envelopeId: id, date: '2026-10-02', amount: 100n });
    const archived = await call('PATCH', `/api/envelopes/${id}`, {
      archived: true,
    });
    expect(archived.json().envelope).toMatchObject({
      archived: true,
      used: true,
    });
    expect(archived.json().envelope.archivedAt).toBe(now);
    expect((await call('GET', '/api/envelopes')).json().envelopes).toEqual([]);
    expect(
      (await call('GET', '/api/envelopes?archived=true')).json().envelopes,
    ).toHaveLength(1);

    now = Date.parse('2026-12-05T10:00:00.000Z');
    expect(topUpEnvelopes(database, '2026-12', now)).toBe(0);
    const restored = await call('PATCH', `/api/envelopes/${id}`, {
      archived: false,
    });
    expect(restored.json().envelope.archived).toBe(false);
    expect(
      database.prepare('SELECT topup_from_month AS m FROM envelope').get(),
    ).toEqual({ m: '2027-01' });
    expect(topUpEnvelopes(database, '2027-01', now)).toBe(1);
    expect((await call('GET', '/api/envelopes')).json().envelopes).toHaveLength(
      1,
    );
  });

  it('deletes an unused envelope with its plans, and returns conflict for a used one', async () => {
    const category = Number(
      (
        database
          .prepare("SELECT id FROM category WHERE kind = 'expense' LIMIT 1")
          .get() as { id: bigint }
      ).id,
    );
    const unused = await create({
      name: 'Unused',
      defaultCategoryId: category,
    });
    database
      .prepare('UPDATE category SET default_envelope_id = ? WHERE id = ?')
      .run(unused, category);
    database
      .prepare(
        `INSERT INTO rule (position, pattern, category_id, envelope_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (1, 'REWE', ?, ?, 1, 1, 1, 1)`,
      )
      .run(category, unused);
    now = Date.parse('2026-11-02T10:00:00.000Z');
    topUpEnvelopes(database, '2026-11', now);
    expect(count('envelope_topup')).toBe(1);

    const deleted = await call('DELETE', `/api/envelopes/${unused}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(count('envelope')).toBe(0);
    expect(count('envelope_plan')).toBe(0);
    expect(count('envelope_topup')).toBe(0);
    // The rule and the category stay; they no longer name the envelope.
    expect(count('rule', 'envelope_id IS NULL')).toBe(1);
    expect(count('category', 'default_envelope_id IS NOT NULL')).toBe(0);
    expect((await call('DELETE', `/api/envelopes/${unused}`)).statusCode).toBe(
      404,
    );

    const used = await create({ name: 'Used' });
    expense({ envelopeId: used, date: '2026-11-02', amount: 100n });
    const refused = await call('DELETE', `/api/envelopes/${used}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('conflict');
    expect(count('envelope')).toBe(1);
    const archived = await call('PATCH', `/api/envelopes/${used}`, {
      archived: true,
    });
    expect(archived.statusCode).toBe(200);

    const adjusted = await create({ name: 'Adjusted' });
    await call('POST', `/api/envelopes/${adjusted}/adjustments`, {
      amount: '5',
    });
    expect(
      (await call('DELETE', `/api/envelopes/${adjusted}`)).statusCode,
    ).toBe(409);
  });

  it('adjusts by hand with a note and refuses bad adjustments', async () => {
    const id = await create();
    const adjusted = await call('POST', `/api/envelopes/${id}/adjustments`, {
      amount: '-2500',
      note: '  Found a receipt  ',
    });
    expect(adjusted.statusCode).toBe(201);
    expect(adjusted.json().adjustment).toMatchObject({
      envelopeId: id,
      date: '2026-10-15',
      amount: '-2500',
      note: 'Found a receipt',
      moveId: null,
      counterpartEnvelopeId: null,
      createdBy: 1,
    });
    const envelope = (await call('GET', `/api/envelopes/${id}`)).json();
    expect(envelope.envelope.current).toMatchObject({
      adjustments: '-2500',
      closing: '16260',
    });
    // Dated in an earlier month than the starting one: counts in it.
    const earlier = await call('POST', `/api/envelopes/${id}/adjustments`, {
      amount: '100',
      date: '2026-08-31',
    });
    expect(earlier.statusCode).toBe(201);
    expect(
      (await call('GET', `/api/envelopes/${id}`)).json().envelope.current
        .adjustments,
    ).toBe('-2400');

    for (const [label, payload] of [
      ['zero', { amount: '0' }],
      ['decimal', { amount: '1.5' }],
      ['future date', { amount: '100', date: '2026-10-16' }],
      ['impossible date', { amount: '100', date: '2026-02-30' }],
      ['long note', { amount: '100', note: 'x'.repeat(201) }],
    ] as const) {
      const response = await call(
        'POST',
        `/api/envelopes/${id}/adjustments`,
        payload,
      );
      expect(response.statusCode, label).toBe(400);
    }
    expect(
      (await call('POST', '/api/envelopes/999/adjustments', { amount: '1' }))
        .statusCode,
    ).toBe(404);
    await call('PATCH', `/api/envelopes/${id}`, { archived: true });
    const onArchived = await call('POST', `/api/envelopes/${id}/adjustments`, {
      amount: '1',
    });
    expect(onArchived.statusCode).toBe(409);
    expect(count('envelope_adjustment')).toBe(2);
  });

  it('removes a single adjustment', async () => {
    const id = await create();
    const adjusted = await call('POST', `/api/envelopes/${id}/adjustments`, {
      amount: '700',
    });
    const adjustmentId = adjusted.json().adjustment.id;
    const deleted = await call(
      'DELETE',
      `/api/envelope-adjustments/${adjustmentId}`,
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, count: 1 });
    expect(
      (await call('DELETE', `/api/envelope-adjustments/${adjustmentId}`))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/api/envelopes/${id}`)).json().envelope.current
        .closing,
    ).toBe('18760');
  });

  it('refuses a move between envelopes of different currencies', async () => {
    const euros = await create({ name: 'Euros' });
    const dollars = await create({ name: 'Dollars', currency: 'USD' });
    const refused = await call('POST', '/api/envelopes/moves', {
      fromEnvelopeId: euros,
      toEnvelopeId: dollars,
      amount: '1000',
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatchObject({
      code: 'validation',
      fields: { toEnvelopeId: expect.any(String) },
    });
    expect(count('envelope_adjustment')).toBe(0);
  });

  it('writes a move as two rows with one move id, and deleting either removes both', async () => {
    const from = await create({ name: 'From' });
    const to = await create({ name: 'To', startingBalance: '0' });
    for (const side of ['source', 'target'] as const) {
      const moved = await call('POST', '/api/envelopes/moves', {
        fromEnvelopeId: from,
        toEnvelopeId: to,
        amount: '5000',
        note: 'Birthday',
      });
      expect(moved.statusCode).toBe(201);
      const body = moved.json();
      const [out, into] = body.adjustments;
      expect(out).toMatchObject({
        envelopeId: from,
        amount: '-5000',
        moveId: body.moveId,
        counterpartEnvelopeId: to,
        note: 'Birthday',
        createdBy: 1,
      });
      expect(into).toMatchObject({
        envelopeId: to,
        amount: '5000',
        moveId: body.moveId,
        counterpartEnvelopeId: from,
      });
      const rows = database
        .prepare('SELECT envelope_id, amount, move_id FROM envelope_adjustment')
        .all() as Array<{
        envelope_id: bigint;
        amount: bigint;
        move_id: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.move_id))).toEqual(
        new Set([body.moveId]),
      );
      expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(0n);
      expect(
        (await call('GET', `/api/envelopes/${to}`)).json().envelope.current
          .closing,
      ).toBe('5000');

      const deleted = await call(
        'DELETE',
        `/api/envelope-adjustments/${side === 'source' ? out.id : into.id}`,
      );
      expect(deleted.json()).toEqual({ deleted: true, count: 2 });
      expect(count('envelope_adjustment')).toBe(0);
    }
  });

  it('refuses a move to the same envelope, to an archived one, or with a bad amount', async () => {
    const from = await create({ name: 'From' });
    const to = await create({ name: 'To' });
    const move = (payload: object) =>
      call('POST', '/api/envelopes/moves', {
        fromEnvelopeId: from,
        toEnvelopeId: to,
        amount: '100',
        ...payload,
      });
    expect((await move({ toEnvelopeId: from })).statusCode).toBe(400);
    expect((await move({ amount: '-100' })).statusCode).toBe(400);
    expect((await move({ amount: '0' })).statusCode).toBe(400);
    expect((await move({ toEnvelopeId: 999 })).statusCode).toBe(404);
    await call('PATCH', `/api/envelopes/${to}`, { archived: true });
    expect((await move({})).statusCode).toBe(409);
    expect(count('envelope_adjustment')).toBe(0);
  });

  it('gives the monthly records and statistics of each period', async () => {
    now = Date.parse('2026-05-10T10:00:00.000Z');
    alex = await signIn(1);
    const id = await create({
      name: 'Fun',
      monthlyAmount: '10000',
      startingBalance: undefined,
    });
    const spendings = [
      ['2026-06', '2026-06-10', 4000n],
      ['2026-07', '2026-07-10', 25000n],
      ['2026-09', '2026-09-10', 2000n],
    ] as const;
    for (const month of ['2026-06', '2026-07', '2026-08', '2026-09']) {
      now = Date.parse(`${month}-01T09:00:00.000Z`);
      topUpEnvelopes(database, month, now);
    }
    for (const [, date, amount] of spendings) {
      expense({ envelopeId: id, date, amount });
    }
    now = Date.parse('2026-10-01T09:00:00.000Z');
    topUpEnvelopes(database, '2026-10', now);
    alex = await signIn(1);

    const history = async (query = '') =>
      (await call('GET', `/api/envelopes/${id}/history${query}`)).json();
    const all = await history('?period=all');
    expect(all).toMatchObject({
      envelopeId: id,
      currency: 'EUR',
      period: 'all',
    });
    expect(
      all.months.map((m: { month: string; closing: string }) => [
        m.month,
        m.closing,
      ]),
    ).toEqual([
      ['2026-05', '0'],
      ['2026-06', '6000'],
      ['2026-07', '-9000'],
      ['2026-08', '1000'],
      ['2026-09', '9000'],
      ['2026-10', '19000'],
    ]);
    // Five closed months; July is the only one below zero; this month is
    // listed but not counted.
    expect(all.statistics).toEqual({
      months: 5,
      withinBudget: 4,
      averageSpent: '6200',
      largestOverspend: { month: '2026-07', amount: '9000' },
      leftOverNet: '9000',
      incomplete: false,
    });
    expect(all.months.at(-1)).toMatchObject({
      closed: false,
      withinBudget: null,
    });
    expect(all.months[2]).toMatchObject({
      withinBudget: false,
      spent: '25000',
    });

    // The default period is the last six closed months, plus this month.
    expect((await history()).period).toBe('last6');
    expect((await history('?period=last12')).statistics.months).toBe(5);
    const thisYear = await history('?period=thisYear');
    expect(thisYear.months).toHaveLength(6);
    expect(thisYear.statistics).toEqual(all.statistics);

    now = Date.parse('2027-01-05T09:00:00.000Z');
    alex = await signIn(1);
    expect((await history('?period=thisYear')).statistics.months).toBe(0);
    const january = await history('?period=last6');
    expect(january.months.map((m: { month: string }) => m.month)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);

    const detail = (
      await call('GET', `/api/envelopes/${id}?month=2026-07`)
    ).json();
    expect(detail.month).toMatchObject({
      closing: '-9000',
      withinBudget: false,
    });
    expect(detail.expenses).toMatchObject([
      { date: '2026-07-10', amount: '25000' },
    ]);

    expect(
      (await call('GET', `/api/envelopes/${id}/history?period=week`))
        .statusCode,
    ).toBe(400);
    expect((await call('GET', '/api/envelopes/999/history')).statusCode).toBe(
      404,
    );
  });

  it('stores the profile of the member on every write', async () => {
    const blairCookie = await signIn(2);
    const created = await call(
      'POST',
      '/api/envelopes',
      { name: 'Fun', currency: 'EUR', monthlyAmount: '100', mode: 'reset' },
      blairCookie,
    );
    expect(created.json().envelope).toMatchObject({
      createdBy: 2,
      updatedBy: 2,
    });
    const id = created.json().envelope.id;
    expect(
      database.prepare('SELECT created_by AS by FROM envelope_plan').get(),
    ).toEqual({ by: 2n });

    const other = await create({ name: 'Other' });
    now += 1000;
    const patched = await call(
      'PATCH',
      `/api/envelopes/${other}`,
      { monthlyAmount: '300' },
      blairCookie,
    );
    expect(patched.json().envelope).toMatchObject({
      createdBy: 1,
      updatedBy: 2,
      updatedAt: now,
    });
    expect(
      database
        .prepare(
          "SELECT created_by AS by FROM envelope_plan WHERE from_month = '2026-11'",
        )
        .get(),
    ).toEqual({ by: 2n });

    await call(
      'POST',
      `/api/envelopes/${id}/adjustments`,
      { amount: '10' },
      blairCookie,
    );
    await call(
      'POST',
      '/api/envelopes/moves',
      { fromEnvelopeId: id, toEnvelopeId: other, amount: '5' },
      blairCookie,
    );
    const authors = database
      .prepare('SELECT DISTINCT created_by AS by FROM envelope_adjustment')
      .all();
    expect(authors).toEqual([{ by: 2n }]);
    expect(count('envelope_adjustment')).toBe(3);
  });

  it('refuses a request without a session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/envelopes',
      headers: jsonHeaders,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
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
