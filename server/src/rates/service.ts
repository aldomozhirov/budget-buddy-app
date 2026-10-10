import type Database from 'better-sqlite3';
import {
  todayInTimeZone,
  type RatesStatusResponse,
} from '@budget-buddy/shared';
import type { Clock } from '../clock.js';
import { daysBetween, shiftDate } from './dates.js';
import type { FeedRate, RateFeed, UsedCurrency } from './feed.js';

/** Where the service reports failures that no caller owns. */
export interface RatesLogger {
  error(error: unknown, message: string): void;
}

/** Options for `createRatesService`. */
export interface RatesServiceOptions {
  database: Database.Database;
  clock: Clock;
  /** Every feed the service may call; each serves the currencies it covers. */
  feeds: readonly RateFeed[];
  logger?: RatesLogger;
}

/** A feed that could not be fetched, as `refreshToday` reports it. */
export interface FeedFailure {
  feedId: string;
  message: string;
}

/** How one daily refresh went. */
export interface RefreshResult {
  /** Feeds that threw; their stored rates are untouched. */
  failures: FeedFailure[];
  /** Feeds that answered without yet publishing today's rate. */
  unpublished: string[];
  /** New rate rows written by the fetch of the newest rates (not history). */
  stored: number;
}

/** Asks for rates the stored data lacks to be fetched in the background. */
export interface BackfillRequester {
  /**
   * Fetches, in the background, the rates missing for every currency in use
   * back to its earliest snapshot (CUR-3). Returns at once and never throws;
   * call it after a write that adds a currency or an earlier date.
   */
  requestBackfill(): void;
}

/** Fetches, stores and reports exchange rates (CUR-2 to CUR-4). */
export interface RatesService extends BackfillRequester {
  /**
   * The daily job body: makes up missing history, then fetches the newest
   * rate of each feed unless it has published it already.
   */
  refreshToday(): Promise<RefreshResult>;
  /** Fills missing history now and resolves when done; errors are recorded. */
  ensureHistory(): Promise<FeedFailure[]>;
  /** Resolves when every queued fetch has finished. */
  idle(): Promise<void>;
  /** The latest rate per currency and the state of each feed (CUR-4). */
  status(): RatesStatusResponse;
}

/** Days of rates fetched for a currency with no snapshot to reach back to. */
const defaultLookbackDays = 7;
/** A currency whose newest rate trails its feed's by more days is stale. */
const staleTailDays = 7;
const maxErrorLength = 500;

type FamilyRow = { common_currency: string; time_zone: string };

/** The dates a feed has been asked for, whether or not it had rates there. */
interface Ledger {
  from: string;
  to: string;
}

/** A span of dates to fetch for some currencies of one feed. */
interface Gap {
  currencies: UsedCurrency[];
  from: string;
  to: string;
}

/**
 * Creates the rates service. All feed work runs one fetch at a time, so the
 * daily job and a backfill never ask a feed for the same dates together.
 * Stored rates are only ever added (CUR-2): a date that has a rate keeps it.
 */
export function createRatesService(options: RatesServiceOptions): RatesService {
  const { database, clock, feeds, logger } = options;
  const ledgers = new Map<string, Ledger>();
  let queue: Promise<unknown> = Promise.resolve();
  let backfillWaiting = false;

  /**
   * Statements are prepared on first use, because the app may be created
   * before the database is migrated.
   */
  let prepared: ReturnType<typeof prepare> | undefined;
  function prepare() {
    return {
      selectFamily: database.prepare(
        'SELECT common_currency, time_zone FROM family WHERE id = 1',
      ),
      selectUsed: database.prepare(
        `SELECT DISTINCT a.currency AS code, c.feed_id AS coinFeedId
    FROM account a LEFT JOIN coin c ON c.code = a.currency`,
      ),
      selectCoin: database.prepare(
        'SELECT feed_id AS coinFeedId FROM coin WHERE code = ?',
      ),
      selectEarliest: database.prepare(
        `SELECT a.currency AS code, MIN(s.taken_at) AS takenAt
    FROM account a JOIN snapshot s ON s.account_id = a.id
    GROUP BY a.currency`,
      ),
      selectSpan: database.prepare(
        `SELECT MIN(date) AS first, MAX(date) AS last FROM rate
    WHERE source = ? AND (base = ? OR quote = ?)`,
      ),
      selectFeedLast: database.prepare(
        'SELECT MAX(date) AS last FROM rate WHERE source = ?',
      ),
      insertRate: database.prepare(
        `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (base, quote, date) DO NOTHING`,
      ),
      insertFetch: database.prepare(
        `INSERT INTO rate_fetch (feed_id, date, status, error, at)
    VALUES (?, ?, ?, ?, ?)`,
      ),
      selectPublished: database.prepare(
        `SELECT 1 FROM rate_fetch
    WHERE feed_id = ? AND date = ? AND status = 'ok' LIMIT 1`,
      ),
      selectLatestRate: database.prepare(
        `SELECT date, source FROM rate WHERE base = ? OR quote = ?
    ORDER BY date DESC, id DESC LIMIT 1`,
      ),
      selectLastFetch: database.prepare(
        `SELECT status, error, at FROM rate_fetch WHERE feed_id = ?
    ORDER BY id DESC LIMIT 1`,
      ),
      selectLastAnswer: database.prepare(
        `SELECT MAX(at) AS at FROM rate_fetch
    WHERE feed_id = ? AND status != 'failed'`,
      ),
    };
  }
  const sql = () => (prepared ??= prepare());

  /** Runs `work` after everything queued before it, whatever their outcome. */
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  }

  function family(): FamilyRow | undefined {
    return sql().selectFamily.get() as FamilyRow | undefined;
  }

  /** Currencies on any account plus the common currency, as bare rows. */
  function usedCurrencies(commonCurrency: string): UsedCurrency[] {
    const used = new Map<string, UsedCurrency>();
    for (const row of sql().selectUsed.all() as {
      code: string;
      coinFeedId: string | null;
    }[]) {
      used.set(row.code, { code: row.code, coinFeedId: row.coinFeedId });
    }
    if (!used.has(commonCurrency)) {
      const coin = sql().selectCoin.get(commonCurrency) as
        { coinFeedId: string } | undefined;
      used.set(commonCurrency, {
        code: commonCurrency,
        coinFeedId: coin?.coinFeedId ?? null,
      });
    }
    return [...used.values()];
  }

  /** The date each currency's rates must reach back to. */
  function wantedFrom(
    used: readonly UsedCurrency[],
    commonCurrency: string,
    timeZone: string,
    today: string,
  ): Map<string, string> {
    const earliest = new Map<string, string>();
    let overall: string | undefined;
    for (const row of sql().selectEarliest.all() as {
      code: string;
      takenAt: bigint;
    }[]) {
      const date = todayInTimeZone(new Date(Number(row.takenAt)), timeZone);
      earliest.set(row.code, date);
      if (overall === undefined || date < overall) overall = date;
    }
    const fallback = shiftDate(today, -defaultLookbackDays);
    const wanted = new Map<string, string>();
    for (const { code } of used) {
      // Every conversion reaches the common currency, so it needs the whole
      // history, while the others need only their own.
      const from =
        code === commonCurrency ? overall : (earliest.get(code) ?? undefined);
      wanted.set(code, from === undefined || from > today ? fallback : from);
    }
    return wanted;
  }

  /** The dates fetched for a currency at a feed: from memory, else stored. */
  function ledgerFor(feed: RateFeed, code: string): Ledger | undefined {
    const key = `${feed.id}|${code}`;
    const known = ledgers.get(key);
    if (known) return known;
    const span = sql().selectSpan.get(feed.source, code, code) as {
      first: string | null;
      last: string | null;
    };
    if (span.first === null || span.last === null) return undefined;
    const ledger = { from: span.first, to: span.last };
    ledgers.set(key, ledger);
    return ledger;
  }

  function widenLedger(
    feed: RateFeed,
    codes: readonly string[],
    from: string,
    to: string,
  ): void {
    for (const code of codes) {
      const key = `${feed.id}|${code}`;
      const known = ledgers.get(key) ?? ledgerFor(feed, code);
      ledgers.set(key, {
        from: known && known.from < from ? known.from : from,
        to: known && known.to > to ? known.to : to,
      });
    }
  }

  /**
   * Asks `feed` for `from` to `to` and stores what it sends, in one
   * transaction, so a feed that throws leaves the stored rates untouched.
   * Only rates of the requested currencies and dates are kept.
   * @returns The rates it sent that were in range, and how many were new.
   * @throws The feed's own error, after recording it in `rate_fetch`.
   */
  async function fetchAndStore(
    feed: RateFeed,
    currencies: UsedCurrency[],
    from: string,
    to: string,
    today: string,
    kind: 'daily' | 'backfill',
  ): Promise<{ rates: FeedRate[]; stored: number }> {
    const now = clock.now();
    const target = feed.targetDate(now, today);
    const recordedDate = kind === 'daily' ? target : to;
    try {
      const codes = new Set(currencies.map(({ code }) => code));
      const answer = await feed.fetch({ currencies, from, to, today, now });
      const rates = answer.filter(
        (rate) =>
          rate.date >= from &&
          rate.date <= to &&
          (codes.has(rate.base) || codes.has(rate.quote)),
      );
      const stored = database.transaction(() => {
        let added = 0;
        for (const { base, quote, date, rate } of rates) {
          added += sql().insertRate.run(
            base,
            quote,
            date,
            rate,
            feed.source,
            now.getTime(),
          ).changes;
        }
        return added;
      })();
      const status =
        kind === 'backfill'
          ? 'backfilled'
          : rates.some(({ date }) => date === target)
            ? 'ok'
            : 'unpublished';
      sql().insertFetch.run(feed.id, recordedDate, status, null, now.getTime());
      return { rates, stored };
    } catch (error) {
      try {
        sql().insertFetch.run(
          feed.id,
          recordedDate,
          'failed',
          describe(error),
          clock.now().getTime(),
        );
      } catch (recordError) {
        logger?.error(recordError, `Fetch result of ${feed.id} not saved`);
      }
      throw error;
    }
  }

  /** The spans each feed lacks for the currencies in use. */
  function findGaps(
    feed: RateFeed,
    used: readonly UsedCurrency[],
    wanted: ReadonlyMap<string, string>,
    today: string,
  ): Gap[] {
    const feedLast = (
      sql().selectFeedLast.get(feed.source) as { last: string | null }
    ).last;
    const gaps = new Map<string, Gap>();
    const add = (currency: UsedCurrency, from: string, to: string) => {
      const key = `${from}|${to}`;
      const gap = gaps.get(key) ?? { currencies: [], from, to };
      gap.currencies.push(currency);
      gaps.set(key, gap);
    };
    for (const currency of used.filter((candidate) => feed.covers(candidate))) {
      const from = wanted.get(currency.code) ?? today;
      const ledger = ledgerFor(feed, currency.code);
      if (!ledger) {
        add(currency, from, today);
        continue;
      }
      if (from < ledger.from) add(currency, from, ledger.from);
      if (
        feedLast !== null &&
        daysBetween(ledger.to, feedLast) > staleTailDays
      ) {
        add(currency, ledger.to, today);
      }
    }
    return [...gaps.values()];
  }

  /** Fetches every gap of every feed; one feed failing does not stop others. */
  async function fillHistory(): Promise<FeedFailure[]> {
    const settings = family();
    if (!settings) return [];
    const now = clock.now();
    const today = todayInTimeZone(now, settings.time_zone);
    const used = usedCurrencies(settings.common_currency);
    const wanted = wantedFrom(
      used,
      settings.common_currency,
      settings.time_zone,
      today,
    );
    const failures: FeedFailure[] = [];
    for (const feed of feeds) {
      for (const gap of findGaps(feed, used, wanted, today)) {
        try {
          await fetchAndStore(
            feed,
            gap.currencies,
            gap.from,
            gap.to,
            today,
            'backfill',
          );
          widenLedger(
            feed,
            gap.currencies.map(({ code }) => code),
            gap.from,
            gap.to,
          );
        } catch (error) {
          failures.push({ feedId: feed.id, message: describe(error) });
          logger?.error(error, `Rate backfill from ${feed.id} failed`);
        }
      }
    }
    return failures;
  }

  async function refresh(): Promise<RefreshResult> {
    const result: RefreshResult = { failures: [], unpublished: [], stored: 0 };
    const settings = family();
    if (!settings) return result;
    result.failures.push(...(await fillHistory()));
    const failed = new Set(result.failures.map(({ feedId }) => feedId));
    const now = clock.now();
    const today = todayInTimeZone(now, settings.time_zone);
    const used = usedCurrencies(settings.common_currency);
    for (const feed of feeds) {
      const covered = used.filter((currency) => feed.covers(currency));
      // A feed that just failed would only fail again.
      if (covered.length === 0 || failed.has(feed.id)) continue;
      const target = feed.targetDate(now, today);
      if (sql().selectPublished.get(feed.id, target)) continue;
      const feedLast = (
        sql().selectFeedLast.get(feed.source) as {
          last: string | null;
        }
      ).last;
      const from =
        feedLast === null
          ? shiftDate(target, -defaultLookbackDays)
          : shiftDate(feedLast, 1);
      if (from > target) continue;
      try {
        const { rates, stored } = await fetchAndStore(
          feed,
          covered,
          from,
          target,
          today,
          'daily',
        );
        result.stored += stored;
        if (!rates.some(({ date }) => date === target)) {
          result.unpublished.push(feed.id);
        }
      } catch (error) {
        result.failures.push({ feedId: feed.id, message: describe(error) });
      }
    }
    return result;
  }

  return {
    refreshToday: () => enqueue(refresh),
    ensureHistory: () => enqueue(fillHistory),
    requestBackfill() {
      // A request that has not started yet already covers a later one.
      if (backfillWaiting) return;
      backfillWaiting = true;
      void enqueue(() => {
        backfillWaiting = false;
        return fillHistory();
      }).catch((error: unknown) =>
        logger?.error(error, 'Rate backfill failed'),
      );
    },
    async idle() {
      let tail: Promise<unknown>;
      do {
        tail = queue;
        await tail;
      } while (tail !== queue);
    },
    status() {
      const settings = family();
      if (!settings) throw new Error('First start has not been completed.');
      const now = clock.now();
      const today = todayInTimeZone(now, settings.time_zone);
      const used = usedCurrencies(settings.common_currency).filter(
        ({ code }) => code !== settings.common_currency,
      );
      const currencies = used
        .map(({ code }) => {
          const latest = sql().selectLatestRate.get(code, code) as
            { date: string; source: string } | undefined;
          return {
            code,
            latestDate: latest?.date ?? null,
            ageDays: latest
              ? Math.max(0, daysBetween(latest.date, today))
              : null,
            source: latest?.source ?? null,
          };
        })
        .sort((left, right) => left.code.localeCompare(right.code));
      const all = usedCurrencies(settings.common_currency);
      const feedStatuses = feeds
        .filter((feed) => all.some((currency) => feed.covers(currency)))
        .map((feed) => {
          const last = sql().selectLastFetch.get(feed.id) as
            { status: string; error: string | null; at: bigint } | undefined;
          const answered = (
            sql().selectLastAnswer.get(feed.id) as { at: bigint | null }
          ).at;
          return {
            id: feed.id,
            name: feed.source,
            lastFetchAt: last ? Number(last.at) : null,
            lastSuccessAt: answered === null ? null : Number(answered),
            lastError:
              last?.status === 'failed'
                ? {
                    message: last.error ?? 'Unknown error',
                    at: Number(last.at),
                  }
                : null,
          };
        });
      const answers = feedStatuses
        .map(({ lastSuccessAt }) => lastSuccessAt)
        .filter((at): at is number => at !== null);
      return {
        today,
        timeZone: settings.time_zone,
        commonCurrency: settings.common_currency,
        lastUpdatedAt: answers.length > 0 ? Math.max(...answers) : null,
        currencies,
        feeds: feedStatuses,
      };
    },
  };
}

/** Shortens an error to a message that fits the `rate_fetch.error` column. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, maxErrorLength);
}
