import { isoWeekday, shiftDate } from '../dates.js';
import { assertRateText, type FeedRate, type RateFeed } from '../feed.js';
import type { RateHttpClient } from '../http.js';

const baseUrl = 'https://www.cbr.ru/scripts';

/** Bank of Russia ids of the two currencies the rouble is priced against. */
const currencyIds = { EUR: 'R01239', USD: 'R01235' } as const;

/** `YYYY-MM-DD` as the `DD/MM/YYYY` the Bank of Russia asks for. */
function requestDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** `DD.MM.YYYY` as printed by the Bank of Russia, as `YYYY-MM-DD`. */
function parseLabel(label: string | undefined): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(label ?? '');
  if (!match)
    throw new RangeError(`Bank of Russia: unreadable date "${label}"`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]?.trim();
}

/** The rouble price of one unit, from a `Valute` or `Record` block. */
function unitRate(block: string, context: string): string {
  const unit = tag(block, 'VunitRate');
  const text =
    unit ?? (tag(block, 'Nominal') === '1' ? tag(block, 'Value') : '');
  return assertRateText((text ?? '').replace(',', '.'), context);
}

/**
 * Reads the Bank of Russia daily file into rouble prices of the euro and the
 * US dollar. The file answers an earlier date's rates for a day without one,
 * and says so in its date, which is kept as the rate's date.
 * @throws {RangeError} when the text is not a Bank of Russia daily file.
 */
export function parseCbrDaily(xml: string): FeedRate[] {
  const header = /<ValCurs\b[^>]*\bDate="([^"]*)"/.exec(xml);
  if (!header) throw new RangeError('Bank of Russia: not a daily rate file');
  const date = parseLabel(header[1]);
  const rates: FeedRate[] = [];
  for (const [, block = ''] of xml.matchAll(
    /<Valute\b[^>]*>(.*?)<\/Valute>/gs,
  )) {
    const code = tag(block, 'CharCode');
    if (code !== 'EUR' && code !== 'USD') continue;
    rates.push({
      base: code,
      quote: 'RUB',
      date,
      rate: unitRate(block, `Bank of Russia ${code} ${date}`),
    });
  }
  return rates;
}

/**
 * Reads a Bank of Russia range file of one currency into its rouble prices.
 * @throws {RangeError} when the text is not a Bank of Russia range file.
 */
export function parseCbrDynamic(xml: string, base: 'EUR' | 'USD'): FeedRate[] {
  if (!/<ValCurs\b/.test(xml)) {
    throw new RangeError('Bank of Russia: not a range rate file');
  }
  const rates: FeedRate[] = [];
  for (const [, attributeText = '', block = ''] of xml.matchAll(
    /<Record\b([^>]*)>(.*?)<\/Record>/gs,
  )) {
    const date = parseLabel(/\bDate="([^"]*)"/.exec(attributeText)?.[1]);
    rates.push({
      base,
      quote: 'RUB',
      date,
      rate: unitRate(block, `Bank of Russia ${base} ${date}`),
    });
  }
  return rates;
}

/**
 * The Bank of Russia rates, for the rouble only. Rates are stored as
 * `EUR` and `USD` to `RUB`, the roubles in one unit.
 */
export function createCbrFeed(http: RateHttpClient): RateFeed {
  return {
    id: 'cbr',
    source: 'Bank of Russia',
    covers: ({ code, coinFeedId }) => coinFeedId === null && code === 'RUB',
    targetDate(_now, today) {
      // A rate is dated the day it takes effect and none is set for Sundays
      // and Mondays, so those days settle for Saturday's.
      const weekday = isoWeekday(today);
      return weekday === 7
        ? shiftDate(today, -1)
        : weekday === 1
          ? shiftDate(today, -2)
          : today;
    },
    async fetch({ from, to }) {
      if (from === to) {
        const xml = await http.getText(
          `${baseUrl}/XML_daily_eng.asp?date_req=${requestDate(to)}`,
          { encoding: 'windows-1251' },
        );
        return parseCbrDaily(xml);
      }
      const rates: FeedRate[] = [];
      for (const base of ['EUR', 'USD'] as const) {
        const xml = await http.getText(
          `${baseUrl}/XML_dynamic.asp?date_req1=${requestDate(from)}` +
            `&date_req2=${requestDate(to)}&VAL_NM_RQ=${currencyIds[base]}`,
          { encoding: 'windows-1251' },
        );
        rates.push(...parseCbrDynamic(xml, base));
      }
      return rates;
    },
  };
}
