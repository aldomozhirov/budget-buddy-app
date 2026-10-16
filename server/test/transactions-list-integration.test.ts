import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import type { FeedRate, FeedRequest, RateFeed } from '../src/rates/feed.js';
import { createRatesService, type RatesService } from '../src/rates/service.js';

/** The list and facets routes of spec 2 task 12 (TXN-6, UI-TXN-1, -2). */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

interface Listed {
  id: number;
  amount: string;
  date: string;
  merchant: string | null;
  [key: string]: unknown;
}

interface ListBody {
  transactions: Listed[];
  nextCursor: string | null;
  days: Array<{
    date: string;
    spent: string;
    income: string;
    incomplete: boolean;
  }>;
  summary: {
    count: number;
    spent: string;
    income: string;
    incomplete: boolean;
    currency: string;
  };
}

describe('transactions list API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let alex: string;
  let rates: RatesService;
  /** Ids by the names of the data set below. */
  let id: Record<string, number>;
  let joint: number;
  let wise: number;
  let cash: number;
  let groceries: number;
  let eatingOut: number;
  let salary: number;
  let groceriesEnvelope: number;
  let treats: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-list-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // Thursday 15 October 2026, 12:00 in Berlin.
    const clock = { now: () => new Date('2026-10-15T10:00:00.000Z') };
    const feed: RateFeed = {
      id: 'test',
      source: 'Test rates',
      covers: ({ code }) => code !== 'EUR',
      targetDate: (_now, today) => today,
      fetch: vi.fn<(request: FeedRequest) => Promise<FeedRate[]>>(() =>
        Promise.resolve([]),
      ),
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

  async function call(method: 'GET' | 'POST', url: string, payload?: object) {
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
    return (body.account ?? body.envelope ?? body.transaction).id;
  }

  function category(name: string): number {
    const row = database
      .prepare('SELECT id FROM category WHERE name = ?')
      .get(name) as { id: bigint };
    return Number(row.id);
  }

  function rate(base: string, quote: string, date: string, value: string) {
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
         VALUES (?, ?, ?, ?, 'Test rates', 0)`,
      )
      .run(base, quote, date, value);
  }

  async function add(name: string, payload: Record<string, unknown>) {
    id[name] = await post('/api/transactions', { kind: 'expense', ...payload });
  }

  async function list(query = ''): Promise<ListBody> {
    const response = await call('GET', `/api/transactions?${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  async function ids(query = ''): Promise<string[]> {
    const body = await list(query);
    const names = Object.fromEntries(
      Object.entries(id).map(([name, value]) => [value, name]),
    );
    return body.transactions.map((row) => names[row.id] ?? `#${row.id}`);
  }

  async function facet(name: string, query = '') {
    const response = await call(
      'GET',
      `/api/transactions/facets?facet=${name}&${query}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      facet: string;
      total: number;
      options: Array<{ value: string; count: number }>;
    };
  }

  /**
   * Fourteen transactions around 15 October 2026, in the family's three
   * accounts. USD is worth 0.50 EUR from 1 October and 0.60 from the 10th.
   */
  async function seed() {
    id = {};
    joint = await post('/api/accounts', {
      name: 'Joint',
      type: 'bank',
      currency: 'EUR',
    });
    wise = await post('/api/accounts', {
      name: 'Wise',
      type: 'bank',
      currency: 'USD',
    });
    cash = await post('/api/accounts', {
      name: 'Cash',
      type: 'cash',
      currency: 'EUR',
    });
    groceries = category('Groceries');
    eatingOut = category('Eating out');
    salary = category('Salary');
    const envelope = (name: string) =>
      post('/api/envelopes', {
        name,
        currency: 'EUR',
        monthlyAmount: '40000',
        mode: 'carry_over',
      });
    groceriesEnvelope = await envelope('Groceries');
    const eatingOutEnvelope = await envelope('Eating out');
    treats = await envelope('Treats');
    rate('USD', 'EUR', '2026-10-01', '0.5');
    rate('USD', 'EUR', '2026-10-10', '0.6');

    await add('rewe', {
      date: '2026-10-14',
      accountId: joint,
      amount: '6420',
      merchant: 'REWE',
      note: 'Weekly shop',
      categoryId: groceries,
      envelopeId: groceriesEnvelope,
    });
    await add('cafe', {
      date: '2026-10-14',
      accountId: joint,
      amount: '1850',
      merchant: 'Café Müller',
      memberId: 2,
      categoryId: eatingOut,
      envelopeId: eatingOutEnvelope,
    });
    await add('kiosk', {
      date: '2026-10-12',
      accountId: cash,
      amount: '700',
      note: 'kiosk',
      envelopeId: treats,
    });
    await add('amazon', {
      date: '2026-10-10',
      accountId: wise,
      amount: '2000',
      merchant: 'Amazon',
      memberId: 2,
    });
    await add('refund', {
      date: '2026-10-10',
      accountId: joint,
      amount: '-1999',
      merchant: 'REWE',
      categoryId: groceries,
      envelopeId: groceriesEnvelope,
    });
    await add('pay', {
      kind: 'income',
      date: '2026-10-05',
      accountId: joint,
      amount: '250000',
      memberId: 2,
      categoryId: salary,
      note: 'October pay',
    });
    await add('move', {
      kind: 'transfer',
      date: '2026-10-03',
      accountId: joint,
      toAccountId: cash,
      amount: '5000',
    });
    await add('small', {
      date: '2026-10-09',
      accountId: wise,
      amount: '100',
    });
    await add('lidl', {
      date: '2026-09-20',
      accountId: joint,
      amount: '3000',
      merchant: 'Lidl',
      categoryId: groceries,
      envelopeId: groceriesEnvelope,
    });
    await add('august', {
      date: '2026-08-15',
      accountId: joint,
      amount: '1234',
      merchant: 'Old',
    });
    await add('july', {
      date: '2026-07-31',
      accountId: joint,
      amount: '999',
    });
    await add('lastYear', {
      date: '2025-12-31',
      accountId: joint,
      amount: '888',
    });
  }

  describe('filters', () => {
    beforeEach(seed);

    it('lists this month, newest first, with the names a row shows', async () => {
      const body = await list();
      expect(await ids()).toEqual([
        'cafe',
        'rewe',
        'kiosk',
        'refund',
        'amazon',
        'small',
        'pay',
        'move',
      ]);
      expect(body.nextCursor).toBeNull();
      expect(body.transactions[1]).toMatchObject({
        id: id['rewe'],
        kind: 'expense',
        date: '2026-10-14',
        accountName: 'Joint',
        currency: 'EUR',
        amount: '6420',
        memberName: 'Alex',
        merchant: 'REWE',
        note: 'Weekly shop',
        categoryId: groceries,
        categoryName: 'Groceries',
        envelopeName: 'Groceries',
        toAccountId: null,
      });
      expect(body.transactions[7]).toMatchObject({
        kind: 'transfer',
        accountName: 'Joint',
        toAccountName: 'Cash',
        toAmount: '5000',
        categoryId: null,
      });
    });

    it('filters by period', async () => {
      expect(await ids('period=last_month')).toEqual(['lidl']);
      expect(await ids('period=last_3_months&kind=expense')).toEqual([
        'cafe',
        'rewe',
        'kiosk',
        'amazon',
        'small',
        'lidl',
        'august',
      ]);
      expect(await ids('period=this_year&kind=expense')).toContain('july');
      expect(await ids('period=this_year&kind=expense')).not.toContain(
        'lastYear',
      );
      expect(await ids('period=all&kind=expense')).toContain('lastYear');
      expect(await ids('period=custom&from=2026-10-05&to=2026-10-10')).toEqual([
        'refund',
        'amazon',
        'small',
        'pay',
      ]);
      expect(await ids('period=custom&from=2026-10-09&to=2026-10-09')).toEqual([
        'small',
      ]);
    });

    it('filters by member, account, category, envelope and kind', async () => {
      expect(await ids('member=2')).toEqual(['cafe', 'amazon', 'pay']);
      expect(await ids('member=1,2')).toHaveLength(8);
      // Repeated parameters work as a comma list.
      expect(await ids('member=2&member=1')).toHaveLength(8);
      // A transfer belongs to both of its accounts.
      expect(await ids(`account=${cash}`)).toEqual(['kiosk', 'move']);
      expect(await ids(`account=${wise}`)).toEqual(['amazon', 'small']);
      expect(await ids(`account=${wise},${cash}`)).toEqual([
        'kiosk',
        'amazon',
        'small',
        'move',
      ]);
      expect(await ids(`category=${groceries}`)).toEqual(['rewe', 'refund']);
      expect(await ids(`category=${groceries},${salary}`)).toEqual([
        'rewe',
        'refund',
        'pay',
      ]);
      expect(await ids(`envelope=${treats}`)).toEqual(['kiosk']);
      expect(await ids('kind=income')).toEqual(['pay']);
      expect(await ids('kind=transfer')).toEqual(['move']);
      expect(await ids('kind=income,transfer')).toEqual(['pay', 'move']);
    });

    it('takes none for category and envelope', async () => {
      // A transfer has no category and an income no envelope: neither is
      // "without" one.
      expect(await ids('category=none')).toEqual(['kiosk', 'amazon', 'small']);
      expect(await ids(`category=none,${salary}`)).toEqual([
        'kiosk',
        'amazon',
        'small',
        'pay',
      ]);
      expect(await ids('envelope=none')).toEqual(['amazon', 'small']);
      expect(await ids(`envelope=none,${treats}`)).toEqual([
        'kiosk',
        'amazon',
        'small',
      ]);
    });

    it('lists refunds under kind=refund only', async () => {
      expect(await ids('kind=refund')).toEqual(['refund']);
      expect(await ids('kind=expense')).toEqual([
        'cafe',
        'rewe',
        'kiosk',
        'amazon',
        'small',
      ]);
      expect(await ids('kind=expense,refund')).toHaveLength(6);
      const refund = (await list('kind=refund')).transactions[0];
      expect(refund?.amount).toBe('-1999');
    });

    it('combines filters', async () => {
      expect(
        await ids(`member=1&category=${groceries}&kind=refund&period=all`),
      ).toEqual(['refund']);
      expect(
        await ids(
          `period=all&category=${groceries}&envelope=${groceriesEnvelope}`,
        ),
      ).toEqual(['rewe', 'refund', 'lidl']);
      expect(await ids(`account=${joint}&member=2&q=caf`)).toEqual(['cafe']);
      expect(await ids(`account=${joint}&member=1&q=caf`)).toEqual([]);
    });

    it('refuses filters it does not understand', async () => {
      for (const query of [
        'period=yesterday',
        'period=custom',
        'period=custom&from=2026-10-10&to=2026-10-01',
        'from=2026-10-01',
        'member=abc',
        'member=0',
        'category=nothing',
        'kind=gift',
        'cursor=abc',
        'colour=red',
      ]) {
        const response = await call('GET', `/api/transactions?${query}`);
        expect(response.statusCode, query).toBe(400);
        expect(response.json().error.code).toBe('validation');
      }
      const facets = await call('GET', '/api/transactions/facets?facet=colour');
      expect(facets.statusCode).toBe(400);
    });

    it('never lists a draft', async () => {
      const before = await list('period=all');
      const insert = database.prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
           merchant, merchant_key, created_by, created_at, updated_by,
           updated_at)
         VALUES ('expense', 'draft', '2026-10-14', ?, 777, 1, 'REWE', 'rewe',
           1, 1, 1, 1)`,
      );
      const draft = Number(insert.run(joint).lastInsertRowid);
      database
        .prepare(
          `INSERT INTO txn_part (txn_id, position, amount, category_id)
           VALUES (?, 1, 777, ?)`,
        )
        .run(draft, groceries);
      const after = await list('period=all');
      expect(after.transactions.map((row) => row.id)).toEqual(
        before.transactions.map((row) => row.id),
      );
      expect(after.summary).toEqual(before.summary);
      expect(after.days).toEqual(before.days);
      expect((await ids('q=rewe')).length).toBe(2);
      expect(await ids('q=7.77&period=all')).toEqual([]);
      const options = await facet('category', 'period=all');
      expect(
        options.options.find((o) => o.value === String(groceries)),
      ).toEqual({ value: String(groceries), count: 3 });
    });
  });

  describe('search', () => {
    beforeEach(seed);

    it('finds a word in the merchant, case-insensitively', async () => {
      expect(await ids('period=all&q=rewe')).toEqual(['rewe', 'refund']);
      expect(await ids('period=all&q=ReWe')).toEqual(['rewe', 'refund']);
      expect(await ids('period=all&q=ew')).toEqual(['rewe', 'refund']);
    });

    it('needs every word to match, each in any field', async () => {
      // "shop" is only in the note of the first one.
      expect(await ids('period=all&q=rewe%20shop')).toEqual(['rewe']);
      expect(await ids('period=all&q=%20shop%20%20rewe%20')).toEqual(['rewe']);
      expect(await ids('period=all&q=rewe%20nothing')).toEqual([]);
    });

    it('matches the note, category, envelope, account and payer names', async () => {
      expect(await ids('period=all&q=kiosk')).toEqual(['kiosk']);
      expect(await ids('period=all&q=salary')).toEqual(['pay']);
      expect(await ids('period=all&q=eating')).toEqual(['cafe']);
      expect(await ids('period=all&q=treats')).toEqual(['kiosk']);
      expect(await ids('period=all&q=wise')).toEqual(['amazon', 'small']);
      // The account on either side of a transfer.
      expect(await ids('period=all&q=cash')).toEqual(['kiosk', 'move']);
      expect(await ids('period=all&q=blair')).toEqual([
        'cafe',
        'amazon',
        'pay',
      ]);
    });

    it('finds a word with an umlaut, whatever its case', async () => {
      expect(await ids('period=all&q=m%C3%BCller')).toEqual(['cafe']);
      expect(await ids('period=all&q=M%C3%9CLLER')).toEqual(['cafe']);
      expect(await ids('period=all&q=Caf%C3%A9')).toEqual(['cafe']);
      expect(await ids('period=all&q=muller')).toEqual([]);
    });

    it('matches a number against amounts as Design 5 says', async () => {
      // 64.2 and 64.20 are the amount; 64 is any amount from 64.00 to 64.99.
      expect(await ids('period=all&q=64.2')).toEqual(['rewe']);
      expect(await ids('period=all&q=64.20')).toEqual(['rewe']);
      expect(await ids('period=all&q=64,2')).toEqual(['rewe']);
      expect(await ids('period=all&q=64')).toEqual(['rewe']);
      expect(await ids('period=all&q=64.21')).toEqual([]);
      expect(await ids('period=all&q=64.205')).toEqual([]);
      expect(await ids('period=all&q=6')).toEqual([]);
      expect(await ids('period=all&q=18.5')).toEqual(['cafe']);
      // A refund matches by its size; an income by its own.
      expect(await ids('period=all&q=19.99')).toEqual(['refund']);
      expect(await ids('period=all&q=19')).toEqual(['refund']);
      expect(await ids('period=all&q=2500')).toEqual(['pay']);
      // Both sides of a transfer; US cents the same way.
      expect(await ids('period=all&q=50')).toEqual(['move']);
      expect(await ids('period=all&q=20')).toEqual(['amazon']);
      expect(await ids('period=all&q=1')).toEqual(['small']);
      // A number is also a word: it may appear in a name.
      expect(await ids('period=all&q=64%20rewe')).toEqual(['rewe']);
    });

    it('matches a number against a currency without minor units', async () => {
      const yen = await post('/api/accounts', {
        name: 'Yen',
        type: 'cash',
        currency: 'JPY',
      });
      await add('yen', { date: '2026-10-11', accountId: yen, amount: '1234' });
      expect(await ids('period=all&q=1234')).toEqual(['yen']);
      // 12.34 euros in the August one are not 1234 yen.
      expect(await ids('period=all&q=12.34')).toEqual(['august']);
      expect(await ids('period=all&q=1234.0')).toEqual(['yen']);
      expect(await ids('period=all&q=1234.5')).toEqual([]);
    });
  });

  describe('paging', () => {
    it('pages by 50 without gaps or repeats, also within one date', async () => {
      const account = await post('/api/accounts', {
        name: 'Joint',
        type: 'bank',
        currency: 'EUR',
      });
      const insert = database.prepare(
        `INSERT INTO txn (kind, date, account_id, amount, member_id,
           created_by, created_at, updated_by, updated_at)
         VALUES ('expense', ?, ?, ?, 1, 1, 1, 1, 1)`,
      );
      database.transaction(() => {
        const days: Array<[string, number]> = [
          ['2026-10-14', 60],
          ['2026-10-13', 40],
          ['2026-10-01', 25],
        ];
        for (const [date, count] of days) {
          for (let index = 0; index < count; index += 1) {
            insert.run(date, account, 100 + index);
          }
        }
      })();
      const expected = (
        database
          .prepare('SELECT id FROM txn ORDER BY date DESC, id DESC')
          .all() as Array<{ id: bigint }>
      ).map((row) => Number(row.id));
      expect(expected).toHaveLength(125);

      const seen: number[] = [];
      const sizes: number[] = [];
      const firstDays: string[][] = [];
      let cursor: string | null = null;
      do {
        const body: ListBody = await list(
          `period=all${cursor ? `&cursor=${cursor}` : ''}`,
        );
        sizes.push(body.transactions.length);
        seen.push(...body.transactions.map((row) => row.id));
        firstDays.push(body.days.map((day) => `${day.date} ${day.spent}`));
        expect(body.summary.count).toBe(125);
        cursor = body.nextCursor;
      } while (cursor);

      expect(sizes).toEqual([50, 50, 25]);
      expect(seen).toEqual(expected);
      // 14 October has 60 rows over two pages: its total is the day's.
      const total = Array.from(
        { length: 60 },
        (_, index) => 100 + index,
      ).reduce((sum, amount) => sum + amount, 0);
      expect(firstDays[0]).toEqual([`2026-10-14 ${total}`]);
      expect(firstDays[1]?.[0]).toBe(`2026-10-14 ${total}`);
    });

    it('stops at the end with no cursor, and pages a filtered list', async () => {
      await seed();
      const body = await list('period=all&kind=expense');
      expect(body.transactions).toHaveLength(9);
      expect(body.nextCursor).toBeNull();
      const first = await list('period=all&cursor=2026-10-14:' + id['rewe']);
      // Older than the first REWE of that day, newest first.
      expect(first.transactions[0]?.id).toBe(id['kiosk']);
      expect(first.transactions.map((row) => row.id)).not.toContain(id['cafe']);
    });
  });

  describe('totals', () => {
    beforeEach(seed);

    it('gives day totals and a summary equal to the hand sums', async () => {
      const body = await list();
      // USD 20.00 on the 10th at 0.60 = 12.00; USD 1.00 on the 9th at 0.50.
      expect(body.days).toEqual([
        { date: '2026-10-14', spent: '8270', income: '0', incomplete: false },
        { date: '2026-10-12', spent: '700', income: '0', incomplete: false },
        // 1200 spent less the 1999 refund.
        { date: '2026-10-10', spent: '-799', income: '0', incomplete: false },
        { date: '2026-10-09', spent: '50', income: '0', incomplete: false },
        { date: '2026-10-05', spent: '0', income: '250000', incomplete: false },
        { date: '2026-10-03', spent: '0', income: '0', incomplete: false },
      ]);
      expect(body.summary).toEqual({
        count: 8,
        spent: '8221',
        income: '250000',
        incomplete: false,
        currency: 'EUR',
      });
      const sum = (key: 'spent' | 'income') =>
        body.days.reduce((total, day) => total + BigInt(day[key]), 0n);
      expect(sum('spent')).toBe(BigInt(body.summary.spent));
      expect(sum('income')).toBe(BigInt(body.summary.income));
    });

    it('sums what the filters match, not only the page', async () => {
      const body = await list(`member=1&account=${joint}`);
      expect(body.summary).toMatchObject({
        count: 3,
        spent: String(6420 - 1999),
        income: '0',
      });
      const all = await list('period=all');
      expect(all.summary.count).toBe(12);
      // Every day of the page, and only those.
      expect(all.days).toHaveLength(10);
    });

    it('rounds each currency of a day once, at the day’s rate', async () => {
      await add('half-a', {
        date: '2026-10-02',
        accountId: wise,
        amount: '333',
      });
      await add('half-b', {
        date: '2026-10-02',
        accountId: wise,
        amount: '333',
      });
      // 666 US cents at 0.50 is 333, not 167 + 167.
      const day = (await list('q=wise')).days.find(
        (entry) => entry.date === '2026-10-02',
      );
      expect(day).toMatchObject({ spent: '333', incomplete: false });
    });

    it('says incomplete when a rate is missing, and never guesses', async () => {
      const pounds = await post('/api/accounts', {
        name: 'Pounds',
        type: 'bank',
        currency: 'GBP',
      });
      await add('gbp', {
        date: '2026-10-11',
        accountId: pounds,
        amount: '1000',
      });
      const body = await list();
      expect(body.summary).toMatchObject({
        count: 9,
        spent: '8221',
        incomplete: true,
      });
      expect(body.days.find((day) => day.date === '2026-10-11')).toEqual({
        date: '2026-10-11',
        spent: '0',
        income: '0',
        incomplete: true,
      });
      expect(
        body.days.filter((day) => day.incomplete).map((day) => day.date),
      ).toEqual(['2026-10-11']);

      // A rate dated before the transaction is enough; a later one is not.
      rate('GBP', 'EUR', '2026-10-12', '1.2');
      expect((await list()).summary.incomplete).toBe(true);
      rate('GBP', 'EUR', '2026-10-11', '1.2');
      const fixed = await list();
      expect(fixed.summary).toMatchObject({
        spent: String(8221 + 1200),
        incomplete: false,
      });
    });
  });

  describe('facets', () => {
    beforeEach(seed);

    const facets = [
      'period',
      'member',
      'account',
      'category',
      'envelope',
      'kind',
    ] as const;
    const parameter = { period: 'period' } as Record<string, string>;

    /** Every option's count is the list's count with that option picked. */
    async function expectCountsMatchList(base: string) {
      for (const name of facets) {
        const body = await facet(name, base);
        const values = new Set(body.options.map((option) => option.value));
        const candidates: string[] =
          name === 'period'
            ? ['this_month', 'last_month', 'last_3_months', 'this_year', 'all']
            : name === 'member'
              ? ['1', '2']
              : name === 'account'
                ? [joint, wise, cash].map(String)
                : name === 'category'
                  ? [
                      groceries,
                      eatingOut,
                      salary,
                      category('Other'),
                      'none',
                    ].map(String)
                  : name === 'envelope'
                    ? [groceriesEnvelope, treats, 'none'].map(String)
                    : ['expense', 'income', 'transfer', 'refund'];
        for (const value of [...values, ...candidates]) {
          // The facet's own filter is replaced by the option.
          const stripped = base
            .split('&')
            .filter((part) => !part.startsWith(`${parameter[name] ?? name}=`))
            .filter((part) => name !== 'period' || !/^(from|to)=/u.test(part))
            .concat(`${name}=${value}`)
            .join('&');
          const count = (await list(stripped)).summary.count;
          const option = body.options.find((entry) => entry.value === value);
          expect(option?.count ?? 0, `${name}=${value} (${base})`).toBe(count);
        }
        // The total ignores the facet's own filter; no period is all time.
        const others = base
          .split('&')
          .filter((part) => !part.startsWith(`${name}=`))
          .filter((part) => name !== 'period' || !/^(from|to)=/u.test(part));
        if (name === 'period') others.push('period=all');
        expect(body.total, `${name} total (${base})`).toBe(
          (await list(others.join('&'))).summary.count,
        );
      }
    }

    it('count each option as the list does with that option picked', async () => {
      await expectCountsMatchList('');
      await expectCountsMatchList('period=all');
      await expectCountsMatchList('period=this_year&kind=expense,refund');
      await expectCountsMatchList('period=all&member=2&category=none');
      await expectCountsMatchList(`period=all&account=${joint}&q=rewe`);
      await expectCountsMatchList('period=all&category=1,2&envelope=none&q=64');
    });

    it('leaves out the facet’s own filter', async () => {
      const unfiltered = await facet('member', 'period=all');
      const filtered = await facet('member', 'period=all&member=1');
      expect(filtered).toEqual(unfiltered);
      expect(unfiltered.options).toEqual([
        { value: '1', count: 9 },
        { value: '2', count: 3 },
      ]);
    });

    it('counts a transfer for both its accounts and a refund as a refund', async () => {
      const accounts = await facet('account', '');
      expect(accounts.options).toEqual(
        [
          { value: String(joint), count: 5 },
          { value: String(cash), count: 2 },
          { value: String(wise), count: 2 },
        ].sort(
          (a, b) => b.count - a.count || Number(a.value) - Number(b.value),
        ),
      );
      const kinds = await facet('kind', '');
      expect(kinds.options).toEqual([
        { value: 'expense', count: 5 },
        { value: 'income', count: 1 },
        { value: 'refund', count: 1 },
        { value: 'transfer', count: 1 },
      ]);
    });

    it('leaves out transfers from category and income from envelope', async () => {
      const categories = await facet('category', '');
      expect(categories.options).toContainEqual({ value: 'none', count: 3 });
      expect(categories.options.reduce((sum, o) => sum + o.count, 0)).toBe(7);
      const envelopes = await facet('envelope', '');
      expect(envelopes.options.reduce((sum, o) => sum + o.count, 0)).toBe(6);
    });
  });

  describe('access', () => {
    it('refuses a request without a session', async () => {
      for (const url of [
        '/api/transactions',
        '/api/transactions?period=all',
        '/api/transactions/facets?facet=member',
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
});

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
