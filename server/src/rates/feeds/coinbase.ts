import { shiftDate, utcDate } from '../dates.js';
import { assertRateText, type FeedRate, type RateFeed } from '../feed.js';
import type { RateHttpClient } from '../http.js';

const baseUrl = 'https://api.exchange.coinbase.com/products';

/** Most daily candles one request returns. */
const windowDays = 300;

/**
 * Reads Coinbase daily candles, `[time, low, high, open, close, volume]`,
 * into the close price of each UTC day, in the product's quote currency.
 * The close is stored as the shortest decimal of the JSON number and is
 * never the result of arithmetic. A candle without a positive close is left
 * out.
 * @throws {RangeError} when the text is not a list of candles, or a price
 * would need exponent notation.
 */
export function parseCoinbaseCandles(
  json: string,
  base: string,
  quote: string,
): FeedRate[] {
  let candles: unknown;
  try {
    candles = JSON.parse(json);
  } catch {
    throw new RangeError('Coinbase: the answer is not JSON');
  }
  if (!Array.isArray(candles)) {
    throw new RangeError(`Coinbase: unexpected answer for ${base}-${quote}`);
  }
  const rates: FeedRate[] = [];
  for (const candle of candles) {
    if (!Array.isArray(candle)) {
      throw new RangeError(`Coinbase: unreadable candle for ${base}-${quote}`);
    }
    const [time, , , , close] = candle as unknown[];
    if (typeof time !== 'number' || typeof close !== 'number') {
      throw new RangeError(`Coinbase: unreadable candle for ${base}-${quote}`);
    }
    if (!(close > 0)) continue;
    const text = String(close);
    if (/e/i.test(text)) {
      throw new RangeError(
        `Coinbase: ${base}-${quote} price ${text} is too small`,
      );
    }
    const date = utcDate(new Date(time * 1000));
    rates.push({
      base,
      quote,
      date,
      rate: assertRateText(text, `Coinbase ${base}-${quote} ${date}`),
    });
  }
  return rates;
}

/**
 * Coinbase Exchange public daily candles for coins whose product is
 * `<COIN>-EUR`. Rates are stored as the coin to `EUR`. A UTC day is stored
 * only once it is over, since stored rates are never rewritten.
 */
export function createCoinbaseFeed(http: RateHttpClient): RateFeed {
  return {
    id: 'coinbase',
    source: 'Coinbase Exchange',
    covers: ({ coinFeedId }) =>
      coinFeedId !== null && /^[A-Z0-9]+-EUR$/.test(coinFeedId),
    targetDate: (now) => shiftDate(utcDate(now), -1),
    async fetch({ currencies, from, to, now }) {
      const lastComplete = shiftDate(utcDate(now), -1);
      const last = to < lastComplete ? to : lastComplete;
      const rates: FeedRate[] = [];
      for (const { code, coinFeedId } of currencies) {
        if (coinFeedId === null) continue;
        const quote = coinFeedId.slice(coinFeedId.lastIndexOf('-') + 1);
        for (
          let start = from;
          start <= last;
          start = shiftDate(start, windowDays)
        ) {
          const end = shiftDate(start, windowDays - 1);
          const windowEnd = end < last ? end : last;
          const json = await http.getText(
            `${baseUrl}/${coinFeedId}/candles?granularity=86400` +
              `&start=${start}T00:00:00Z&end=${windowEnd}T00:00:00Z`,
          );
          rates.push(...parseCoinbaseCandles(json, code, quote));
        }
      }
      return rates;
    },
  };
}
