import type Database from 'better-sqlite3';
import {
  isOlderThanCadencePeriod,
  type AccountsQuery,
} from '@budget-buddy/shared';

const snapshotSourceOrder = `CASE s.source
  WHEN 'connector' THEN 0
  WHEN 'statement' THEN 1
  WHEN 'photo' THEN 2
  WHEN 'checkin' THEN 3
  WHEN 'manual' THEN 4
  WHEN 'opening' THEN 5
  WHEN 'carried_forward' THEN 6
  ELSE 7
END`;

/** Account fields and its balance at one instant. */
export interface AccountBalance {
  accountId: number;
  name: string;
  ownerMemberId: number | null;
  ownerName: string | null;
  ownerActive: boolean | null;
  type: string;
  currency: string;
  active: boolean;
  deactivatedAt: number | null;
  balance: bigint;
  takenAt: number | null;
  source: string | null;
  updatedBy: number | null;
  stale: boolean;
  createdBy: number;
  createdAt: number;
  updatedByAccount: number;
  updatedAt: number;
}

/** Filters accepted by the shared balance query. */
export interface BalanceAtFilters {
  accountIds?: readonly number[];
  owner?: number;
  type?: AccountsQuery['type'];
  currency?: string;
  includeInactive?: boolean;
}

type BalanceRow = {
  id: bigint;
  name: string;
  owner_member_id: bigint | null;
  owner_name: string | null;
  owner_active: bigint | null;
  type: string;
  currency: string;
  active: bigint;
  deactivated_at: bigint | null;
  snapshot_amount: bigint | null;
  snapshot_taken_at: bigint | null;
  snapshot_source: string | null;
  snapshot_updated_by: bigint | null;
  created_by: bigint;
  created_at: bigint;
  updated_by: bigint;
  updated_at: bigint;
  time_zone: string;
  cadence_kind: 'off' | 'monthly' | 'weeks';
  cadence_every_weeks: bigint | null;
};

/**
 * Returns balances at `at`, using the shared snapshot tie-break order. When
 * called without IDs it also serves the account list in one database query.
 */
export function balanceAt(
  database: Database.Database,
  at: number,
  filters: BalanceAtFilters = {},
): AccountBalance[] {
  if (filters.accountIds?.length === 0) return [];

  const clauses: string[] = [];
  const parameters: Array<number | string> = [];
  if (filters.accountIds) {
    clauses.push(`a.id IN (${filters.accountIds.map(() => '?').join(', ')})`);
    parameters.push(...filters.accountIds);
  }
  if (filters.owner !== undefined) {
    clauses.push('a.owner_member_id = ?');
    parameters.push(filters.owner);
  }
  if (filters.type !== undefined) {
    clauses.push('a.type = ?');
    parameters.push(filters.type);
  }
  if (filters.currency !== undefined) {
    clauses.push('a.currency = ?');
    parameters.push(filters.currency.toUpperCase());
  }
  if (filters.includeInactive === false) clauses.push('a.active = 1');
  const accountWhere =
    clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = database
    .prepare(
      `WITH selected_accounts AS (
         SELECT a.* FROM account a ${accountWhere}
       ), ranked_snapshots AS (
         SELECT s.*,
                ROW_NUMBER() OVER (
                  PARTITION BY s.account_id
                  ORDER BY s.taken_at DESC, ${snapshotSourceOrder}, s.id DESC
                ) AS snapshot_rank
         FROM snapshot s
         JOIN selected_accounts a ON a.id = s.account_id
         WHERE s.taken_at <= ?
       )
       SELECT a.id, a.name, a.owner_member_id, owner.name AS owner_name,
              owner.active AS owner_active, a.type, a.currency, a.active,
              a.deactivated_at, s.amount AS snapshot_amount,
              s.taken_at AS snapshot_taken_at, s.source AS snapshot_source,
              s.updated_by AS snapshot_updated_by, a.created_by, a.created_at,
              a.updated_by, a.updated_at, f.time_zone, f.cadence_kind,
              f.cadence_every_weeks
       FROM selected_accounts a
       JOIN family f ON f.id = 1
       LEFT JOIN member owner ON owner.id = a.owner_member_id
       LEFT JOIN ranked_snapshots s
         ON s.account_id = a.id AND s.snapshot_rank = 1
       ORDER BY COALESCE(owner.name, '') COLLATE NOCASE, a.name COLLATE NOCASE,
                a.id`,
    )
    .all(...parameters, at) as BalanceRow[];

  return rows.map((row) => {
    const deactivatedAt =
      row.deactivated_at === null ? null : Number(row.deactivated_at);
    const snapshotTakenAt =
      row.snapshot_taken_at === null ? null : Number(row.snapshot_taken_at);
    const isDeactivated = deactivatedAt !== null && deactivatedAt <= at;
    return {
      accountId: Number(row.id),
      name: row.name,
      ownerMemberId:
        row.owner_member_id === null ? null : Number(row.owner_member_id),
      ownerName: row.owner_name,
      ownerActive: row.owner_active === null ? null : row.owner_active === 1n,
      type: row.type,
      currency: row.currency,
      active: row.active === 1n,
      deactivatedAt,
      balance: isDeactivated ? 0n : (row.snapshot_amount ?? 0n),
      takenAt: snapshotTakenAt,
      source: row.snapshot_source,
      updatedBy:
        row.snapshot_updated_by === null
          ? null
          : Number(row.snapshot_updated_by),
      stale: isStale(
        snapshotTakenAt,
        at,
        row.time_zone,
        row.cadence_kind,
        row.cadence_every_weeks === null
          ? null
          : Number(row.cadence_every_weeks),
      ),
      createdBy: Number(row.created_by),
      createdAt: Number(row.created_at),
      updatedByAccount: Number(row.updated_by),
      updatedAt: Number(row.updated_at),
    };
  });
}

function isStale(
  takenAt: number | null,
  at: number,
  timeZone: string,
  cadenceKind: BalanceRow['cadence_kind'],
  cadenceEveryWeeks: number | null,
): boolean {
  if (takenAt === null || cadenceKind === 'off') return false;
  return isOlderThanCadencePeriod(
    new Date(takenAt),
    new Date(at),
    timeZone,
    cadenceKind === 'monthly'
      ? { kind: 'monthly' }
      : { kind: 'weeks', every: cadenceEveryWeeks ?? 1 },
  );
}

type TotalsRow = {
  account_id: bigint;
  currency: string;
  deactivated_at: bigint | null;
  taken_at: bigint;
  amount: bigint;
};

/**
 * Family totals per currency at each of `instants`, from one query over all
 * snapshots instead of one `balanceAt` per instant. It applies the same rules
 * as `balanceAt`: the latest snapshot at or before the instant wins, the
 * source order and then the higher id settle ties, and an account counts as
 * zero from its deactivation on.
 * @returns One map of currency to minor units per instant, in the same order.
 */
export function currencyTotalsAt(
  database: Database.Database,
  instants: readonly number[],
): Array<Map<string, bigint>> {
  const totals = instants.map(() => new Map<string, bigint>());
  const order = instants
    .map((instant, index) => ({ instant, index }))
    .sort((left, right) => left.instant - right.instant);

  // Oldest first, and within one `taken_at` the winner last.
  const rows = database
    .prepare(
      `SELECT s.account_id, a.currency, a.deactivated_at, s.taken_at, s.amount
       FROM snapshot s JOIN account a ON a.id = s.account_id
       ORDER BY s.account_id, s.taken_at ASC, (${snapshotSourceOrder}) DESC,
                s.id ASC`,
    )
    .all() as TotalsRow[];

  let start = 0;
  while (start < rows.length) {
    const first = rows[start] as TotalsRow;
    let end = start;
    while (end < rows.length && rows[end]?.account_id === first.account_id) {
      end += 1;
    }
    const deactivatedAt =
      first.deactivated_at === null ? null : Number(first.deactivated_at);
    // `cursor` is the winning snapshot of the account at the current instant.
    let cursor = start - 1;
    for (const { instant, index } of order) {
      while (
        cursor + 1 < end &&
        Number((rows[cursor + 1] as TotalsRow).taken_at) <= instant
      ) {
        cursor += 1;
      }
      if (cursor < start) continue;
      if (deactivatedAt !== null && deactivatedAt <= instant) continue;
      const row = rows[cursor] as TotalsRow;
      const map = totals[index] as Map<string, bigint>;
      map.set(row.currency, (map.get(row.currency) ?? 0n) + row.amount);
    }
    start = end;
  }
  return totals;
}
