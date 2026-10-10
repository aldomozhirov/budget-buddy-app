import type Database from 'better-sqlite3';
import { toMinorString, type CheckinSummary } from '@budget-buddy/shared';
import { balanceAt, type AccountBalance } from './balance.js';
import { createValuation } from './valuation.js';

type Direction = 'up' | 'down' | 'unchanged';
type SummaryAccount = CheckinSummary['biggestChanges'][number];
type AccountType = CheckinSummary['byType'][number]['type'];

/** How many accounts "Biggest changes" lists (SUM-5). */
const biggestChangeCount = 5;

/** Account types in the order the type subtotals are listed. */
const accountTypeOrder: readonly AccountType[] = [
  'bank',
  'cash',
  'investment',
  'crypto',
  'owed_to_us',
  'we_owe',
];

/** The summary of a closed check-in, or why there is none. */
export type SummaryResult =
  | { status: 'ok'; summary: CheckinSummary }
  | { status: 'not_found' }
  | { status: 'open' };

type CheckinRow = {
  id: bigint;
  closed_at: bigint | null;
  closed_by: bigint | null;
  closed_by_name: string | null;
};

/** Which way `difference` points. */
export function directionOf(difference: bigint): Direction {
  return difference === 0n ? 'unchanged' : difference > 0n ? 'up' : 'down';
}

/** An account's balance at both ends of the comparison. */
interface Line {
  account: AccountBalance;
  /** Balance at the previous check-in; zero when there is none. */
  opening: bigint;
  closing: bigint;
  existedBefore: boolean;
  existsNow: boolean;
}

/** True when the account has a balance of its own at `at`. */
function existsAt(account: AccountBalance | undefined, at: number): boolean {
  if (!account || account.takenAt === null) return false;
  return account.deactivatedAt === null || account.deactivatedAt > at;
}

/**
 * Sums `values`, or returns `null` when one is `null` (a missing rate makes a
 * total incomplete, never wrong).
 */
function sumOrNull(values: readonly (bigint | null)[]): bigint | null {
  let sum = 0n;
  for (const value of values) {
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

const text = (value: bigint | null): string | null =>
  value === null ? null : toMinorString(value);

/**
 * Computes the summary of a closed check-in from stored data (SUM-1, COR-4),
 * following design section 6 of spec 01: balances come from `balanceAt` at the
 * close of this and the previous closed check-in, and each figure is valued at
 * the rates of its own closing day in the family's time zone.
 *
 * The change in the equivalent is split into "From balances", the sum of each
 * account's change converted at this check-in's rates and rounded, and "From
 * exchange rates", which is the rest. The rounding remainder therefore lands
 * in the second line and the two always add up to the change exactly.
 * @throws {Error} if the family is not set up or an account has an unknown
 * currency.
 */
export function getCheckinSummary(
  database: Database.Database,
  checkinId: number,
): SummaryResult {
  const row = database
    .prepare(
      `SELECT c.id, c.closed_at, c.closed_by, m.name AS closed_by_name
       FROM checkin c LEFT JOIN member m ON m.id = c.closed_by
       WHERE c.id = ?`,
    )
    .get(checkinId) as CheckinRow | undefined;
  if (!row) return { status: 'not_found' };
  if (row.closed_at === null) return { status: 'open' };

  const valuation = createValuation(database);
  const closedAt = Number(row.closed_at);
  const previousRow = database
    .prepare(
      `SELECT id, closed_at FROM checkin
       WHERE closed_at IS NOT NULL
         AND (closed_at < ? OR (closed_at = ? AND id < ?))
       ORDER BY closed_at DESC, id DESC LIMIT 1`,
    )
    .get(closedAt, closedAt, checkinId) as
    { id: bigint; closed_at: bigint } | undefined;
  const previousAt = previousRow ? Number(previousRow.closed_at) : null;
  const date = valuation.dateOf(closedAt);
  const previousDate =
    previousAt === null ? null : valuation.dateOf(previousAt);

  const closingBalances = balanceAt(database, closedAt);
  const openingById = new Map(
    (previousAt === null ? [] : balanceAt(database, previousAt)).map(
      (account) => [account.accountId, account],
    ),
  );
  const lines: Line[] = [];
  for (const account of closingBalances) {
    const opening = openingById.get(account.accountId);
    const line: Line = {
      account,
      opening: opening?.balance ?? 0n,
      closing: account.balance,
      existedBefore: existsAt(opening, previousAt ?? 0),
      existsNow: existsAt(account, closedAt),
    };
    if (line.existsNow || line.existedBefore) lines.push(line);
  }

  const missing = new Map<string, { currency: string; date: string }>();
  /** Converts at `on`, noting the rate that was missing when there is none. */
  const toCommon = (
    amount: bigint,
    currency: string,
    on: string,
  ): bigint | null => {
    const value = valuation.toCommon(amount, currency, on);
    if (value === undefined) {
      missing.set(`${currency}|${on}`, { currency, date: on });
      return null;
    }
    return value;
  };

  // Per currency (SUM-2) and its equivalent at each end's own rates (SUM-3).
  const closingTotals = new Map<string, bigint>();
  const openingTotals = new Map<string, bigint>();
  for (const { account, opening, closing } of lines) {
    closingTotals.set(
      account.currency,
      (closingTotals.get(account.currency) ?? 0n) + closing,
    );
    openingTotals.set(
      account.currency,
      (openingTotals.get(account.currency) ?? 0n) + opening,
    );
  }
  const common = valuation.commonCurrency.code;
  const codes = [...closingTotals.keys()].sort((left, right) =>
    left === common ? -1 : right === common ? 1 : left.localeCompare(right),
  );
  const currencies = codes.map((code) => {
    const current = closingTotals.get(code) ?? 0n;
    const previous =
      previousDate === null ? null : (openingTotals.get(code) ?? 0n);
    const difference = previous === null ? null : current - previous;
    return {
      currency: code,
      current,
      previous,
      difference,
      direction: difference === null ? null : directionOf(difference),
      currentEquivalent: toCommon(current, code, date),
      previousEquivalent:
        previous === null || previousDate === null
          ? null
          : toCommon(previous, code, previousDate),
    };
  });

  const currentTotal = sumOrNull(
    currencies.map((row) => row.currentEquivalent),
  );
  const hasPrevious = previousRow !== undefined && previousDate !== null;
  const previousTotal = hasPrevious
    ? sumOrNull(currencies.map((row) => row.previousEquivalent))
    : null;
  const change =
    currentTotal !== null && previousTotal !== null
      ? currentTotal - previousTotal
      : null;

  // Each account's change at this check-in's rates (step 4); the rounding
  // remainder stays in "From exchange rates".
  const changes = hasPrevious
    ? lines.map((line) => {
        const own = line.closing - line.opening;
        return {
          line,
          own,
          common: toCommon(own, line.account.currency, date),
        };
      })
    : [];
  const fromBalances = hasPrevious
    ? sumOrNull(changes.map((entry) => entry.common))
    : null;
  const fromExchangeRates =
    change !== null && fromBalances !== null ? change - fromBalances : null;

  const groupSums = <Key>(keyOf: (line: Line) => Key) => {
    const groups = new Map<Key, (bigint | null)[]>();
    for (const entry of changes) {
      const key = keyOf(entry.line);
      groups.set(key, [...(groups.get(key) ?? []), entry.common]);
    }
    return groups;
  };
  const byMember = [
    ...groupSums((line) => line.account.ownerMemberId).entries(),
  ]
    .map(([memberId, values]) => {
      const owner = changes.find(
        (entry) => entry.line.account.ownerMemberId === memberId,
      )?.line.account;
      return {
        memberId,
        name: owner?.ownerName ?? null,
        change: text(sumOrNull(values)),
      };
    })
    .sort((left, right) =>
      left.memberId === null
        ? 1
        : right.memberId === null
          ? -1
          : (left.name ?? '').localeCompare(right.name ?? '', 'en', {
              sensitivity: 'base',
            }),
    );
  const typeSums = groupSums((line) => line.account.type as AccountType);
  const byType = accountTypeOrder.flatMap((type) => {
    const values = typeSums.get(type);
    return values ? [{ type, change: text(sumOrNull(values)) }] : [];
  });

  const biggestChanges: SummaryAccount[] = changes
    .filter(
      (entry): entry is typeof entry & { common: bigint } =>
        entry.common !== null && entry.common !== 0n,
    )
    .sort((left, right) => {
      const gap = abs(right.common) - abs(left.common);
      return gap === 0n
        ? left.line.account.accountId - right.line.account.accountId
        : gap > 0n
          ? 1
          : -1;
    })
    .slice(0, biggestChangeCount)
    .map((entry) => ({
      ...describeAccount(entry.line.account),
      type: entry.line.account.type as AccountType,
      change: toMinorString(entry.own),
      changeEquivalent: toMinorString(entry.common),
    }));

  const accountsWhere = (keep: (line: Line) => boolean) =>
    lines.filter(keep).map((line) => describeAccount(line.account));
  const previousAtOrZero = previousAt ?? 0;

  return {
    status: 'ok',
    summary: {
      checkin: {
        id: Number(row.id),
        closedAt,
        date,
        closedBy:
          row.closed_by === null
            ? null
            : {
                memberId: Number(row.closed_by),
                name: row.closed_by_name ?? '',
              },
      },
      previous:
        previousRow && previousDate !== null
          ? {
              id: Number(previousRow.id),
              closedAt: Number(previousRow.closed_at),
              date: previousDate,
            }
          : null,
      commonCurrency: common,
      timeZone: valuation.timeZone,
      currencies: currencies.map((entry) => ({
        currency: entry.currency,
        current: toMinorString(entry.current),
        previous: text(entry.previous),
        difference: text(entry.difference),
        direction: entry.direction,
        currentEquivalent: text(entry.currentEquivalent),
        previousEquivalent: text(entry.previousEquivalent),
      })),
      total: {
        current: text(currentTotal),
        previous: text(previousTotal),
        change: text(change),
        direction: change === null ? null : directionOf(change),
        complete:
          currentTotal !== null && (!hasPrevious || previousTotal !== null),
      },
      missingRates: [...missing.values()].sort(
        (left, right) =>
          left.currency.localeCompare(right.currency) ||
          left.date.localeCompare(right.date),
      ),
      fromBalances: text(fromBalances),
      fromExchangeRates: text(fromExchangeRates),
      byMember,
      byType,
      biggestChanges,
      alsoInThisCheckin: {
        notChanged: accountsWhere(
          (line) => line.existsNow && line.account.source === 'carried_forward',
        ),
        added: hasPrevious
          ? accountsWhere((line) => line.existsNow && !line.existedBefore)
          : [],
        deactivated: hasPrevious
          ? accountsWhere(
              (line) =>
                line.existedBefore &&
                line.account.deactivatedAt !== null &&
                line.account.deactivatedAt > previousAtOrZero &&
                line.account.deactivatedAt <= closedAt,
            )
          : [],
      },
    },
  };
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** The fields a summary list shows for an account. */
function describeAccount(account: AccountBalance) {
  return {
    accountId: account.accountId,
    name: account.name,
    ownerName: account.ownerName,
    currency: account.currency,
  };
}
