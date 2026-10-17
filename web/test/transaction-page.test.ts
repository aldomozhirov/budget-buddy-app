import { describe, expect, it } from 'vitest';
import type { Transaction, TransactionRevision } from '@budget-buddy/shared';
import {
  countsHint,
  deleteText,
  envelopeRowText,
  headerAmount,
  longDate,
  rateLine,
  rateText,
  recordLines,
  slashDate,
  whenText,
  type PageNames,
} from '../src/screens/transactions/transactionPage';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    clientId: null,
    kind: 'expense',
    status: 'confirmed',
    date: '2026-10-05',
    accountId: 1,
    currency: 'EUR',
    amount: '6420',
    toAccountId: null,
    toCurrency: null,
    toAmount: null,
    memberId: 1,
    merchant: 'REWE',
    note: null,
    categoryId: 1,
    envelopeId: 1,
    envelopeCurrency: 'EUR',
    envelopeAmount: '6420',
    envelopeAmountManual: false,
    envelopeRate: null,
    source: 'typed',
    enteredAt: null,
    createdBy: 1,
    createdAt: Date.UTC(2026, 9, 5, 10, 4),
    updatedBy: 1,
    updatedAt: Date.UTC(2026, 9, 5, 10, 4),
    ...overrides,
  };
}

const foreign = transaction({
  accountId: 2,
  currency: 'USD',
  amount: '2339',
  envelopeAmount: '2140',
  envelopeRate: { from: 'USD', to: 'EUR', rate: '0.9149', date: '2026-10-02' },
});

const names: PageNames = {
  member: new Map([
    [1, 'Alena'],
    [2, 'Max'],
  ]),
  account: new Map([
    [1, { name: 'ING Visa', currency: 'EUR' }],
    [2, { name: 'Wise $', currency: 'USD' }],
  ]),
  category: new Map([
    [1, 'Groceries'],
    [2, 'Shopping'],
  ]),
  envelope: new Map([[1, { name: 'Groceries', currency: 'EUR' }]]),
};

function revision(
  id: number,
  changes: TransactionRevision['changes'],
  changedAt: number,
  changedBy = 1,
): TransactionRevision {
  return { id, action: 'update', changes, changedBy, changedAt };
}

describe('amounts and dates', () => {
  it('signs the big amount by kind', () => {
    expect(headerAmount(transaction(), []).text).toBe('−€64.20');
    expect(headerAmount(transaction({ amount: '-1999' }), []).text).toBe(
      '+€19.99',
    );
    expect(
      headerAmount(transaction({ kind: 'income', amount: '420000' }), []),
    ).toEqual({ text: '+€4,200.00', tone: 'in' });
    expect(
      headerAmount(transaction({ kind: 'transfer', amount: '20000' }), []).text,
    ).toBe('€200.00');
  });

  it('writes the date under the amount and in the row', () => {
    expect(longDate('2026-10-05', '2026-10-05')).toBe('Today, 5 October 2026');
    expect(longDate('2026-10-04', '2026-10-05')).toBe(
      'Yesterday, 4 October 2026',
    );
    expect(longDate('2026-10-02', '2026-10-05')).toBe('2 October 2026');
    expect(slashDate('2026-10-05')).toBe('05/10/2026');
  });

  it('writes a time as clock, yesterday or day and clock', () => {
    const at = (day: number, hour: number, minute: number) =>
      Date.UTC(2026, 9, day, hour - 2, minute);
    expect(whenText(at(5, 12, 4), 'Europe/Berlin', '2026-10-05')).toBe('12:04');
    expect(whenText(at(4, 9, 30), 'Europe/Berlin', '2026-10-05')).toBe(
      'Yesterday · 09:30',
    );
    expect(whenText(at(2, 18, 42), 'Europe/Berlin', '2026-10-05')).toBe(
      '2 Oct · 18:42',
    );
  });
});

describe('the rate of an envelope amount', () => {
  it('rounds a rate to four decimals, or four digits below one', () => {
    expect(rateText('0.9149')).toBe('0.9149');
    expect(rateText('0.91496000')).toBe('0.915');
    expect(rateText('1.08423')).toBe('1.0842');
    expect(rateText('150')).toBe('150');
    expect(rateText('0.006123456')).toBe('0.006123');
    expect(rateText('0.99996')).toBe('1');
  });

  it('says it as the design does', () => {
    expect(rateLine(foreign.envelopeRate!, [], '2026-10-05')).toBe(
      'At the rate of 2 October: $1 = €0.9149.',
    );
    expect(countsHint(foreign, [], '2026-10-05')).toBe(
      'At the rate of 2 October: $1 = €0.9149. Type what the bank charged, if you know it.',
    );
    expect(
      countsHint(
        { ...foreign, envelopeAmountManual: true, envelopeRate: null },
        [],
        '2026-10-05',
      ),
    ).toMatch(/^Typed by hand\./u);
    expect(
      countsHint({ ...foreign, envelopeRate: null }, [], '2026-10-05'),
    ).toMatch(/^No rate for this date yet\./u);
  });

  it('shows "counts as" only across currencies', () => {
    expect(envelopeRowText(transaction(), 'Groceries', [])).toBe('Groceries');
    expect(envelopeRowText(foreign, 'Groceries', [])).toBe(
      'Groceries · counts as €21.40',
    );
    expect(
      envelopeRowText({ ...foreign, envelopeAmount: null }, 'Groceries', []),
    ).toBe('Groceries · rate missing');
    expect(
      envelopeRowText(transaction({ envelopeId: null }), undefined, []),
    ).toBe('None');
  });
});

describe('the delete question', () => {
  it('says what goes back where', () => {
    expect(deleteText(transaction(), 'Groceries', [])).toBe(
      '€64.20 goes back into Groceries. This can’t be undone.',
    );
    expect(deleteText(foreign, 'Groceries', [])).toBe(
      '€21.40 goes back into Groceries. This can’t be undone.',
    );
    expect(deleteText(transaction({ envelopeId: null }), undefined, [])).toBe(
      'It’s in no envelope. This can’t be undone.',
    );
    expect(deleteText(transaction({ kind: 'income' }), undefined, [])).toBe(
      'This can’t be undone.',
    );
  });
});

describe('the record', () => {
  it('lists who typed it and each change in words', () => {
    const now = Date.UTC(2026, 9, 5, 12, 0);
    const lines = recordLines(
      transaction({ memberId: 2 }),
      [
        revision(1, { categoryId: [null, 1] }, now, 2),
        revision(2, { amount: ['5000', '6420'], note: [null, 'x'] }, now),
        revision(3, { merchant: ['Lidl', null], envelopeId: [1, null] }, now),
      ],
      names,
      [],
      'Europe/Berlin',
      '2026-10-05',
    );
    expect(lines.map((line) => line.text)).toEqual([
      'Typed in by Alena',
      'Category changed to Groceries by Max',
      'Amount changed to €64.20 by Alena',
      'Note changed by Alena',
      'Merchant removed by Alena',
      'Envelope removed by Alena',
    ]);
    expect(lines[0]!.when).toBe('12:04');
  });

  it('writes an amount in the currency the account had then', () => {
    const lines = recordLines(
      transaction({ accountId: 1 }),
      [revision(1, { accountId: [2, 1], amount: ['2339', '2140'] }, 0)],
      names,
      [],
      'UTC',
      '2026-10-05',
    );
    expect(lines.map((line) => line.text)).toContain(
      'Amount changed to €21.40 by Alena',
    );
    const before = recordLines(
      transaction({ accountId: 1 }),
      [
        revision(1, { amount: ['100', '2339'] }, 0),
        revision(2, { accountId: [2, 1] }, 1),
      ],
      names,
      [],
      'UTC',
      '2026-10-05',
    );
    expect(before.map((line) => line.text)).toContain(
      'Amount changed to $23.39 by Alena',
    );
  });
});
