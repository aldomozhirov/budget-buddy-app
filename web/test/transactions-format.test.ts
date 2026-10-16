import { describe, expect, it } from 'vitest';
import type { ListedTransaction } from '@budget-buddy/shared';
import {
  chipLabel,
  countText,
  dayHeading,
  describeRow,
  emptyFilters,
  facetOptions,
  filtersFromQuery,
  filtersToParams,
  hasActiveFilters,
  totalsText,
  type FilterLookups,
  type FilterNames,
} from '../src/screens/transactions/transactionsFormat';

function row(overrides: Partial<ListedTransaction>): ListedTransaction {
  return {
    id: 1,
    kind: 'expense',
    date: '2026-10-05',
    accountId: 1,
    accountName: 'ING Visa',
    currency: 'EUR',
    amount: '6420',
    toAccountId: null,
    toAccountName: null,
    toCurrency: null,
    toAmount: null,
    memberId: 1,
    memberName: 'Alena',
    merchant: 'REWE',
    note: null,
    categoryId: 1,
    categoryName: 'Groceries',
    envelopeId: 1,
    envelopeName: 'Groceries',
    ...overrides,
  };
}

const names: FilterNames = {
  member: new Map([
    [1, 'Alena'],
    [2, 'Max'],
  ]),
  account: new Map([[3, 'ING Visa']]),
  category: new Map([[4, 'Groceries']]),
  envelope: new Map([[5, 'Eating out']]),
};

describe('filters', () => {
  it('start on this month with nothing else', () => {
    expect(emptyFilters().period).toBe('this_month');
    expect(hasActiveFilters(emptyFilters())).toBe(false);
  });

  it('read a link such as the account page opens', () => {
    const filters = filtersFromQuery({
      account: '3,x,4',
      period: 'all',
      category: 'none,7',
      kind: ['refund', 'bogus'],
      q: 'rewe',
    });
    expect(filters).toEqual({
      period: 'all',
      member: [],
      account: [3, 4],
      category: ['none', 7],
      envelope: [],
      kind: ['refund'],
      q: 'rewe',
    });
  });

  it('fall back to this month for a period that is not offered', () => {
    expect(filtersFromQuery({ period: 'custom' }).period).toBe('this_month');
  });

  it('become the API query, leaving out what is empty', () => {
    const params = filtersToParams({
      ...emptyFilters(),
      member: [1, 2],
      category: ['none'],
      q: '  64.2 ',
    });
    expect(params.toString()).toBe(
      'period=this_month&member=1%2C2&category=none&q=64.2',
    );
  });

  it('count the period and the search as active', () => {
    expect(hasActiveFilters({ ...emptyFilters(), period: 'all' })).toBe(true);
    expect(hasActiveFilters({ ...emptyFilters(), q: 'a' })).toBe(true);
  });
});

describe('chipLabel', () => {
  it('names the month, the pick or a count', () => {
    const filters = emptyFilters();
    expect(chipLabel('period', filters, names, '2026-10')).toBe('October');
    expect(chipLabel('member', filters, names, '2026-10')).toBe('Everyone');
    expect(chipLabel('account', filters, names, '2026-10')).toBe('Account');
    filters.period = 'all';
    filters.member = [2];
    filters.account = [3, 3];
    filters.category = ['none'];
    filters.kind = ['refund'];
    expect(chipLabel('period', filters, names, '2026-10')).toBe('All time');
    expect(chipLabel('member', filters, names, '2026-10')).toBe('Max');
    expect(chipLabel('account', filters, names, '2026-10')).toBe('2 accounts');
    expect(chipLabel('category', filters, names, '2026-10')).toBe(
      'No category',
    );
    expect(chipLabel('kind', filters, names, '2026-10')).toBe('Refund');
  });
});

describe('describeRow', () => {
  it('shows an expense with a minus and its meta line', () => {
    expect(describeRow(row({}), [])).toMatchObject({
      title: 'REWE',
      meta: 'Groceries · ING Visa · Alena',
      amount: '−€64.20',
      tone: 'out',
      noCategory: false,
    });
  });

  it('names the envelope when it differs from the category', () => {
    expect(
      describeRow(
        row({ categoryName: 'Health', envelopeName: 'Unexpected' }),
        [],
      ).meta,
    ).toBe('Health · Unexpected · ING Visa · Alena');
  });

  it('shows a refund with a plus and the word Refund', () => {
    expect(
      describeRow(row({ amount: '-1999', merchant: 'Amazon' }), []),
    ).toMatchObject({
      amount: '+€19.99',
      tone: 'in',
      meta: 'Refund · Groceries · ING Visa · Alena',
    });
  });

  it('uses the category as the title when there is no merchant', () => {
    expect(
      describeRow(
        row({
          kind: 'income',
          merchant: null,
          categoryName: 'Salary',
          envelopeName: null,
        }),
        [],
      ),
    ).toMatchObject({ title: 'Salary', amount: '+€64.20', tone: 'in' });
    expect(
      describeRow(
        row({ merchant: null, categoryName: null, envelopeName: null }),
        [],
      ),
    ).toMatchObject({ title: 'Expense', noCategory: true });
  });

  it('shows a transfer plain, with what arrives in another currency', () => {
    const text = describeRow(
      row({
        kind: 'transfer',
        merchant: null,
        categoryName: null,
        envelopeName: null,
        toAccountId: 2,
        toAccountName: 'Wise $',
        toCurrency: 'USD',
        toAmount: '2186',
        amount: '2000',
        note: 'Holiday',
      }),
      [],
    );
    expect(text).toMatchObject({
      title: 'ING Visa → Wise $',
      meta: 'Transfer · Holiday · Alena',
      amount: '€20.00',
      tone: 'neutral',
      arrives: '→ $21.86',
      noCategory: false,
    });
  });
});

describe('dayHeading', () => {
  it('says Today, or the weekday, day and month', () => {
    expect(dayHeading('2026-10-13', '2026-10-13')).toBe('Today');
    expect(dayHeading('2026-10-04', '2026-10-13')).toBe('Sun 4 Oct');
  });

  it('adds the year when it is not this year', () => {
    expect(dayHeading('2025-12-31', '2026-10-13')).toBe('Wed 31 Dec 2025');
  });
});

describe('totalsText', () => {
  const totals = { spent: '9235', income: '420000', incomplete: false };

  it('gives a day its spending, or its income when nothing was spent', () => {
    expect(totalsText(totals, 'EUR', [], 'day')).toBe('€92.35 spent');
    expect(totalsText({ ...totals, spent: '0' }, 'EUR', [], 'day')).toBe(
      '+€4,200.00 in',
    );
    expect(
      totalsText(
        { spent: '0', income: '0', incomplete: false },
        'EUR',
        [],
        'day',
      ),
    ).toBe('');
  });

  it('gives the summary both, and says when a rate is missing', () => {
    expect(
      totalsText({ ...totals, incomplete: true }, 'EUR', [], 'summary'),
    ).toBe('€92.35 spent · +€4,200.00 in · Rate missing');
  });

  it('counts transactions', () => {
    expect(countText(1)).toBe('1 transaction');
    expect(countText(5)).toBe('5 transactions');
  });
});

const names2: FilterNames = { ...names, member: new Map([[2, 'Tom']]) };

describe('facetOptions', () => {
  const lookups: FilterLookups = {
    member: [
      { id: 1, name: 'Alena', archived: false },
      { id: 2, name: 'Tom', archived: true },
    ],
    account: [
      { id: 3, name: 'ING Visa', archived: false },
      { id: 4, name: 'Old card', archived: true },
    ],
    category: [
      { id: 7, name: 'Groceries', kind: 'expense', archived: false },
      { id: 8, name: 'Salary', kind: 'income', archived: false },
    ],
    envelope: [{ id: 9, name: 'Groceries', archived: false }],
  };

  it('lists archived accounts only while they have transactions', () => {
    const none = facetOptions('account', lookups, new Map(), emptyFilters());
    expect(none.map((item) => item.label)).toEqual(['ING Visa']);
    const used = facetOptions(
      'account',
      lookups,
      new Map([['4', 2]]),
      emptyFilters(),
    );
    expect(used.map((item) => [item.label, item.count])).toEqual([
      ['ING Visa', 0],
      ['Old card', 2],
    ]);
  });

  it('lists an inactive profile only while it has transactions', () => {
    expect(
      facetOptions('member', lookups, new Map(), emptyFilters()).map(
        (item) => item.label,
      ),
    ).toEqual(['Alena']);
    expect(
      facetOptions('member', lookups, new Map([['2', 4]]), emptyFilters()).map(
        (item) => [item.label, item.count],
      ),
    ).toEqual([
      ['Alena', 0],
      ['Tom', 4],
    ]);
    expect(
      chipLabel(
        'member',
        { ...emptyFilters(), member: [2] },
        names2,
        '2026-10',
      ),
    ).toBe('Tom');
  });

  it('groups categories by kind and ends with No category', () => {
    const filters = { ...emptyFilters(), category: ['none' as const, 8] };
    const options = facetOptions(
      'category',
      lookups,
      new Map([['none', 3]]),
      filters,
    );
    expect(
      options.map((item) => [item.label, item.group, item.selected]),
    ).toEqual([
      ['Groceries', 'Expense categories', false],
      ['Salary', 'Income categories', true],
      ['No category', undefined, true],
    ]);
    expect(options.at(-1)).toMatchObject({
      sub: 'Waiting to be labelled',
      count: 3,
    });
  });

  it('lists the five periods and the four kinds', () => {
    expect(
      facetOptions('period', lookups, new Map(), emptyFilters()).map(
        (item) => item.label,
      ),
    ).toEqual([
      'This month',
      'Last month',
      'Last 3 months',
      'This year',
      'All time',
    ]);
    expect(
      facetOptions('kind', lookups, new Map(), emptyFilters()).map(
        (item) => item.value,
      ),
    ).toEqual(['expense', 'income', 'transfer', 'refund']);
  });
});
