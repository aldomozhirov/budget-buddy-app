import { daysBetween, datesBetween, isoWeekday, shiftDate } from './dates.js';
import type { FeedRate, RateFeed, UsedCurrency } from './feed.js';

/** Starting points, in units of the quote currency per base, times 10 000. */
const seedRates: Record<string, bigint> = {
  USD: 11_177n,
  GBP: 8_465n,
  CHF: 9_309n,
  JPY: 1_768_500n,
  RUB: 950_000n,
  BTC: 700_000_000n,
  ETH: 30_000_000n,
  USDT: 9_000n,
};

/** A fixed starting point for codes the table does not know. */
function seedFor(code: string): bigint {
  const known = seedRates[code];
  if (known !== undefined) return known;
  let sum = 0;
  for (const char of code) sum += char.charCodeAt(0);
  return BigInt(10_000 + (sum % 50) * 1_000);
}

/** Formats rate units of 1/10 000 as an exact four-decimal string. */
function formatRate(units: bigint): string {
  const text = units.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}

/** The rate of `currency` on `date`, wobbling by up to 0.5% around its seed. */
function fixtureRate(currency: UsedCurrency, date: string): FeedRate {
  const seed = seedFor(currency.code);
  const step = seed / 2_000n || 1n;
  const wobble = BigInt(((daysBetween('2000-01-01', date) * 7) % 21) - 10);
  const rate = formatRate(seed + wobble * step);
  return currency.coinFeedId === null
    ? { base: 'EUR', quote: currency.code, date, rate }
    : { base: currency.code, quote: 'EUR', date, rate };
}

/**
 * A feed with made-up rates, for tests, end-to-end runs and development
 * (`RATES_FEED=fixture`). It never touches the network. Like the ECB it
 * publishes on working days only, the day itself, and covers every currency
 * except the euro: ISO currencies as `EUR` to the currency, coins as the coin
 * to `EUR`.
 */
export function createFixtureFeed(): RateFeed {
  return {
    id: 'fixture',
    source: 'Fixture rates',
    covers: ({ code }) => code !== 'EUR',
    targetDate(_now, today) {
      const weekday = isoWeekday(today);
      return weekday >= 6 ? shiftDate(today, 5 - weekday) : today;
    },
    fetch({ currencies, from, to, today }) {
      const last = to < today ? to : today;
      const rates: FeedRate[] = [];
      for (const date of from > last ? [] : datesBetween(from, last)) {
        if (isoWeekday(date) >= 6) continue;
        for (const currency of currencies) {
          if (currency.code !== 'EUR') rates.push(fixtureRate(currency, date));
        }
      }
      return Promise.resolve(rates);
    },
  };
}
