import { describe, expect, it } from 'vitest';
import { getCurrency, type Envelope } from '@budget-buddy/shared';
import {
  cardFigures,
  shortDate,
  topUpLine,
} from '../src/screens/envelopes/envelopeFormat';

const eur = getCurrency('EUR')!;

function envelope(overrides: Partial<Envelope>): Envelope {
  return {
    id: 1,
    name: 'Groceries',
    currency: 'EUR',
    startingBalance: '0',
    startingMonth: '2026-05',
    defaultCategoryId: null,
    position: 1,
    archived: false,
    archivedAt: null,
    plan: { fromMonth: '2026-05', monthlyAmount: '50000', mode: 'reset' },
    pendingPlan: null,
    current: {
      month: '2026-10',
      opening: '0',
      topUp: '50000',
      topUpMode: 'reset',
      dropped: null,
      adjustments: '0',
      spent: '31240',
      available: '50000',
      closing: '18760',
      result: '18760',
      closed: false,
      withinBudget: null,
      incomplete: false,
      closingIncomplete: false,
    },
    overspent: false,
    used: true,
    expenseCount: 9,
    monthExpenseCount: 6,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('envelope card figures', () => {
  it('counts the month’s expenses on a reset envelope', () => {
    expect(cardFigures(envelope({}), eur, '2026-10')).toMatchObject({
      left: 18760n,
      detail: '€312.40 spent of €500.00 · 6 expenses',
    });
  });

  it('says "starting balance" in the starting month', () => {
    const figures = cardFigures(
      envelope({ startingMonth: '2026-10', monthExpenseCount: 0 }),
      eur,
      '2026-10',
    );
    expect(figures.detail).toBe('€312.40 spent of €500.00 · starting balance');
  });

  it('names what a carry-over envelope carried', () => {
    const base = envelope({});
    const figures = cardFigures(
      envelope({
        current: {
          ...base.current!,
          topUpMode: 'carry_over',
          topUp: '30000',
          opening: '12000',
          available: '42000',
          spent: '4500',
          closing: '37500',
        },
      }),
      eur,
      '2026-10',
    );
    expect(figures.detail).toBe(
      '€45.00 spent of €420.00 · €300.00 + €120.00 carried from September',
    );
  });

  it('uses the singular for one expense', () => {
    expect(
      cardFigures(envelope({ monthExpenseCount: 1 }), eur, '2026-10').detail,
    ).toMatch(/· 1 expense$/);
  });
});

describe('envelope dates', () => {
  it('words the top-up line, also over a year end', () => {
    expect(topUpLine('2026-10')).toBe('October · next top-up on 1 November');
    expect(topUpLine('2026-12')).toBe('December · next top-up on 1 January');
  });

  it('shows an instant as a short date in the family time zone', () => {
    // 22:30 UTC on 29 August is 30 August in Berlin.
    expect(shortDate(Date.parse('2026-08-29T22:30:00Z'), 'Europe/Berlin')).toBe(
      '30 Aug 2026',
    );
  });
});
