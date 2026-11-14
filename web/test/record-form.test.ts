import { describe, expect, it } from 'vitest';
import { getCurrency, type Currency, type Wish } from '@budget-buddy/shared';
import {
  convertedBase,
  recordRateLine,
  sheetBase,
} from '../src/screens/wishes/recordForm';

function wish(overrides: Partial<Wish>): Wish {
  return {
    id: 1,
    month: '2026-10',
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

const eur = getCurrency('EUR') as Currency;
const usd = getCurrency('USD') as Currency;
const jpy = getCurrency('JPY') as Currency;

describe('sheetBase', () => {
  it('starts from the wish’s amount when nothing is spent', () => {
    expect(sheetBase(wish({}))).toEqual({
      amount: 48000n,
      label: 'The wish’s amount',
    });
  });

  it('starts from what is left when the wish is partly spent', () => {
    expect(
      sheetBase(wish({ spent: '12000', left: '36000', expenseCount: 1 })),
    ).toEqual({ amount: 36000n, label: 'What’s left of the wish' });
  });

  it('falls back to the amount when everything is spent, or more', () => {
    for (const left of ['0', '-500']) {
      expect(sheetBase(wish({ left, expenseCount: 2 }))).toEqual({
        amount: 48000n,
        label: 'The wish’s amount',
      });
    }
  });

  it('ignores a positive left when no expense counts yet', () => {
    expect(sheetBase(wish({ left: '47000', expenseCount: 0 })).amount).toBe(
      48000n,
    );
  });
});

describe('convertedBase', () => {
  const rate = { rate: '1.093', date: '2026-10-14' };

  it('keeps the amount in the wish’s own currency, rate or not', () => {
    expect(convertedBase(48000n, eur, eur, '2026-10-15', null)).toBe(48000n);
  });

  it('converts at the day’s rate, rounded once', () => {
    expect(convertedBase(48000n, eur, usd, '2026-10-15', rate)).toBe(52464n);
    // 380.00 * 1.093 = 415.34
    expect(convertedBase(38000n, eur, usd, '2026-10-15', rate)).toBe(41534n);
  });

  it('follows the decimals of the paying account’s currency', () => {
    // €480.00 at 160 yen per euro is 76800 yen, which has no decimals.
    expect(
      convertedBase(48000n, eur, jpy, '2026-10-15', {
        rate: '160',
        date: '2026-10-14',
      }),
    ).toBe(76800n);
  });

  it('answers null while the rate is missing', () => {
    expect(convertedBase(48000n, eur, usd, '2026-10-15', null)).toBeNull();
  });
});

describe('recordRateLine', () => {
  const rate = { rate: '1.093', date: '2026-10-14' };

  it('reads "€1 = $1.093 today" for the day of the sheet', () => {
    expect(
      recordRateLine(rate, 'EUR', 'USD', '2026-10-15', '2026-10-15', []),
    ).toBe('€1 = $1.093 today');
  });

  it('names another day', () => {
    expect(
      recordRateLine(rate, 'EUR', 'USD', '2026-10-03', '2026-10-15', []),
    ).toBe('€1 = $1.093 on Sat 3 Oct');
  });

  it('writes the code for a currency with no symbol of its own', () => {
    expect(
      recordRateLine(
        { rate: '0.05', date: '2026-10-14' },
        'XYZ',
        'EUR',
        '2026-10-15',
        '2026-10-15',
        [],
      ),
    ).toBe('XYZ 1 = €0.05 today');
  });
});
