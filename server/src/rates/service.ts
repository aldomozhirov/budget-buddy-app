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

/** Thrown by `status` before the family exists, so no settings are known. */
export class FamilyNotSetUpError extends Error {
  constructor() {
    super('First start has not been completed.');
    this.name = 'FamilyNotSetUpError';
  }
}

/** Options for `createRatesService`. */
export interface RatesServiceOptions {
  database: Database.Database;
  clock: Clock;
  /** Every feed the service may call; each serves the currencies it covers. */
  feeds: readonly RateFeed[];
  logger?: RatesLogger;
  /**
   * Called after new rates are stored, such as to fill envelope amounts that
   * waited for a rate. A throw is logged and does not fail the fetch.
   */
  onRatesStored?: () => void;
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
   * (on accounts and envelopes) back to its earliest snapshot or
   * transaction (CUR-3). Returns at once and never throws; call it after a
   * write that adds a currency or an earlier date.
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
/**
 * Days fetched before the earliest snapshot, so a snapshot on a day with no
 * published rate (weekend, closing day, Russian January holidays) still has
 * an earlier rate to convert with (requirements 3.4).
 */
const historyMarginDays = 14;
/** A currency whose newest rate trails its feed's by more days is stale. */
const staleTailDays = 7;
const maxErrorLength = 500;
/**
 * How long a currency a feed reported a problem for is left alone. The job
 * retries each hour, so this only stops writes and the backfill that follows
 * a failed daily fetch from asking again at once.
 */
const problemRetryMs = 30 * 60_000;

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
  const { database, clock, feeds, logger, onRatesStored } = options;
  const ledgers = new Map<string, Ledger>();
  /**
   * When a feed last reported a problem for a currency, by `kind|feed|code`.
   * Backfill and daily problems are kept apart, so a history gap that keeps
   * failing never holds back the newest rate.
   */
  const problemAt = new Map<string, number>();
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
        `SELECT DISTINCT u.code, c.feed_id AS coinFeedId
    FROM (SELECT currency AS code FROM account
      UNION ALL SELECT currency FROM envelope) u
    LEFT JOIN coin c ON c.code = u.code`,
      ),
      selectCoin: database.prepare(
        'SELECT feed_id AS coinFeedId FROM coin WHERE code = ?',
      ),
      selectEarliest: database.prepare(
        `SELECT a.currency AS code, MIN(s.taken_at) AS takenAt
    FROM account a JOIN snapshot s ON s.account_id = a.id
    GROUP BY a.currency`,
      ),
      // Each side of a transaction in its account's currency, and an
      // expense in its envelope's (Design 3.11).
      selectEarliestTransactions: database.prepare(
        `SELECT code, MIN(date) AS date FROM (
      SELECT a.currency AS code, t.date FROM txn t
        JOIN account a ON a.id = t.account_id
      UNION ALL SELECT a.currency, t.date FROM txn t
        JOIN account a ON a.id = t.to_account_id
      UNION ALL SELECT e.currency, t.date FROM txn_part p
        JOIN txn t ON t.id = p.txn_id
        JOIN envelope e ON e.id = p.envelope_id)
    GROUP BY code`,
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
    for (const row of sql().selectEarliestTransactions.all() as {
      code: string;
      date: string;
    }[]) {
      const known = earliest.get(row.code);
      if (known === undefined || row.date < known) {
        earliest.set(row.code, row.date);
      }
      if (overall === undefined || row.date < overall) overall = row.date;
    }
    const fallback = shiftDate(today, -defaultLookbackDays);
    const wanted = new Map<string, string>();
    for (const { code } of used) {
      // Every conversion reaches the common currency, so it needs the whole
      // history, while the others need only their own.
      const from =
        code === commonCurrency ? overall : (earliest.get(code) ?? undefined);
      wanted.set(
        code,
        from === undefined || from > today
          ? fallback
          : shiftDate(from, -historyMarginDays),
      );
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

  /** Whether a feed reported a problem for `code` too recently to ask again. */
  function coolingDown(
    kind: 'daily' | 'backfill',
    feed: RateFeed,
    code: string,
  ): boolean {
    const at = problemAt.get(`${kind}|${feed.id}|${code}`);
    return at !== undefined && clock.now().getTime() - at < problemRetryMs;
  }

  /** Marks the dates as fetched for currencies the feed had no problem with. */
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
   * Moves the end of the ledgers forward after a daily fetch, so the tail
   * the daily job already stored is not fetched again as a gap. A currency
   * without a ledger is left alone: the backfill owns its start.
   */
  function advanceLedgers(
    feed: RateFeed,
    codes: readonly string[],
    to: string,
  ): void {
    for (const code of codes) {
      const known = ledgerFor(feed, code);
      if (known && known.to < to)
        ledgers.set(`${feed.id}|${code}`, { ...known, to });
    }
  }

  /**
   * Asks `feed` for `from` to `to` and stores what it sends, in one
   * transaction, so a feed that throws leaves the stored rates untouched.
   * Only rates of the requested currencies and dates are kept.
   * @param incomplete For a daily fetch: a covered currency was left out, so
   * the feed must not be recorded as `ok` for the target.
   * @returns The rates it sent that were in range, how many were new, and the
   * currencies the feed reported a problem for (not to be counted as fetched).
   * @throws The feed's own error, after recording it in `rate_fetch`.
   */
  async function fetchAndStore(
    feed: RateFeed,
    currencies: UsedCurrency[],
    from: string,
    to: string,
    today: string,
    kind: 'daily' | 'backfill',
    incomplete = false,
  ): Promise<{ rates: FeedRate[]; stored: number; problemCodes: Set<string> }> {
    const now = clock.now();
    const target = feed.targetDate(now, today);
    const recordedDate = kind === 'daily' ? target : to;
    try {
      const codes = new Set(currencies.map(({ code }) => code));
      const problems: string[] = [];
      const problemCodes = new Set<string>();
      const answer = await feed.fetch({
        currencies,
        from,
        to,
        today,
        now,
        reportProblem: (code, message) => {
          problems.push(`${code}: ${message}`);
          problemCodes.add(code);
        },
      });
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
      if (stored > 0 && onRatesStored) {
        try {
          onRatesStored();
        } catch (error) {
          logger?.error(error, 'Work after storing rates failed');
        }
      }
      const status =
        kind === 'backfill'
          ? 'backfilled'
          : rates.some(({ date }) => date === target) &&
              problems.length === 0 &&
              !incomplete
            ? 'ok'
            : 'unpublished';
      sql().insertFetch.run(feed.id, recordedDate, status, null, now.getTime());
      for (const { code } of currencies) {
        const key = `${kind}|${feed.id}|${code}`;
        if (problemCodes.has(code)) problemAt.set(key, now.getTime());
        else problemAt.delete(key);
      }
      if (problems.length > 0) {
        // The rates it did send stay; the error shows in the status sheet.
        const message = problems.join('; ').slice(0, maxErrorLength);
        sql().insertFetch.run(
          feed.id,
          recordedDate,
          'failed',
          message,
          clock.now().getTime(),
        );
        logger?.error(new Error(message), `Rates missing from ${feed.id}`);
      }
      return { rates, stored, problemCodes };
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
      if (coolingDown('backfill', feed, currency.code)) continue;
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
          const { problemCodes } = await fetchAndStore(
            feed,
            gap.currencies,
            gap.from,
            gap.to,
            today,
            'backfill',
          );
          widenLedger(
            feed,
            gap.currencies
              .map(({ code }) => code)
              .filter((code) => !problemCodes.has(code)),
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
      // A currency is asked for when its newest stored rate stops short of
      // the target, so one the feed failed on is asked again while the others
      // are not. The ledger cannot tell: a backfill widens it to today.
      const pending = new Map<UsedCurrency, string | null>();
      let skipped = false;
      for (const currency of covered) {
        if (coolingDown('daily', feed, currency.code)) {
          skipped = true;
          continue;
        }
        const stored = sql().selectSpan.get(
          feed.source,
          currency.code,
          currency.code,
        ) as { last: string | null };
        const last = stored.last ?? feedLast;
        if (last === null || last < target) pending.set(currency, last);
      }
      if (pending.size === 0) continue;
      const from = [...pending.values()]
        .map((last) =>
          last === null
            ? shiftDate(target, -defaultLookbackDays)
            : shiftDate(last, 1),
        )
        .reduce((earliest, date) => (date < earliest ? date : earliest));
      try {
        const { rates, stored, problemCodes } = await fetchAndStore(
          feed,
          [...pending.keys()],
          from,
          target,
          today,
          'daily',
          skipped,
        );
        result.stored += stored;
        const answeredTo = rates.reduce(
          (latest, { date }) => (date > latest ? date : latest),
          '',
        );
        advanceLedgers(
          feed,
          [...pending.keys()]
            .map(({ code }) => code)
            .filter((code) => !problemCodes.has(code)),
          answeredTo,
        );
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
      if (!settings) throw new FamilyNotSetUpError();
      const now = clock.now();
      const today = todayInTimeZone(now, settings.time_zone);
      const used = usedCurrencies(settings.common_currency).filter(
        ({ code }) => code !== settings.common_currency,
      );
      const common = usedCurrencies(settings.common_currency).find(
        ({ code }) => code === settings.common_currency,
      );
      const currencies = used
        .map((currency) => {
          // The newest rate of the feeds that serve the currency, so another
          // feed's pair (USD to RUB) never makes a stale USD look fresh. A
          // currency no feed serves (the euro, when it is not the common
          // currency) is judged by the feeds of the common currency.
          let sources = feeds
            .filter((feed) => feed.covers(currency))
            .map((feed) => feed.source);
          if (sources.length === 0 && common) {
            sources = feeds
              .filter((feed) => feed.covers(common))
              .map((feed) => feed.source);
          }
          const latest =
            sources.length === 0
              ? undefined
              : (database
                  .prepare(
                    `SELECT date, source FROM rate
                    WHERE source IN (${sources.map(() => '?').join(', ')})
                      AND (base = ? OR quote = ?)
                    ORDER BY date DESC, id DESC LIMIT 1`,
                  )
                  .get(...sources, currency.code, currency.code) as
                  { date: string; source: string } | undefined);
          const code = currency.code;
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
