import { afterEach, beforeEach, expect, it } from 'vitest';
import { getCheckinSummary } from '../src/domain/summary.js';
import { getWealthSeries } from '../src/domain/wealthSeries.js';
import {
  createFamilyDatabase,
  type FamilyDatabase,
} from './summary-fixture.js';

const accountCount = 40;
const checkinCount = 120;
const budgetMs = 200;
const currencies = ['EUR', 'USD', 'RUB', 'BTC'];

let family: FamilyDatabase;
let lastCheckin: number;
let now: number;

/** PRF-1 volume: 40 accounts, 120 monthly check-ins, ten years of daily rates. */
beforeEach(async () => {
  family = await createFamilyDatabase();
  const { database } = family;
  const firstClose = Date.parse('2016-10-01T10:00:00Z');
  const day = 86_400_000;
  const rateDays = 10 * 365 + 10;
  database.transaction(() => {
    const accounts = Array.from({ length: accountCount }, (_, index) =>
      family.account({
        name: `Account ${index}`,
        owner: index % 2 === 0 ? 'Alex' : 'Blair',
        type: index % 4 === 0 ? 'crypto' : 'bank',
        currency: currencies[index % currencies.length] ?? 'EUR',
      }),
    );
    for (let month = 0; month < checkinCount; month += 1) {
      // About one month apart, so 120 of them span ten years.
      const closedAt = firstClose + month * 30 * day;
      const id = family.checkin({ openedAt: closedAt - 3_600_000, closedAt });
      accounts.forEach((accountId, index) => {
        family.snapshot({
          accountId,
          takenAt: closedAt - 1_800_000,
          amount: BigInt(100_000 + index * 1_000 + month * 37),
          source: 'checkin',
          checkinId: id,
        });
      });
      lastCheckin = id;
    }
    for (let offset = 0; offset < rateDays; offset += 1) {
      const date = new Date(firstClose + (offset - 5) * day)
        .toISOString()
        .slice(0, 10);
      family.rate('EUR', 'USD', date, (1.05 + (offset % 50) / 1000).toFixed(4));
      family.rate('EUR', 'RUB', date, (90 + (offset % 40) / 10).toFixed(2));
      family.rate('BTC', 'EUR', date, (20_000 + offset * 3).toString());
    }
  })();
  now = firstClose + checkinCount * 30 * day;
});

afterEach(async () => {
  await family.close();
});

it('computes a summary and the chart series in under 200 ms (PRF-1)', () => {
  const started = performance.now();
  const summary = getCheckinSummary(family.database, lastCheckin);
  const dated = getWealthSeries(family.database, {
    view: 'equivalent',
    rates: 'dated',
    now,
  });
  const today = getWealthSeries(family.database, {
    view: 'equivalent',
    rates: 'today',
    now,
  });
  const single = getWealthSeries(family.database, {
    view: 'currency',
    currency: 'USD',
    rates: 'dated',
    now,
  });
  const elapsed = performance.now() - started;

  expect(summary.status).toBe('ok');
  for (const result of [dated, today, single]) {
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.series.points).toHaveLength(checkinCount);
      expect(result.series.incomplete).toBe(false);
    }
  }
  expect(elapsed, `took ${elapsed.toFixed(1)} ms`).toBeLessThan(budgetMs);
});
