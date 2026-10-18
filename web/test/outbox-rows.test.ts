import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '../src/offline/outbox.js';
import {
  outboxMatches,
  outboxRow,
  outboxTag,
  typedInText,
  unsentQuestion,
  waitingCardNote,
  waitingRowSub,
} from '../src/screens/transactions/outboxRows.js';
import { emptyFilters } from '../src/screens/transactions/transactionsFormat.js';

/** How items still on the phone read (UI-TXN-9, UI-HOME-8). */

function item(overrides: Partial<OutboxItem['body']> = {}): OutboxItem {
  const body = {
    clientId: 'a',
    enteredAt: Date.parse('2026-10-18T11:30:00Z'),
    kind: 'expense' as const,
    date: '2026-10-18',
    accountId: 3,
    amount: '2890',
    merchant: 'Lieferando',
    categoryId: 7,
    ...overrides,
  };
  return {
    clientId: body.clientId,
    body,
    profileId: 1,
    profileName: 'Alena',
    enteredAt: body.enteredAt,
    names: {
      account: 'Revolut',
      currency: 'EUR',
      toAccount: null,
      toCurrency: null,
      category: 'Eating out',
      envelope: null,
      member: 'Alena',
    },
    state: 'waiting',
    error: null,
  };
}

const failed = (entry: OutboxItem): OutboxItem => ({
  ...entry,
  state: 'failed',
  error: 'Nope.',
});

describe('outbox rows', () => {
  it('reads like a list row, paid by the profile it was typed as', () => {
    expect(outboxRow(item())).toMatchObject({
      kind: 'expense',
      date: '2026-10-18',
      accountName: 'Revolut',
      amount: '2890',
      memberId: 1,
      memberName: 'Alena',
      merchant: 'Lieferando',
      categoryName: 'Eating out',
      toAmount: null,
    });
  });

  it('tags waiting and refused items', () => {
    expect(outboxTag(item())).toBe('Waiting to send');
    expect(outboxTag(failed(item()))).toBe('Couldn’t send');
  });

  it('says who typed it and when, in the family time zone', () => {
    expect(typedInText(item(), '2026-10-18', 'Europe/Berlin')).toBe(
      'Today, 13:30 by Alena',
    );
    expect(typedInText(item(), '2026-10-20', 'Europe/Berlin')).toMatch(
      /^Sun 18 Oct, 13:30 by Alena$/,
    );
  });

  it('words a limited Home row by kind, day and time, with no amount', () => {
    expect(waitingRowSub(item(), '2026-10-18', 'Europe/Berlin')).toBe(
      'Expense · today, 13:30',
    );
    expect(
      waitingRowSub(item({ kind: 'income' }), '2026-10-20', 'Europe/Berlin'),
    ).toBe('Income · Sun 18 Oct, 13:30');
  });

  it('words the Home card by what failed', () => {
    expect(waitingCardNote([item()])).toBe(
      'They send themselves when you’re back online.',
    );
    expect(waitingCardNote([item(), failed(item())])).toBe(
      'One couldn’t be sent. Open it to see why.',
    );
    expect(waitingCardNote([failed(item()), failed(item())])).toBe(
      '2 couldn’t be sent. Open them to see why.',
    );
  });

  it('asks before sign-out with the count and the noun', () => {
    expect(unsentQuestion([item()])).toBe(
      '1 expense hasn’t been sent yet. Signing out deletes it from this phone.',
    );
    expect(unsentQuestion([item(), item()])).toBe(
      '2 expenses haven’t been sent yet. Signing out deletes them from this phone.',
    );
    expect(unsentQuestion([item(), item({ kind: 'income' })])).toBe(
      '2 transactions haven’t been sent yet. Signing out deletes them from this phone.',
    );
  });

  it('follows the list filters and the search words', () => {
    const today = '2026-10-18';
    const filters = emptyFilters();
    expect(outboxMatches(item(), filters, today)).toBe(true);
    expect(outboxMatches(item({ date: '2026-09-30' }), filters, today)).toBe(
      false,
    );
    expect(
      outboxMatches(
        item({ date: '2026-09-30' }),
        { ...filters, period: 'last_month' },
        today,
      ),
    ).toBe(true);
    expect(outboxMatches(item(), { ...filters, account: [4] }, today)).toBe(
      false,
    );
    expect(outboxMatches(item(), { ...filters, member: [1] }, today)).toBe(
      true,
    );
    expect(
      outboxMatches(item(), { ...filters, category: ['none'] }, today),
    ).toBe(false);
    expect(outboxMatches(item(), { ...filters, kind: ['refund'] }, today)).toBe(
      false,
    );
    expect(
      outboxMatches(
        item({ amount: '-500' }),
        { ...filters, kind: ['refund'] },
        today,
      ),
    ).toBe(true);
    expect(outboxMatches(item(), { ...filters, q: 'liefer rev' }, today)).toBe(
      true,
    );
    expect(outboxMatches(item(), { ...filters, q: 'rewe' }, today)).toBe(false);
  });
});
