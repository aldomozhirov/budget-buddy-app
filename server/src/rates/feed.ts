/** A currency in use that a feed may be asked to price. */
export interface UsedCurrency {
  /** ISO 4217 code or coin ticker. */
  code: string;
  /** The coin's product id at its feed (`BTC-EUR`); null for ISO currencies. */
  coinFeedId: string | null;
}

/** One rate as a feed publishes it, before it is stored. */
export interface FeedRate {
  /** Currency being priced. */
  base: string;
  /** Currency the price is in. */
  quote: string;
  /** The feed's own date label, YYYY-MM-DD. */
  date: string;
  /** Exact decimal string: units of `quote` per one unit of `base`. */
  rate: string;
}

/** What `RateFeed.fetch` is asked for. */
export interface FeedRequest {
  /** Only these currencies may appear in the answer. */
  currencies: readonly UsedCurrency[];
  /** First date wanted, YYYY-MM-DD. */
  from: string;
  /** Last date wanted, YYYY-MM-DD. */
  to: string;
  /** Today's date in the family's time zone, YYYY-MM-DD. */
  today: string;
  /** The current instant, for feeds that publish by their own calendar. */
  now: Date;
  /**
   * Lets a feed that serves each currency separately report one it could not
   * get without failing the others. The rates it did get are stored and the
   * message is recorded as an error. A feed that cannot report rethrows.
   */
  reportProblem?(message: string): void;
}

/**
 * The one interface the rates service reaches a price feed through (CUR-7).
 * A feed can be replaced without touching the rest of the app.
 */
export interface RateFeed {
  /** Stable name recorded in `rate_fetch.feed_id`. */
  readonly id: string;
  /** Who published the rates; stored in `rate.source` and shown as credit. */
  readonly source: string;
  /** Whether this feed supplies rates for `currency`. */
  covers(currency: UsedCurrency): boolean;
  /**
   * The newest date this feed should have published at `now`. The hourly
   * retry stops once a fetch returns a rate of that date.
   * @param today The family's local date, YYYY-MM-DD.
   */
  targetDate(now: Date, today: string): string;
  /**
   * Fetches the rates dated `from` to `to` for the requested currencies.
   * Dates the feed has no rate for are left out; the answer may also carry
   * dates outside the range, which the caller drops.
   * @throws When the feed is unreachable, answers with an error or sends
   * data that cannot be read. Nothing is returned in that case, never part
   * of an answer.
   */
  fetch(request: FeedRequest): Promise<FeedRate[]>;
}

/** Matches an exact positive decimal such as `1.1177` or `100`. */
const decimalPattern = /^\d+(\.\d+)?$/;

/**
 * Checks that a rate text is an exact positive decimal and returns it.
 * @throws {RangeError} when it is not, so a bad feed never stores garbage.
 */
export function assertRateText(text: string, context: string): string {
  if (!decimalPattern.test(text) || /^0+(\.0+)?$/.test(text)) {
    throw new RangeError(`${context}: unreadable rate "${text.slice(0, 40)}"`);
  }
  return text;
}
