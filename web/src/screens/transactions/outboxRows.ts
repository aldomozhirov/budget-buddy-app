import {
  addMonths,
  monthOfDate,
  todayInTimeZone,
  type ListedTransaction,
} from '@budget-buddy/shared';
import type { OutboxItem } from '../../offline/outbox.js';
import { dayHeading, type TransactionFilters } from './transactionsFormat.js';

/**
 * How items still on the phone read in the lists (UI-TXN-9, UI-HOME-8):
 * as list rows, in the details sheet, on Home's card and in the sign-out
 * question.
 */

/** An outbox item as a list row, so it reads like the rows of the server. */
export function outboxRow(item: OutboxItem): ListedTransaction {
  const { body, names } = item;
  return {
    // Not on the server yet; the list keys these rows by client id.
    id: 0,
    kind: body.kind,
    date: body.date,
    accountId: body.accountId,
    accountName: names.account,
    currency: names.currency,
    amount: body.amount,
    toAccountId: body.toAccountId ?? null,
    toAccountName: names.toAccount,
    toCurrency: names.toCurrency,
    toAmount: body.toAmount ?? (body.kind === 'transfer' ? body.amount : null),
    memberId: body.memberId ?? item.profileId,
    memberName: names.member,
    merchant: body.merchant ?? null,
    note: body.note ?? null,
    categoryId: body.categoryId ?? null,
    categoryName: names.category,
    envelopeId: body.envelopeId ?? null,
    envelopeName: names.envelope,
  };
}

/** "Waiting to send" or "Couldn’t send", the item's tag and sheet title. */
export function outboxTag(item: OutboxItem): string {
  return item.state === 'failed' ? 'Couldn’t send' : 'Waiting to send';
}

/**
 * Who typed it and when, in the family time zone: "Today, 13:30 by Alena".
 * @param today `YYYY-MM-DD` in the family time zone.
 */
export function typedInText(
  item: OutboxItem,
  today: string,
  timeZone: string,
): string {
  const at = new Date(item.enteredAt);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const day = dayHeading(todayInTimeZone(at, timeZone), today);
  return `${day}, ${time} by ${item.profileName}`;
}

/**
 * The line under "Waiting to send · N" on Home: why to open it when some
 * were refused, else that the rest sends itself.
 */
export function waitingCardNote(items: readonly OutboxItem[]): string {
  const failed = items.filter((item) => item.state === 'failed').length;
  if (failed === 1) return 'One couldn’t be sent. Open it to see why.';
  if (failed > 1) return `${failed} couldn’t be sent. Open them to see why.`;
  return 'They send themselves when you’re back online.';
}

/**
 * The sign-out question while items are unsent (UI-HOME-8). They are
 * "expenses" when all are, else "transactions".
 */
export function unsentQuestion(items: readonly OutboxItem[]): string {
  const expenses = items.every((item) => item.body.kind === 'expense');
  const noun = expenses ? 'expense' : 'transaction';
  return items.length === 1
    ? `1 ${noun} hasn’t been sent yet. Signing out deletes it from this phone.`
    : `${items.length} ${noun}s haven’t been sent yet. Signing out deletes them from this phone.`;
}

function inPeriod(date: string, filters: TransactionFilters, today: string) {
  const month = monthOfDate(today);
  const of = monthOfDate(date);
  switch (filters.period) {
    case 'this_month':
      return of === month;
    case 'last_month':
      return of === addMonths(month, -1);
    case 'last_3_months':
      return of >= addMonths(month, -2) && of <= month;
    case 'this_year':
      return date.slice(0, 4) === today.slice(0, 4);
    default:
      return true;
  }
}

/**
 * Whether an outbox item belongs in the list as filtered: by the same
 * period and choices as the server's rows, and by the search words found
 * in its merchant, note or names (the server also searches amounts).
 */
export function outboxMatches(
  item: OutboxItem,
  filters: TransactionFilters,
  today: string,
): boolean {
  const row = outboxRow(item);
  const refund = row.kind === 'expense' && BigInt(row.amount) < 0n;
  const kind = refund ? 'refund' : row.kind;
  const accounts = [row.accountId, row.toAccountId];
  const words = filters.q.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const text = [
    row.merchant,
    row.note,
    row.accountName,
    row.toAccountName,
    row.categoryName,
    row.envelopeName,
    row.memberName,
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
    .toLocaleLowerCase();
  return (
    inPeriod(row.date, filters, today) &&
    (filters.member.length === 0 || filters.member.includes(row.memberId)) &&
    (filters.account.length === 0 ||
      accounts.some((id) => id !== null && filters.account.includes(id))) &&
    (filters.category.length === 0 ||
      filters.category.includes(row.categoryId ?? 'none')) &&
    (filters.envelope.length === 0 ||
      filters.envelope.includes(row.envelopeId ?? 'none')) &&
    (filters.kind.length === 0 || filters.kind.includes(kind)) &&
    words.every((word) => text.includes(word))
  );
}
