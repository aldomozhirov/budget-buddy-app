import { describe, expect, it } from 'vitest';
import type { WealthSeries } from '@budget-buddy/shared';
import {
  accountLabel,
  createMoneyFormatter,
  trendsFromSeries,
  trendText,
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
    expect(trendText(null)).toBe('Rate missing');
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
