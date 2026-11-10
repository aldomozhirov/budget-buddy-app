import { describe, expect, it } from 'vitest';
import type { WealthSeries } from '@budget-buddy/shared';
import {
  accountLabel,
  chartPoints,
  createMoneyFormatter,
  missingRatesText,
  trendsFromSeries,
  trendText,
  wealthChartSummary,
} from '../src/screens/summary/summaryFormat';

const formatter = createMoneyFormatter([
  { code: 'BTC', name: 'Bitcoin', decimals: 8 },
]);

function series(amounts: (string | null)[]): WealthSeries {
  return {
    view: 'equivalent',
    currency: 'EUR',
    rates: 'dated',
    currencies: ['EUR'],
    incomplete: amounts.includes(null),
    points: amounts.map((amount, index) => ({
      checkinId: index + 1,
      closedAt: index,
      date: '2026-09-02',
      amount,
    })),
  };
}

describe('createMoneyFormatter', () => {
  it('formats amounts, changes and signed lines with U+2212 minus', () => {
    expect(formatter.money('8421500', 'EUR')).toBe('€84,215.00');
    expect(formatter.change('-470000', 'RUB')).toBe('▼ ₽4,700.00');
    expect(formatter.change('0', 'EUR')).toBe('Unchanged');
    expect(formatter.signed('183840', 'EUR')).toBe('+€1,838.40');
    expect(formatter.signed('-9640', 'EUR')).toBe('−€96.40');
    expect(formatter.signed('0', 'EUR')).toBe('€0.00');
    expect(formatter.money('4120000', 'BTC')).toBe('₿0.04120000');
  });

  it('shows a dash, not raw minor units, for a currency it does not know', () => {
    expect(formatter.money('123456', 'XYZ')).toBe('— XYZ');
    expect(formatter.change('-123456', 'XYZ')).toBe('— XYZ');
    expect(formatter.signed('123456', 'XYZ')).toBe('— XYZ');
    expect(formatter.masked('XYZ')).toBe('XYZ • • • • •');
  });

  it('masks with the currency symbol and never shows digits', () => {
    expect(formatter.masked('EUR')).toBe('€ • • • • •');
    expect(formatter.masked('BTC')).toBe('₿ • • • • •');
  });

  it('keeps amounts above 2^53 exact', () => {
    expect(formatter.money('9007199254740993', 'JPY')).toBe(
      '¥9,007,199,254,740,993',
    );
  });
});

describe('trendsFromSeries', () => {
  it('compares each check-in with the one before it', () => {
    const trends = trendsFromSeries(series(['100', '150', '150', '90']));
    expect([...trends.values()].map((entry) => entry.trend)).toEqual([
      'first',
      'up',
      'unchanged',
      'down',
    ]);
  });

  it('has no direction next to a point that lacks a rate', () => {
    const trends = trendsFromSeries(series(['100', null, '120']));
    expect([...trends.values()].map((entry) => entry.trend)).toEqual([
      'first',
      null,
      null,
    ]);
  });

  it('adds no row for the Start point and keeps the oldest check-in first', () => {
    const withStart = series(['100', '150', '90']);
    withStart.points = [
      { checkinId: null, closedAt: -1, date: '2026-08-20', amount: '50' },
      ...withStart.points,
    ];
    const trends = trendsFromSeries(withStart);
    expect([...trends.keys()]).toEqual([1, 2, 3]);
    expect([...trends.values()]).toEqual([
      { total: '100', trend: 'first' },
      { total: '150', trend: 'up' },
      { total: '90', trend: 'down' },
    ]);
  });
});

describe('chartPoints', () => {
  function withStart(amounts: (string | null)[]): WealthSeries {
    const base = series(amounts.slice(1));
    base.points = [
      {
        checkinId: null,
        closedAt: -1,
        date: '2026-08-20',
        amount: amounts[0]!,
      },
      ...base.points,
    ];
    base.incomplete = amounts.includes(null);
    return base;
  }

  it('marks the Start point at the opening balances', () => {
    const points = chartPoints(
      withStart(['50', '100', '150']),
      formatter,
      'UTC',
    );
    expect(points.map((point) => point.start)).toEqual([true, false, false]);
    expect(points[0]).toMatchObject({
      date: '20/08/2026',
      tick: 'Aug 26',
      value: 50n,
      label: '€0.50',
    });
  });

  it('draws a line from the Start and one check-in', () => {
    expect(
      chartPoints(withStart(['50', '100']), formatter, 'UTC'),
    ).toHaveLength(2);
  });

  it('leaves out a Start that lacks a rate, so no check-in is taken for it', () => {
    const points = chartPoints(
      withStart([null, '100', '150']),
      formatter,
      'UTC',
    );
    expect(points.map((point) => point.value)).toEqual([100n, 150n]);
    expect(points.map((point) => point.start)).toEqual([false, false]);
  });

  it('keeps one check-in as a plain point when the Start lacks a rate', () => {
    const points = chartPoints(withStart([null, '100']), formatter, 'UTC');
    expect(points).toHaveLength(1);
    expect(points[0]?.start).toBe(false);
  });
});

describe('trendText', () => {
  it('words each direction, and says nothing without a comparison', () => {
    expect(trendText('up')).toBe('▲ up');
    expect(trendText('down')).toBe('▼ down');
    expect(trendText('unchanged')).toBe('Unchanged');
    expect(trendText('first')).toBe('Start');
    expect(trendText(null)).toBe('');
  });
});

describe('accountLabel', () => {
  it('names the owner, unless the account is shared', () => {
    expect(accountLabel({ name: 'Cash €', ownerName: 'Sofia' })).toBe(
      'Sofia’s Cash €',
    );
    expect(accountLabel({ name: 'Joint', ownerName: null })).toBe('Joint');
  });
});

describe('missingRatesText', () => {
  const missing = [{ currency: 'RUB', date: '2026-09-02' }];

  it('calls the total incomplete only when it is', () => {
    expect(missingRatesText(missing, 'UTC', false)).toBe(
      'Rate missing for RUB on 02/09/2026. The total is incomplete.',
    );
    expect(missingRatesText(missing, 'UTC', true)).toBe(
      'Rate missing for RUB on 02/09/2026.',
    );
  });
});

describe('wealthChartSummary', () => {
  it('counts check-ins, in the singular for one', () => {
    expect(wealthChartSummary('All in EUR', ['02/09/2026'])).toBe(
      'All in EUR over 1 check-in, from 02/09/2026 to 02/09/2026',
    );
    expect(wealthChartSummary('USD', ['01/08/2026', '02/09/2026'])).toBe(
      'USD over 2 check-ins, from 01/08/2026 to 02/09/2026',
    );
    expect(wealthChartSummary('EUR', [])).toBe(
      'EUR over 0 check-ins, from the first date to the latest date',
    );
  });

  it('does not count the Start point at the opening balances', () => {
    expect(
      wealthChartSummary('All in EUR', ['20/08/2026', '02/09/2026'], true),
    ).toBe(
      'All in EUR from the opening balances over 1 check-in, from 20/08/2026 to 02/09/2026',
    );
  });
});
