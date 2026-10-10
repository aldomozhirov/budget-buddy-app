import { daysBetween, isoWeekday, shiftDate } from '../dates.js';
import { assertRateText, type FeedRate, type RateFeed } from '../feed.js';
import type { RateHttpClient } from '../http.js';

const baseUrl = 'https://www.ecb.europa.eu/stats/eurofxref';

/** The 90-day file reaches back about 89 days; leave a margin. */
const ninetyDayReach = 80;

/** Matches one `<Cube ...>` element and captures its attributes. */
const cubePattern = /<Cube\b([^>]*?)\/?>/g;
const attributePattern = /([A-Za-z]+)=(['"])(.*?)\2/g;

function attributes(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, , value] of text.matchAll(attributePattern)) {
    if (name !== undefined && value !== undefined) found[name] = value;
  }
  return found;
}

/**
 * Reads the euro foreign exchange reference rates (daily, 90-day or full
 * history file) into EUR-to-currency rates for the wanted currencies.
 * @throws {RangeError} when the text is not an ECB rate file.
 */
export function parseEcbRates(
  xml: string,
  wanted: ReadonlySet<string>,
): FeedRate[] {
  if (!xml.includes('<Cube')) {
    throw new RangeError('ECB: the answer is not a rate file');
  }
  const rates: FeedRate[] = [];
  let date: string | undefined;
  for (const [, attributeText = ''] of xml.matchAll(cubePattern)) {
    const cube = attributes(attributeText);
    if (cube.time !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cube.time)) {
        throw new RangeError(`ECB: unreadable date "${cube.time}"`);
      }
      date = cube.time;
    } else if (cube.currency !== undefined && cube.rate !== undefined) {
      if (date === undefined || !wanted.has(cube.currency)) continue;
      rates.push({
        base: 'EUR',
        quote: cube.currency,
        date,
        rate: assertRateText(cube.rate, `ECB ${cube.currency} ${date}`),
      });
    }
  }
  return rates;
}

/**
 * The ECB reference rates: every ISO currency it lists except the euro itself
 * and the rouble, whose last ECB rate is from 2022. Rates are stored as
 * `EUR` to the currency.
 */
export function createEcbFeed(http: RateHttpClient): RateFeed {
  return {
    id: 'ecb',
    source: 'European Central Bank',
    covers: ({ code, coinFeedId }) =>
      coinFeedId === null && code !== 'EUR' && code !== 'RUB',
    targetDate(_now, today) {
      // Published on working days only, around 16:00 Frankfurt time.
      const weekday = isoWeekday(today);
      return weekday >= 6 ? shiftDate(today, 5 - weekday) : today;
    },
    async fetch({ currencies, from, today }) {
      const age = daysBetween(from, today);
      const file =
        age <= 0
          ? 'eurofxref-daily.xml'
          : age <= ninetyDayReach
            ? 'eurofxref-hist-90d.xml'
            : 'eurofxref-hist.xml';
      const xml = await http.getText(`${baseUrl}/${file}`);
      return parseEcbRates(xml, new Set(currencies.map(({ code }) => code)));
    },
  };
}
