import { describe, expect, it } from 'vitest';
import type { Wish } from '@budget-buddy/shared';
import {
  EARLIEST_MONTH,
  cardDetail,
  cardFigures,
  doneDetail,
  hasNextMonth,
  hasPreviousMonth,
  monthRelation,
  summaryLine,
} from '../src/screens/wishes/wishesFormat';

function wish(overrides: Partial<Wish>): Wish {
  return {
    id: 1,
    month: '2026-11',
    name: 'Winter tyres',
    amount: '48000',
    expression: null,
    currency: 'EUR',
    categoryId: null,
    categoryName: null,
    note: null,
    state: 'open',
    spent: '0',
    left: '48000',
    over: '0',
    under: '0',
    incomplete: false,
    expenseCount: 0,
    expenses: [],
    createdBy: 1,
    createdByName: 'Alena',
    createdAt: 0,
    updatedBy: 1,
    updatedByName: 'Alena',
    updatedAt: 0,
    ...overrides,
  };
}

const money = (minor: string) => `€${(Number(minor) / 100).toFixed(2)}`;

describe('monthRelation', () => {
  it('names this, last and next month', () => {
    expect(monthRelation('2026-11', '2026-11')).toBe('This month');
    expect(monthRelation('2026-10', '2026-11')).toBe('Last month');
    expect(monthRelation('2026-12', '2026-11')).toBe('Next month · plan ahead');
  });

  it('counts across a year boundary', () => {
    expect(monthRelation('2027-01', '2026-12')).toBe('Next month · plan ahead');
    expect(monthRelation('2026-12', '2027-01')).toBe('Last month');
  });

  it('says how far away any other month is', () => {
    expect(monthRelation('2026-08', '2026-11')).toBe('3 months ago');
    expect(monthRelation('2027-02', '2026-11')).toBe(
      'In 3 months · plan ahead',
    );
  });
});

describe('month arrows', () => {
  it('stops going back at the earliest month the server serves', () => {
    expect(hasPreviousMonth('2026-11')).toBe(true);
    expect(hasPreviousMonth('2000-02')).toBe(true);
    expect(hasPreviousMonth(EARLIEST_MONTH)).toBe(false);
  });

  it('goes forward only to the month after the current one', () => {
    expect(hasNextMonth('2026-11', '2026-11')).toBe(true);
    expect(hasNextMonth('2026-12', '2026-11')).toBe(false);
    expect(hasNextMonth('2027-01', '2026-12')).toBe(false);
    expect(hasNextMonth('2026-12', '2026-12')).toBe(true);
  });
});

describe('summaryLine', () => {
  it('pluralises the wishes', () => {
    expect(summaryLine({ total: 3, open: 2 })).toBe('3 wishes · 2 open');
    expect(summaryLine({ total: 1, open: 1 })).toBe('1 wish · 1 open');
    expect(summaryLine({ total: 2, open: 0 })).toBe('2 wishes · 0 open');
  });
});

describe('cardFigures', () => {
  it('says "to spend" while nothing is spent', () => {
    expect(cardFigures(wish({}))).toEqual({
      headline: 48000n,
      unit: 'to spend',
      spent: 0,
      total: 48000,
    });
  });

  it('says "left" when an expense has no amount yet', () => {
    expect(cardFigures(wish({ expenseCount: 1, incomplete: true })).unit).toBe(
      'left',
    );
  });

  it('says "left" once something is spent', () => {
    const figures = cardFigures(
      wish({ amount: '35000', spent: '12000', left: '23000' }),
    );
    expect(figures.unit).toBe('left');
    expect(figures.headline).toBe(23000n);
    expect(figures.spent).toBe(12000);
  });

  it('says "over" with how far past the amount, and "left" at exactly zero', () => {
    const over = cardFigures(
      wish({ amount: '10000', spent: '11200', left: '-1200', over: '1200' }),
    );
    expect(over.unit).toBe('over');
    expect(over.headline).toBe(1200n);
    const exact = cardFigures(
      wish({ amount: '10000', spent: '10000', left: '0' }),
    );
    expect(exact).toMatchObject({ unit: 'left', headline: 0n });
  });
});

describe('cardDetail', () => {
  it('reads "Nothing spent yet" for an untouched wish', () => {
    expect(cardDetail(wish({}), money)).toBe('Nothing spent yet · €480.00');
  });

  it('counts the expenses, in the singular and the plural', () => {
    const one = wish({
      amount: '35000',
      spent: '12000',
      left: '23000',
      expenseCount: 1,
    });
    expect(cardDetail(one, money)).toBe('€120.00 spent of €350.00 · 1 expense');
    expect(cardDetail({ ...one, expenseCount: 2 }, money)).toBe(
      '€120.00 spent of €350.00 · 2 expenses',
    );
  });

  it('adds "Rate missing" when an expense has no amount yet', () => {
    expect(cardDetail(wish({ expenseCount: 1, incomplete: true }), money)).toBe(
      '€0.00 spent of €480.00 · 1 expense · Rate missing',
    );
    expect(cardDetail(wish({ incomplete: true }), money)).toBe(
      'Nothing spent yet · €480.00 · Rate missing',
    );
  });
});

describe('doneDetail', () => {
  it('shows how far under the amount a done wish ended', () => {
    expect(
      doneDetail(
        wish({
          state: 'done',
          amount: '15000',
          spent: '13780',
          left: '1220',
          under: '1220',
          expenseCount: 2,
        }),
        money,
      ),
    ).toBe('€137.80 of €150.00 · €12.20 under');
  });

  it('shows how far over, and nothing when it ended on the amount', () => {
    expect(
      doneDetail(
        wish({
          state: 'done',
          amount: '10000',
          spent: '11200',
          left: '-1200',
          over: '1200',
        }),
        money,
      ),
    ).toBe('€112.00 of €100.00 · €12.00 over');
    expect(
      doneDetail(
        wish({ state: 'done', amount: '10000', spent: '10000', left: '0' }),
        money,
      ),
    ).toBe('€100.00 of €100.00');
  });

  it('says "nothing spent" for a dropped wish with no expenses', () => {
    expect(doneDetail(wish({ state: 'dropped', amount: '20000' }), money)).toBe(
      '€200.00 · nothing spent',
    );
  });

  it('adds "Rate missing" even when nothing is counted yet', () => {
    expect(
      doneDetail(
        wish({ state: 'done', amount: '20000', incomplete: true }),
        money,
      ),
    ).toBe('€0.00 of €200.00 · Rate missing');
  });
});
