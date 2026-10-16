import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  accountChipLabels,
  addOptionsResponseSchema,
  pickAccountChips,
  type AddOptionsResponse,
} from '@budget-buddy/shared';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

/** The add options, merchants and suggestions of spec 2 task 9. */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

describe('add options, merchants and suggestions API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let alex: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-add-options-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    const now = Date.parse('2026-10-15T10:00:00.000Z');
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
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
    method: 'GET' | 'POST',
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
      ownerMemberId: 1,
      ...extra,
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

  /** Saves an expense through the API; `cookie` decides who typed it. */
  async function spend(
    accountId: number,
    date: string,
    extra: Record<string, unknown> = {},
    cookie = alex,
  ) {
    const response = await call(
      'POST',
      '/api/transactions',
      { kind: 'expense', accountId, amount: '1000', date, ...extra },
      cookie,
    );
    expect(response.statusCode, response.body).toBe(201);
  }

  async function addOptions(cookie = alex): Promise<AddOptionsResponse> {
    const response = await call('GET', '/api/add-options', undefined, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return addOptionsResponseSchema.parse(response.json());
  }

  async function chips(kind: 'expense' | 'income', query = '') {
    const response = await call(
      'GET',
      `/api/suggestions/categories?kind=${kind}${query}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json().categoryIds as number[];
  }

  /** A second profile's session on another device. */
  async function signInAsBlair(): Promise<string> {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, 'user-agent': 'Blair-iPhone/1.0' },
      payload: { password },
    });
    expect(signedIn.statusCode).toBe(200);
    const cookie = cookieHeader(signedIn);
    const profile = await call(
      'POST',
      '/api/auth/profile',
      { memberId: 2, remember: true },
      cookie,
    );
    expect(profile.statusCode).toBe(200);
    database.prepare('UPDATE device SET lock_on_reopen = 0').run();
    return cookie;
  }

  describe('add options', () => {
    it('has no amount field at all', async () => {
      const keys = new Set<string>();
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(collect);
        if (node === null || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (key === 'properties' && value && typeof value === 'object') {
            Object.keys(value).forEach((name) => keys.add(name));
          }
          collect(value);
        }
      };
      collect(z.toJSONSchema(addOptionsResponseSchema));
      expect(keys.size).toBeGreaterThan(20);
      expect(
        [...keys].filter((name) => /amount|balance|total|spent/iu.test(name)),
      ).toEqual([]);

      // The same holds for what the route really sends.
      const joint = await account('Joint', 'EUR');
      await envelope('Groceries');
      await spend(joint, '2026-10-01', { amount: '1234' });
      const body = JSON.stringify(
        (await call('GET', '/api/add-options')).json(),
      );
      expect(body).not.toMatch(/amount|balance/iu);
      expect(body).not.toContain('1234');
    });

    it('lists only what is active', async () => {
      const bank = await account('Joint', 'EUR');
      const old = await account('Old', 'EUR');
      const groceries = await envelope('Groceries');
      const archived = await envelope('Gone');
      database.prepare('UPDATE account SET active = 0 WHERE id = ?').run(old);
      database
        .prepare('UPDATE envelope SET archived_at = 1 WHERE id = ?')
        .run(archived);
      database
        .prepare("UPDATE category SET archived_at = 1 WHERE name = 'Gifts'")
        .run();
      database
        .prepare(
          'UPDATE member SET active = 0, deactivated_at = 1 WHERE id = 2',
        )
        .run();

      const options = await addOptions();
      expect(options.profileId).toBe(1);
      expect(options.profiles).toEqual([{ id: 1, name: 'Alex' }]);
      expect(options.accounts.map((entry) => entry.id)).toEqual([bank]);
      expect(options.envelopes.map((entry) => entry.id)).toEqual([groceries]);
      const names = options.categories.map((entry) => entry.name);
      expect(names).not.toContain('Gifts');
      expect(names).toHaveLength(15);
      expect(options.commonCurrency).toBe('EUR');
      expect(options.timeZone).toBe('Europe/Berlin');
      expect(options.accounts[0]).toEqual({
        id: bank,
        name: 'Joint',
        ownerMemberId: 1,
        ownerName: 'Alex',
        type: 'bank',
        currency: 'EUR',
        decimals: 2,
        symbol: '€',
      });
    });

    it('gives only active defaults between category and envelope', async () => {
      const groceries = await envelope('Groceries');
      const shopping = category('Shopping');
      await call('POST', '/api/categories', { name: 'Pets', kind: 'expense' });
      database
        .prepare('UPDATE category SET default_envelope_id = ? WHERE id = ?')
        .run(groceries, shopping);
      database
        .prepare('UPDATE envelope SET default_category_id = ? WHERE id = ?')
        .run(category('Pets'), groceries);
      let options = await addOptions();
      expect(
        options.categories.find((entry) => entry.id === shopping),
      ).toMatchObject({ defaultEnvelopeId: groceries });
      expect(options.envelopes[0]).toMatchObject({
        defaultCategoryId: category('Pets'),
      });
      database
        .prepare('UPDATE envelope SET archived_at = 1 WHERE id = ?')
        .run(groceries);
      database
        .prepare('UPDATE category SET archived_at = 1 WHERE name = ?')
        .run('Pets');
      options = await addOptions();
      expect(
        options.categories.find((entry) => entry.id === shopping),
      ).toMatchObject({ defaultEnvelopeId: null });
    });

    it('orders the accounts by this profile’s use, default first', async () => {
      const bank = await account('Bank', 'EUR');
      const wise = await account('Wise', 'USD');
      const cash = await account('Cash', 'EUR', { type: 'cash' });
      // Wise: two uses; Cash: two uses, the later one more recent; Bank: one.
      await spend(wise, '2026-10-01');
      await spend(wise, '2026-10-02');
      await spend(cash, '2026-09-01');
      await spend(cash, '2026-10-10');
      await spend(bank, '2026-10-14');
      // Outside the window, and typed by Blair: neither counts for Alex.
      const blair = await signInAsBlair();
      await spend(bank, '2026-10-12', {}, blair);
      await spend(bank, '2026-10-13', {}, blair);
      await spend(bank, '2026-06-01');
      await spend(bank, '2026-06-02');
      await spend(bank, '2026-06-03');
      // A draft is not a use.
      const draft = database
        .prepare(
          `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
             created_by, created_at, updated_by, updated_at)
           VALUES ('expense', 'draft', '2026-10-14', ?, 100, 1, 1, 0, 1, 0)`,
        )
        .run(wise);
      expect(draft.changes).toBe(1);

      const options = await addOptions();
      expect(options.accounts.map((entry) => entry.name)).toEqual([
        'Cash',
        'Wise',
        'Bank',
      ]);
      // Blair’s own first account is the other way round.
      const blairOptions = await addOptions(blair);
      expect(blairOptions.accounts[0]?.name).toBe('Bank');
    });

    it('orders accounts without history: own, bank before cash, by name', async () => {
      const zeta = await account('Zeta', 'EUR');
      const cash = await account('Cash', 'EUR', { type: 'cash' });
      const alpha = await account('alpha', 'EUR');
      const max = await account('DKB', 'EUR', { ownerMemberId: 2 });
      const shared = await account('Shared', 'EUR', { ownerMemberId: null });
      const options = await addOptions();
      expect(options.accounts.map((entry) => entry.id)).toEqual([
        alpha,
        zeta,
        cash,
        max,
        shared,
      ]);
    });

    it('keeps the cash account among the first five chips', async () => {
      await account('A bank', 'EUR');
      await account('B bank', 'EUR');
      await account('C bank', 'EUR');
      await account('D bank', 'EUR');
      await account('E bank', 'EUR');
      const cash = await account('Wallet', 'EUR', { type: 'cash' });
      await account('Blair cash', 'EUR', { type: 'cash', ownerMemberId: 2 });
      const options = await addOptions();
      expect(options.accounts.map((entry) => entry.name).slice(0, 6)).toEqual([
        'A bank',
        'B bank',
        'C bank',
        'D bank',
        'E bank',
        'Wallet',
      ]);
      const row = pickAccountChips(options.accounts, options.profileId);
      expect(row).toHaveLength(5);
      expect(row.map((entry) => entry.id)).toContain(cash);
      expect(row.map((entry) => entry.name)).toEqual([
        'A bank',
        'B bank',
        'C bank',
        'D bank',
        'Wallet',
      ]);
    });

    it('labels “Cash €” and “Cash $” when both exist', async () => {
      await account('Cash', 'EUR', { type: 'cash' });
      await account('Cash', 'USD', { type: 'cash' });
      await account('DKB', 'EUR', { ownerMemberId: 2 });
      await account('Wise', 'USD');
      await account('Revolut', 'EUR');
      const options = await addOptions();
      const labels = accountChipLabels(
        options.accounts,
        options.profileId,
        options.commonCurrency,
      ).map((chip) => chip.label);
      expect(labels).toEqual(
        expect.arrayContaining(['Cash €', 'Cash $', 'Blair · DKB', 'Wise $']),
      );
      expect(labels).toContain('Revolut');
      // A lone cash account in the common currency has no symbol.
      database
        .prepare("DELETE FROM account WHERE currency = 'USD' AND type = 'cash'")
        .run();
      const lone = await addOptions();
      expect(
        accountChipLabels(lone.accounts, 1, 'EUR').map((chip) => chip.label),
      ).toContain('Cash');
    });

    it('orders categories by this profile, then the family, then the list', async () => {
      const bank = await account('Bank', 'EUR');
      const blair = await signInAsBlair();
      await spend(
        bank,
        '2026-10-01',
        { categoryId: category('Health') },
        blair,
      );
      await spend(
        bank,
        '2026-10-02',
        { categoryId: category('Health') },
        blair,
      );
      await spend(
        bank,
        '2026-10-03',
        { categoryId: category('Health') },
        blair,
      );
      await spend(bank, '2026-10-04', { categoryId: category('Travel') });
      await spend(bank, '2026-06-01', { categoryId: category('Gifts') });
      const names = (await addOptions()).categories.map((entry) => entry.name);
      // Alex used Travel; the family used Health most; then list order.
      expect(names.slice(0, 4)).toEqual([
        'Travel',
        'Health',
        'Groceries',
        'Eating out',
      ]);
      const forBlair = (await addOptions(blair)).categories.map(
        (entry) => entry.name,
      );
      expect(forBlair.slice(0, 3)).toEqual(['Health', 'Travel', 'Groceries']);
    });

    it('sends the rules and the latest merchants', async () => {
      const bank = await account('Bank', 'EUR');
      await call('POST', '/api/rules', {
        pattern: 'rewe',
        categoryId: category('Groceries'),
      });
      await spend(bank, '2026-10-01', { merchant: 'Rewe' });
      await spend(bank, '2026-10-05', { merchant: '  REWE  ' });
      await spend(bank, '2026-10-03', { merchant: 'Bäckerei Müller' });
      const options = await addOptions();
      expect(options.rules).toHaveLength(1);
      expect(options.merchants).toEqual([
        { merchant: 'REWE', key: 'rewe' },
        { merchant: 'Bäckerei Müller', key: 'bäckerei müller' },
      ]);
    });
  });

  describe('merchants', () => {
    it('gives the most recent spelling and the matching rule', async () => {
      const bank = await account('Bank', 'EUR');
      const savings = await account('Savings', 'EUR');
      const groceries = await envelope('Groceries');
      const rule = await call('POST', '/api/rules', {
        pattern: 'rewe, edeka',
        categoryId: category('Groceries'),
        envelopeId: groceries,
      });
      const limited = await call('POST', '/api/rules', {
        pattern: 'ikea',
        categoryId: category('Shopping'),
        accountId: savings,
      });
      expect(limited.statusCode).toBe(201);
      await spend(bank, '2026-10-01', { merchant: 'rewe city' });
      await spend(bank, '2026-10-09', { merchant: 'REWE City' });
      await spend(bank, '2026-10-05', { merchant: 'Ikea' });
      await spend(bank, '2026-10-02', { merchant: 'Kiosk' });

      const response = await call('GET', '/api/merchants');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().merchants).toEqual([
        {
          merchant: 'REWE City',
          key: 'rewe city',
          lastUsedOn: '2026-10-09',
          rule: {
            id: rule.json().rule.id,
            categoryId: category('Groceries'),
            envelopeId: groceries,
          },
        },
        { merchant: 'Ikea', key: 'ikea', lastUsedOn: '2026-10-05', rule: null },
        {
          merchant: 'Kiosk',
          key: 'kiosk',
          lastUsedOn: '2026-10-02',
          rule: null,
        },
      ]);

      // An account-limited rule matches for that account only.
      const forSavings = await call(
        'GET',
        `/api/merchants?q=IKE&accountId=${savings}`,
      );
      expect(forSavings.json().merchants).toEqual([
        expect.objectContaining({
          merchant: 'Ikea',
          rule: expect.objectContaining({ categoryId: category('Shopping') }),
        }),
      ]);
      const search = await call('GET', '/api/merchants?q=%20Cit');
      expect(
        search.json().merchants.map((m: { key: string }) => m.key),
      ).toEqual(['rewe city']);
    });

    it('ignores drafts and refuses a bad query', async () => {
      const bank = await account('Bank', 'EUR');
      database
        .prepare(
          `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
             merchant, merchant_key, created_by, created_at, updated_by,
             updated_at)
           VALUES ('expense', 'draft', '2026-10-14', ?, 100, 1, 'Ghost',
             'ghost', 1, 0, 1, 0)`,
        )
        .run(bank);
      const response = await call('GET', '/api/merchants');
      expect(response.json().merchants).toEqual([]);
      const bad = await call('GET', '/api/merchants?accountId=abc');
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('validation');
    });
  });

  describe('category suggestions', () => {
    it('puts a rule first, then the categories used with the merchant', async () => {
      const bank = await account('Bank', 'EUR');
      const transport = category('Transport');
      for (let day = 1; day <= 5; day += 1) {
        await spend(bank, `2026-10-0${day}`, {
          merchant: 'Deutsche Bahn',
          categoryId: transport,
        });
      }
      await spend(bank, '2026-10-06', {
        merchant: 'deutsche  bahn',
        categoryId: category('Travel'),
      });
      await spend(bank, '2026-10-07', {
        merchant: 'Other shop',
        categoryId: category('Leisure'),
      });

      const withMerchant = await chips('expense', '&merchant=DEUTSCHE%20BAHN');
      expect(withMerchant).toHaveLength(4);
      expect(withMerchant.slice(0, 2)).toEqual([transport, category('Travel')]);

      await call('POST', '/api/rules', {
        pattern: 'bahn',
        categoryId: category('Shopping'),
      });
      const withRule = await chips('expense', '&merchant=Deutsche%20Bahn');
      expect(withRule.slice(0, 3)).toEqual([
        category('Shopping'),
        transport,
        category('Travel'),
      ]);
      expect(new Set(withRule).size).toBe(withRule.length);

      // A rule limited to another account does not apply.
      const other = await account('Other', 'EUR');
      await call('POST', '/api/rules', {
        pattern: 'bahn',
        categoryId: category('Gifts'),
        accountId: other,
        placement: 'first',
      });
      const forBank = await chips(
        'expense',
        `&merchant=Deutsche%20Bahn&accountId=${bank}`,
      );
      expect(forBank[0]).toBe(category('Shopping'));
      const forOther = await chips(
        'expense',
        `&merchant=Deutsche%20Bahn&accountId=${other}`,
      );
      expect(forOther[0]).toBe(category('Gifts'));
    });

    it('then follows the envelope, the profile, the family and the list', async () => {
      const bank = await account('Bank', 'EUR');
      const holiday = await envelope('Holiday');
      const blair = await signInAsBlair();
      await spend(bank, '2026-10-01', {
        envelopeId: holiday,
        categoryId: category('Travel'),
      });
      await spend(bank, '2026-10-02', { categoryId: category('Health') });
      await spend(bank, '2026-10-02', { categoryId: category('Health') });
      await spend(bank, '2026-10-03', { categoryId: category('Gifts') }, blair);
      await spend(bank, '2026-10-03', { categoryId: category('Gifts') }, blair);
      await spend(bank, '2026-10-03', { categoryId: category('Gifts') }, blair);
      // The merchant has no history: the envelope’s category comes first.
      expect(
        await chips('expense', `&merchant=New&envelopeId=${holiday}`),
      ).toEqual([
        category('Travel'),
        category('Health'),
        category('Gifts'),
        category('Groceries'),
      ]);
      // Without a merchant or an envelope: Alex’s, the family’s, the list.
      expect(await chips('expense')).toEqual([
        category('Health'),
        category('Travel'),
        category('Gifts'),
        category('Groceries'),
      ]);
    });

    it('offers only active categories of the kind', async () => {
      const bank = await account('Bank', 'EUR');
      const salary = category('Salary');
      for (let day = 1; day <= 2; day += 1) {
        const response = await call('POST', '/api/transactions', {
          kind: 'income',
          accountId: bank,
          amount: '5000',
          date: `2026-10-0${day}`,
          categoryId: salary,
        });
        expect(response.statusCode, response.body).toBe(201);
      }
      await spend(bank, '2026-10-03', { categoryId: category('Gifts') });
      database
        .prepare("UPDATE category SET archived_at = 1 WHERE name = 'Gifts'")
        .run();
      expect(await chips('income')).toEqual([salary, category('Other income')]);
      expect(await chips('expense')).not.toContain(category('Gifts'));
      expect(await chips('expense')).not.toContain(salary);
    });

    it('reads confirmed transactions only', async () => {
      const bank = await account('Bank', 'EUR');
      const insert = database.prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
           merchant, merchant_key, created_by, created_at, updated_by,
           updated_at)
         VALUES ('expense', 'draft', '2026-10-14', ?, 100, 1, 'Lidl', 'lidl',
           1, 0, 1, 0)`,
      );
      for (let index = 0; index < 6; index += 1) {
        const id = Number(insert.run(bank).lastInsertRowid);
        database
          .prepare(
            `INSERT INTO txn_part (txn_id, position, amount, category_id)
             VALUES (?, 1, 100, ?)`,
          )
          .run(id, category('Leisure'));
      }
      await spend(bank, '2026-10-01', {
        merchant: 'Lidl',
        categoryId: category('Groceries'),
      });
      expect(await chips('expense', '&merchant=Lidl')).toEqual([
        category('Groceries'),
        category('Eating out'),
        category('Housing'),
        category('Utilities'),
      ]);
      // Without the confirmed one the drafts still change nothing.
      database.prepare("DELETE FROM txn WHERE status = 'confirmed'").run();
      expect(await chips('expense', '&merchant=Lidl')).toEqual([
        category('Groceries'),
        category('Eating out'),
        category('Housing'),
        category('Utilities'),
      ]);
    });

    it('refuses a missing kind', async () => {
      const response = await call('GET', '/api/suggestions/categories');
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation');
    });
  });

  describe('rate pair', () => {
    const insertRate = (
      base: string,
      quote: string,
      date: string,
      rate: string,
    ) =>
      database
        .prepare(
          `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
           VALUES (?, ?, ?, ?, 'test', 0)`,
        )
        .run(base, quote, date, rate);

    it('gives the rate on or before the day, also inverted', async () => {
      insertRate('EUR', 'USD', '2026-10-13', '1.0930');
      const direct = await call(
        'GET',
        '/api/rates/pair?from=EUR&to=USD&date=2026-10-15',
      );
      expect(direct.json()).toEqual({
        rate: { rate: '1.093', date: '2026-10-13' },
      });
      const inverse = await call(
        'GET',
        '/api/rates/pair?from=USD&to=EUR&date=2026-10-15',
      );
      expect(inverse.json().rate.date).toBe('2026-10-13');
      expect(Number(inverse.json().rate.rate)).toBeCloseTo(1 / 1.093, 6);
    });

    it('says null with no rate yet, for a day before it or one currency', async () => {
      insertRate('EUR', 'USD', '2026-10-13', '1.0930');
      for (const query of [
        'from=EUR&to=USD&date=2026-10-12',
        'from=EUR&to=GBP&date=2026-10-15',
        'from=EUR&to=EUR&date=2026-10-15',
      ]) {
        const response = await call('GET', `/api/rates/pair?${query}`);
        expect(response.statusCode, query).toBe(200);
        expect(response.json(), query).toEqual({ rate: null });
      }
    });

    it('refuses a bad query', async () => {
      const response = await call('GET', '/api/rates/pair?from=EUR&to=USD');
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation');
    });
  });

  it('refuses a request without a session', async () => {
    for (const url of [
      '/api/add-options',
      '/api/merchants',
      '/api/rates/pair?from=EUR&to=USD&date=2026-10-15',
      '/api/suggestions/categories?kind=expense',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: jsonHeaders,
      });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code).toBe('unauthenticated');
    }
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
