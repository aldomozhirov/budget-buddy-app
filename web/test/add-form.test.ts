import { convert, getCurrency } from '@budget-buddy/shared';
import { describe, expect, it } from 'vitest';
import {
  accountCurrency,
  amountText,
  applyRule,
  dayLabel,
  EMPTY_PICK,
  filledText,
  kindWords,
  merchantHint,
  pairLookup,
  parseKind,
  pickLabel,
  savedSummary,
  shiftDate,
  toggleChip,
  withFront,
} from '../src/screens/add/addForm.js';

const hand = (id: number) => ({ id, source: 'hand' as const });
const rule = (id: number) => ({ id, source: 'rule' as const });

describe('applyRule', () => {
  it('fills empty fields from the rule', () => {
    expect(
      applyRule(
        { category: EMPTY_PICK, envelope: EMPTY_PICK },
        { categoryId: 1, envelopeId: 7 },
      ),
    ).toEqual({ category: rule(1), envelope: rule(7) });
  });

  it('never overwrites a hand pick', () => {
    expect(
      applyRule(
        { category: hand(3), envelope: EMPTY_PICK },
        { categoryId: 1, envelopeId: 7 },
      ),
    ).toEqual({ category: hand(3), envelope: rule(7) });
  });

  it('replaces what the previous rule set', () => {
    expect(
      applyRule(
        { category: rule(1), envelope: rule(7) },
        { categoryId: 2, envelopeId: null },
      ),
    ).toEqual({ category: rule(2), envelope: EMPTY_PICK });
  });

  it('clears rule values for a merchant without a rule', () => {
    expect(applyRule({ category: rule(1), envelope: hand(7) }, null)).toEqual({
      category: EMPTY_PICK,
      envelope: hand(7),
    });
  });
});

describe('chips', () => {
  it('toggles a chip by hand and clears the selected one', () => {
    expect(toggleChip(EMPTY_PICK, 4)).toEqual(hand(4));
    expect(toggleChip(rule(4), 4)).toEqual(EMPTY_PICK);
    expect(toggleChip(hand(4), 5)).toEqual(hand(5));
  });

  it('puts a pick from beyond the row in front', () => {
    expect(withFront([1, 2, 3], 9)).toEqual([9, 1, 2, 3]);
    expect(withFront([1, 2, 3], 2)).toEqual([1, 2, 3]);
    expect(withFront([1, 2, 3], null)).toEqual([1, 2, 3]);
  });
});

describe('labels', () => {
  it('names the rule, the on-save preview or nothing', () => {
    expect(pickLabel('Category', rule(1), 'REWE', null)).toBe(
      'Category · from REWE rule',
    );
    expect(pickLabel('Envelope', EMPTY_PICK, '', 'Groceries')).toBe(
      'Envelope · optional · if empty, Groceries',
    );
    expect(pickLabel('Category', hand(1), 'REWE', null)).toBe(
      'Category · optional',
    );
  });

  it('gives the merchant hint', () => {
    expect(merchantHint('', EMPTY_PICK, EMPTY_PICK)).toBe('Optional');
    expect(merchantHint('REWE', EMPTY_PICK, rule(2))).toBe(
      'Rule applied · change',
    );
    expect(merchantHint('Shell', hand(1), EMPTY_PICK)).toBe('Change');
  });
});

describe('amounts', () => {
  const eur = accountCurrency({
    id: 1,
    name: 'ING',
    ownerMemberId: 1,
    ownerName: 'Alena',
    type: 'bank',
    currency: 'EUR',
    decimals: 2,
    symbol: '€',
  });

  it('shows €0 while empty and a U+2212 minus for a refund', () => {
    expect(amountText(null, eur)).toBe('€0');
    expect(amountText(-1999n, eur)).toBe('−€19.99');
    expect(amountText(2380n, eur)).toBe('€23.80');
  });

  it('takes a coin from the account', () => {
    const coin = accountCurrency({
      id: 2,
      name: 'Wallet',
      ownerMemberId: 1,
      ownerName: 'Alena',
      type: 'crypto',
      currency: 'USDC',
      decimals: 6,
      symbol: 'USDC',
    });
    expect(coin).toMatchObject({ kind: 'coin', decimals: 6 });
    expect(amountText(1500000n, coin)).toBe('USDC1.500000');
  });
});

describe('dates', () => {
  it('names today, yesterday and older days', () => {
    expect(dayLabel('2026-10-05', '2026-10-05')).toBe('Today');
    expect(dayLabel('2026-10-04', '2026-10-05')).toBe('Yesterday');
    expect(dayLabel('2026-10-03', '2026-10-05')).toBe('Sat 3 Oct');
    expect(dayLabel('2025-12-31', '2026-01-02')).toBe('Wed 31 Dec 2025');
  });

  it('crosses month ends and leap days', () => {
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('saved view', () => {
  it('says what the on-save fill added', () => {
    expect(filledText({ envelope: 'category' }, 'Groceries', 'Groceries')).toBe(
      'Groceries envelope added from the Groceries category.',
    );
    expect(filledText({ category: 'envelope' }, 'Health', 'Unexpected')).toBe(
      'Health category added from the Unexpected envelope.',
    );
    expect(filledText({}, null, null)).toBe('');
  });

  it('summarises in one line', () => {
    expect(
      savedSummary({
        amount: '€23.80',
        merchant: 'REWE',
        date: null,
        payer: null,
        account: 'ING Visa',
        envelope: 'Groceries',
        category: 'Groceries',
      }),
    ).toBe('€23.80 · REWE · ING Visa · Groceries');
    expect(
      savedSummary({
        amount: '€3.00',
        merchant: null,
        date: 'Yesterday',
        payer: 'Max',
        account: 'Cash',
        envelope: null,
        category: 'Transport',
      }),
    ).toBe('€3.00 · Yesterday · paid by Max · Cash · Transport');
  });
});

describe('parseKind', () => {
  it('opens income and transfer by name and anything else as an expense', () => {
    expect(parseKind('income')).toBe('income');
    expect(parseKind('transfer')).toBe('transfer');
    expect(parseKind(['income', 'transfer'])).toBe('income');
    expect(parseKind('expense')).toBe('expense');
    expect(parseKind('nonsense')).toBe('expense');
    expect(parseKind(undefined)).toBe('expense');
  });
});

describe('kindWords', () => {
  it('labels the account row and the person tile of each kind', () => {
    expect(kindWords('expense')).toMatchObject({
      fromLabel: 'Paid from',
      payerLabel: 'Paid by',
    });
    expect(kindWords('income')).toMatchObject({
      noun: 'Income',
      fromLabel: 'Paid into',
      payerLabel: 'Received by',
    });
    expect(kindWords('transfer')).toMatchObject({
      noun: 'Transfer',
      fromLabel: 'From',
      payerLabel: 'Done by',
    });
  });
});

describe('pairLookup', () => {
  it('answers for its pair only, so convert uses the server’s rate', () => {
    const lookup = pairLookup('EUR', 'USD', {
      rate: '1.093',
      date: '2026-10-13',
    });
    const eur = getCurrency('EUR')!;
    const usd = getCurrency('USD')!;
    expect(convert(2000n, eur, usd, '2026-10-15', lookup)).toEqual({
      value: 2186n,
      rateDate: '2026-10-13',
    });
    expect(lookup('USD', 'EUR', '2026-10-15')).toBeUndefined();
  });
});

describe('savedSummary for other kinds', () => {
  it('names the person tile of an income and a transfer', () => {
    expect(
      savedSummary({
        amount: '€4,200.00',
        merchant: null,
        date: null,
        payer: 'Max',
        payerLabel: 'Received by',
        account: 'DKB',
        envelope: null,
        category: 'Salary',
      }),
    ).toBe('€4,200.00 · received by Max · DKB · Salary');
    expect(
      savedSummary({
        amount: '€20.00 → $21.86',
        merchant: null,
        date: null,
        payer: null,
        account: 'ING Visa → Wise $',
        envelope: null,
        category: null,
      }),
    ).toBe('€20.00 → $21.86 · ING Visa → Wise $');
  });
});
