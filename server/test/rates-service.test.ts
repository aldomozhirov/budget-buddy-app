import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createRatesJob } from '../src/jobs/rates.js';
import { createJobRunner } from '../src/jobs/runner.js';
import { createLiveFeeds } from '../src/rates/feeds/index.js';
import type { FeedRate, RateFeed } from '../src/rates/feed.js';
import { createFixtureFeed } from '../src/rates/fixtureFeed.js';
import { createRateHttpClient } from '../src/rates/http.js';
import { createRatesService } from '../src/rates/service.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const fixtures = new URL('./fixtures/rates/', import.meta.url);
const origin = 'https://budget-buddy.test';
/** A Friday, 10:00 in Berlin. */
const friday = Date.parse('2026-10-09T08:00:00Z');
const hour = 3_600_000;

type RateRow = { base: string; quote: string; date: string; source: string };

/** Every weekday from `from` to `to` inclusive, counted without the code under test. */
function weekdays(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let time = Date.parse(`${from}T00:00:00Z`);
    time <= Date.parse(`${to}T00:00:00Z`);
    time += 86_400_000
  ) {
    const date = new Date(time);
    if (date.getUTCDay() % 6 !== 0) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

describe('rates service and daily job', () => {
  let database: Database.Database;
  let directory: string;
  let now: number;
  const clock = { now: () => new Date(now) };
  const errors: unknown[] = [];

  /** The fixture feed with its `fetch` replaced by a spy that calls through. */
  function spiedFixtureFeed(
    changes: Partial<RateFeed> = {},
  ): RateFeed & { fetch: ReturnType<typeof vi.fn> } {
    const feed = createFixtureFeed();
    const fetch = vi.fn(feed.fetch.bind(feed));
    return { ...feed, ...changes, fetch };
  }

  function service(...feeds: RateFeed[]) {
    return createRatesService({
      database,
      clock,
      feeds,
      logger: { error: (error) => errors.push(error) },
    });
  }

  function runner(ratesService: ReturnType<typeof service>) {
    return createJobRunner({
      database,
      clock,
      jobs: [createRatesJob(ratesService)],
      logger: { error: (error) => errors.push(error) },
    });
  }

  function addAccount(currency: string, openedOn?: string): number {
    const id = Number(
      database
        .prepare(
          `INSERT INTO account (name, type, currency, created_by, created_at,
            updated_by, updated_at) VALUES (?, 'bank', ?, 1, 1, 1, 1)`,
        )
        .run(`${currency} account ${Math.random()}`, currency).lastInsertRowid,
    );
    if (openedOn !== undefined) addSnapshot(id, openedOn);
    return id;
  }

  function addSnapshot(accountId: number, date: string): void {
    database
      .prepare(
        `INSERT INTO snapshot (account_id, taken_at, amount, source,
          created_by, created_at, updated_by, updated_at)
        VALUES (?, ?, 100, 'opening', 1, 1, 1, 1)`,
      )
      .run(accountId, Date.parse(`${date}T12:00:00Z`));
  }

  const rates = (where = '1 = 1') =>
    database
      .prepare(
        `SELECT base, quote, date, source FROM rate WHERE ${where}
        ORDER BY base, quote, date`,
      )
      .all() as RateRow[];
  const fetches = () =>
    database
      .prepare(
        'SELECT feed_id, date, status, error FROM rate_fetch ORDER BY id',
      )
      .all() as {
      feed_id: string;
      date: string;
      status: string;
      error: string | null;
    }[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-rates-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    database
      .prepare(
        "INSERT INTO family (id, password_hash, created_at) VALUES (1, 'x', 1)",
      )
      .run();
    database
      .prepare("INSERT INTO member (name, created_at) VALUES ('Alex', 1)")
      .run();
    for (const [code, name] of [
      ['BTC', 'Bitcoin'],
      ['ETH', 'Ethereum'],
      ['USDT', 'Tether'],
    ] as const) {
      database
        .prepare(
          'INSERT INTO coin (code, name, decimals, feed_id, created_at) VALUES (?, ?, 8, ?, 1)',
        )
        .run(code, name, `${code}-EUR`);
    }
    now = friday;
    errors.length = 0;
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('stores rates for the currencies in use only', async () => {
    addAccount('USD');
    addAccount('RUB');
    addAccount('EUR');
    const feed = spiedFixtureFeed();

    await runner(service(feed)).tick();

    const stored = rates();
    expect(
      new Set(stored.map(({ base, quote }) => `${base}/${quote}`)),
    ).toEqual(new Set(['EUR/USD', 'EUR/RUB']));
    // Bitcoin, Ether, Tether and sterling are not in use, so none is stored.
    expect(feed.fetch.mock.calls[0]?.[0].currencies).toEqual([
      { code: 'USD', coinFeedId: null },
      { code: 'RUB', coinFeedId: null },
    ]);
    // No account has a snapshot, so a week back from Friday 09/10.
    expect(
      stored.filter(({ quote }) => quote === 'USD').map((r) => r.date),
    ).toEqual(weekdays('2026-10-02', '2026-10-09'));
    expect(
      database.prepare('SELECT job, slot, status FROM job_run').all(),
    ).toEqual([{ job: 'rates', slot: '2026-10-09T10:00', status: 'done' }]);
  });

  it('fetches a coin held in an account against the euro', async () => {
    addAccount('BTC');
    await runner(service(spiedFixtureFeed())).tick();
    expect(
      new Set(rates().map(({ base, quote }) => `${base}/${quote}`)),
    ).toEqual(new Set(['BTC/EUR']));
  });

  it('stores nothing twice when it runs again, and asks the feed no more', async () => {
    addAccount('USD');
    const feed = spiedFixtureFeed();
    const ratesService = service(feed);
    const first = await ratesService.refreshToday();
    const stored = rates();
    const calls = feed.fetch.mock.calls.length;

    const second = await ratesService.refreshToday();
    now += hour;
    await runner(ratesService).tick();

    expect(first.failures).toEqual([]);
    expect(stored.length).toBeGreaterThan(0);
    expect(second).toEqual({ failures: [], unpublished: [], stored: 0 });
    expect(rates()).toEqual(stored);
    expect(feed.fetch.mock.calls).toHaveLength(calls);
  });

  it('keeps the first rate of a date and never rewrites it', async () => {
    addAccount('USD');
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
        VALUES ('EUR', 'USD', '2026-10-09', '9.9999', 'by hand', 1)`,
      )
      .run();
    await service(spiedFixtureFeed()).refreshToday();
    expect(
      database
        .prepare("SELECT rate, source FROM rate WHERE date = '2026-10-09'")
        .get(),
    ).toEqual({ rate: '9.9999', source: 'by hand' });
  });

  it('backfills three years of published dates and then only the new gap', async () => {
    const usd = addAccount('USD', '2023-10-09');
    const feed = spiedFixtureFeed();
    const ratesService = service(feed);

    expect(await ratesService.ensureHistory()).toEqual([]);

    const dates = rates("quote = 'USD'").map(({ date }) => date);
    expect(dates).toEqual(weekdays('2023-10-09', '2026-10-09'));
    expect(dates.length).toBeGreaterThan(780);
    expect(feed.fetch).toHaveBeenCalledTimes(1);

    await ratesService.ensureHistory();
    expect(feed.fetch).toHaveBeenCalledTimes(1);

    // A snapshot dated before the stored rates fetches the missing stretch.
    addSnapshot(usd, '2021-01-04');
    await ratesService.ensureHistory();
    expect(feed.fetch).toHaveBeenCalledTimes(2);
    expect(feed.fetch.mock.calls[1]?.[0]).toMatchObject({
      from: '2021-01-04',
      to: '2023-10-09',
    });
    expect(rates("quote = 'USD'").map(({ date }) => date)).toEqual(
      weekdays('2021-01-04', '2026-10-09'),
    );
  });

  it('gives a currency that comes into use its own history only', async () => {
    addAccount('USD', '2024-01-02');
    const ratesService = service(spiedFixtureFeed());
    await ratesService.ensureHistory();
    addAccount('GBP', '2025-06-02');
    await ratesService.ensureHistory();
    expect(rates("quote = 'GBP'")[0]?.date).toBe('2025-06-02');
    expect(rates("quote = 'USD'")[0]?.date).toBe('2024-01-02');
  });

  it('reaches back to the earliest snapshot for a new common currency', async () => {
    addAccount('EUR', '2024-01-02');
    database.prepare("UPDATE family SET common_currency = 'GBP'").run();
    await service(spiedFixtureFeed()).ensureHistory();
    expect(rates("quote = 'GBP'")[0]?.date).toBe('2024-01-02');
  });

  it('leaves stored rates untouched when a feed throws, and records the error', async () => {
    addAccount('USD');
    addAccount('GBP');
    database
      .prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
        VALUES ('EUR', 'USD', '2026-10-08', '1.1000', 'Fixture rates', 1)`,
      )
      .run();
    const before = rates();
    const broken: RateFeed = {
      ...createFixtureFeed(),
      id: 'broken',
      source: 'Broken feed',
      covers: ({ code }) => code === 'USD',
      fetch: () => Promise.reject(new Error('Feed is down')),
    };
    const working: RateFeed = {
      ...createFixtureFeed(),
      covers: ({ code }) => code === 'GBP',
    };

    const result = await service(broken, working).refreshToday();

    expect(result.failures).toEqual([
      { feedId: 'broken', message: 'Feed is down' },
    ]);
    expect(rates("quote = 'USD'")).toEqual(
      before.filter(({ quote }) => quote === 'USD'),
    );
    // The other feed is not held up by it.
    expect(rates("quote = 'GBP'").length).toBeGreaterThan(0);
    expect(fetches().filter(({ feed_id }) => feed_id === 'broken')).toEqual([
      expect.objectContaining({ status: 'failed', error: 'Feed is down' }),
    ]);
  });

  it('fails the job slot on a feed error and retries it at the next ticks', async () => {
    addAccount('USD');
    let down = true;
    const feed: RateFeed = {
      ...createFixtureFeed(),
      fetch: (request) =>
        down
          ? Promise.reject(new Error('Feed is down'))
          : createFixtureFeed().fetch(request),
    };
    const jobRunner = runner(service(feed));

    await jobRunner.tick();
    expect(
      database.prepare('SELECT status, error, attempts FROM job_run').get(),
    ).toEqual({
      status: 'failed',
      error: 'fixture: Feed is down',
      attempts: 1n,
    });
    expect(rates()).toEqual([]);

    down = false;
    now += 60_000;
    await jobRunner.tick();
    expect(
      database.prepare('SELECT status, attempts FROM job_run').get(),
    ).toEqual({ status: 'done', attempts: 2n });
    expect(rates().length).toBeGreaterThan(0);
  });

  it('asks again every hour until the feed has published, then stops', async () => {
    addAccount('USD');
    const publishing: FeedRate = {
      base: 'EUR',
      quote: 'USD',
      date: '2026-10-09',
      rate: '1.1177',
    };
    let published = false;
    const fetch = vi.fn<RateFeed['fetch']>(() =>
      Promise.resolve(published ? [publishing] : []),
    );
    const feed: RateFeed = {
      ...createFixtureFeed(),
      fetch,
    };
    const ratesService = service(feed);

    const early = await ratesService.refreshToday();
    expect(early.unpublished).toEqual(['fixture']);
    expect(fetches().at(-1)).toMatchObject({
      status: 'unpublished',
      date: '2026-10-09',
    });

    now += hour;
    published = true;
    const late = await ratesService.refreshToday();
    expect(late).toEqual({ failures: [], unpublished: [], stored: 1 });
    expect(fetches().at(-1)?.status).toBe('ok');

    now += hour;
    expect(await ratesService.refreshToday()).toEqual({
      failures: [],
      unpublished: [],
      stored: 0,
    });
    // The history fetch, the early try and the one that found the rate.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not ask on a weekend once Friday is in, and records no error', async () => {
    addAccount('USD');
    const feed = spiedFixtureFeed();
    const ratesService = service(feed);
    await ratesService.refreshToday();
    const calls = feed.fetch.mock.calls.length;

    for (const days of [1, 2]) {
      now = friday + days * 24 * hour;
      const result = await ratesService.refreshToday();
      expect(result).toEqual({ failures: [], unpublished: [], stored: 0 });
    }
    expect(feed.fetch.mock.calls).toHaveLength(calls);
    expect(fetches().every(({ status }) => status !== 'failed')).toBe(true);
  });

  it('catches up the days a stopped server missed with one range request', async () => {
    addAccount('USD');
    const feed = spiedFixtureFeed();
    const ratesService = service(feed);
    await ratesService.refreshToday();
    now = friday + 4 * 24 * hour;

    await ratesService.refreshToday();

    expect(feed.fetch.mock.calls.at(-1)?.[0]).toMatchObject({
      from: '2026-10-10',
      to: '2026-10-13',
    });
    expect(
      rates("quote = 'USD'")
        .map(({ date }) => date)
        .slice(-2),
    ).toEqual(['2026-10-12', '2026-10-13']);
  });

  it('refuses a host outside the allowlist while the other feeds work', async () => {
    addAccount('USD');
    addAccount('RUB');
    const requested: string[] = [];
    const fetchImpl = vi.fn((url: URL | string) => {
      requested.push(String(url));
      return Promise.resolve(
        new Response(
          readFileSync(
            fileURLToPath(new URL('ecb-eurofxref-daily.xml', fixtures)),
          ),
        ),
      );
    });
    const live = createLiveFeeds(
      createRateHttpClient({
        allowedHosts: ['www.ecb.europa.eu'],
        fetchImpl: fetchImpl as typeof fetch,
      }),
    );
    now = Date.parse('2026-10-07T14:00:00Z');

    const result = await service(...live).refreshToday();

    expect(requested).toEqual([
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
    ]);
    expect(result.failures).toEqual([
      {
        feedId: 'cbr',
        message: expect.stringContaining(
          'www.cbr.ru is not on the price feed allowlist',
        ),
      },
    ]);
    expect(rates().map(({ source }) => source)).toContain(
      'European Central Bank',
    );
  });

  describe('status', () => {
    it('shows the age of the latest rate per currency and the last error', async () => {
      addAccount('USD');
      addAccount('GBP');
      addAccount('JPY');
      const failing: RateFeed = {
        ...createFixtureFeed(),
        id: 'jpy',
        source: 'Yen feed',
        covers: ({ code }) => code === 'JPY',
        fetch: () => Promise.reject(new Error('Yen feed is down')),
      };
      const working: RateFeed = {
        ...createFixtureFeed(),
        covers: ({ code }) => code === 'USD' || code === 'GBP',
      };
      const ratesService = service(working, failing);
      await ratesService.refreshToday();
      now += 3 * 24 * hour;

      const status = ratesService.status();

      expect(status).toMatchObject({
        today: '2026-10-12',
        timeZone: 'Europe/Berlin',
        commonCurrency: 'EUR',
        lastUpdatedAt: friday,
        currencies: [
          {
            code: 'GBP',
            latestDate: '2026-10-09',
            ageDays: 3,
            source: 'Fixture rates',
          },
          { code: 'JPY', latestDate: null, ageDays: null, source: null },
          {
            code: 'USD',
            latestDate: '2026-10-09',
            ageDays: 3,
            source: 'Fixture rates',
          },
        ],
        feeds: [
          { id: 'fixture', lastError: null, lastSuccessAt: friday },
          {
            id: 'jpy',
            lastSuccessAt: null,
            lastError: { message: 'Yen feed is down', at: friday },
          },
        ],
      });
    });

    it('is empty before any rate is fetched', () => {
      expect(service().status()).toMatchObject({
        lastUpdatedAt: null,
        currencies: [],
        feeds: [],
      });
    });
  });
});

describe('rates job slots', () => {
  const job = createRatesJob({ refreshToday: vi.fn() });
  const settings = { timeZone: 'Europe/Berlin' } as Parameters<
    typeof job.dueSlots
  >[1];

  it('has no slot before 06:00 local time', () => {
    expect(
      job.dueSlots(new Date('2026-10-09T03:59:00Z'), settings, null),
    ).toEqual([]);
  });

  it('has an hourly slot from 06:00 local time, oldest first', () => {
    expect(
      job.dueSlots(new Date('2026-10-09T08:30:00Z'), settings, null),
    ).toEqual([
      '2026-10-09T06:00',
      '2026-10-09T07:00',
      '2026-10-09T08:00',
      '2026-10-09T09:00',
      '2026-10-09T10:00',
    ]);
  });

  it('skips the slots up to the last one done', () => {
    expect(
      job.dueSlots(
        new Date('2026-10-09T08:30:00Z'),
        settings,
        '2026-10-09T09:00',
      ),
    ).toEqual(['2026-10-09T10:00']);
  });

  it('follows the local day across a daylight-saving change', () => {
    // 25/10/2026: clocks go back; 06:30 is CET (UTC+1) that day.
    expect(
      job.dueSlots(new Date('2026-10-25T05:30:00Z'), settings, null),
    ).toEqual(['2026-10-25T06:00']);
    expect(
      job.dueSlots(new Date('2026-10-24T23:30:00Z'), settings, null),
    ).toEqual([]);
  });
});

describe('rates API', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let cookies: string;
  let ratesService: ReturnType<typeof createRatesService>;
  const now = friday;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-rates-api-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    const clock = { now: () => new Date(now) };
    ratesService = createRatesService({
      database,
      clock,
      feeds: [createFixtureFeed()],
    });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock,
      rates: ratesService,
    });
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: headers(),
      payload: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alex'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookies = ([setup.headers['set-cookie']].flat().filter(Boolean) as string[])
      .map((value) => value.split(';', 1)[0])
      .join('; ');
  });

  afterEach(async () => {
    await ratesService.idle();
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  function headers() {
    return {
      origin,
      'content-type': 'application/json',
      ...(cookies ? { cookie: cookies } : {}),
    };
  }

  const usdDates = () =>
    (
      database
        .prepare("SELECT date FROM rate WHERE quote = 'USD' ORDER BY date")
        .all() as { date: string }[]
    ).map(({ date }) => date);

  it('needs a session to read the status', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/rates/status',
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('fetches the missing rates in the background when an account is created', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: headers(),
      payload: {
        name: 'Dollars',
        type: 'bank',
        currency: 'USD',
        openingBalance: '1000',
        openingDate: '2024-10-09',
      },
    });
    expect(created.statusCode).toBe(201);
    await ratesService.idle();

    expect(usdDates()).toEqual(weekdays('2024-10-09', '2026-10-09'));
    const status = await app.inject({
      method: 'GET',
      url: '/api/rates/status',
      headers: headers(),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      today: '2026-10-09',
      currencies: [{ code: 'USD', latestDate: '2026-10-09', ageDays: 0 }],
      feeds: [{ id: 'fixture', name: 'Fixture rates', lastError: null }],
    });
  });

  it('fetches the stretch before the stored rates when an earlier snapshot is added or moved', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: headers(),
      payload: {
        name: 'Dollars',
        type: 'bank',
        currency: 'USD',
        openingBalance: '1000',
        openingDate: '2026-09-01',
      },
    });
    const accountId = created.json().account.id as number;
    await ratesService.idle();
    expect(usdDates()[0]).toBe('2026-09-01');

    const added = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/snapshots`,
      headers: headers(),
      payload: { amount: '500', date: '2026-06-01' },
    });
    expect(added.statusCode).toBe(201);
    await ratesService.idle();
    expect(usdDates()[0]).toBe('2026-06-01');

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/snapshots/${added.json().snapshot.id}`,
      headers: headers(),
      payload: { date: '2026-03-02' },
    });
    expect(moved.statusCode).toBe(200);
    await ratesService.idle();
    expect(usdDates()[0]).toBe('2026-03-02');
  });

  it('fetches a new currency when an account is relabelled or the common currency changes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: headers(),
      payload: {
        name: 'Cash',
        type: 'cash',
        currency: 'EUR',
        openingBalance: '1000',
        openingDate: '2026-08-03',
      },
    });
    const accountId = created.json().account.id as number;
    await ratesService.idle();
    expect(usdDates()).toEqual([]);

    const relabel = await app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/currency`,
      headers: headers(),
      payload: { currency: 'USD', confirm: true },
    });
    expect(relabel.statusCode).toBe(200);
    await ratesService.idle();
    expect(usdDates()[0]).toBe('2026-08-03');

    const common = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: headers(),
      payload: { commonCurrency: 'GBP' },
    });
    expect(common.statusCode).toBe(200);
    await ratesService.idle();
    expect(
      (
        database
          .prepare("SELECT MIN(date) AS first FROM rate WHERE quote = 'GBP'")
          .get() as { first: string }
      ).first,
    ).toBe('2026-08-03');
  });
});
