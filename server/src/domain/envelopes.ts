import type Database from 'better-sqlite3';
import {
  addMonths,
  convert,
  getCurrency,
  monthsBetween,
  type CoinCurrency,
  type Currency,
} from '@budget-buddy/shared';
import { createRateLookup } from '../rates/lookup.js';

/** How a top-up treats what the previous month left (requirements 4.4). */
export type EnvelopeMode = 'carry_over' | 'reset';

/** A monthly amount and mode that apply from `fromMonth` on (ENV-4). */
export interface EnvelopePlan {
  fromMonth: string;
  /** Minor units of the envelope's currency. */
  monthlyAmount: bigint;
  mode: EnvelopeMode;
}

/**
 * The stored rows of one envelope, summed by month, that its record is
 * computed from. Expenses and adjustments dated before `startingMonth` are
 * summed into `startingMonth` (O3).
 */
export interface EnvelopeLedger {
  id: number;
  name: string;
  currency: string;
  startingBalance: bigint;
  startingMonth: string;
  /** The first month that gets a top-up. */
  topupFromMonth: string;
  archived: boolean;
  /** Oldest first. */
  plans: EnvelopePlan[];
  topUps: Map<string, { amount: bigint; mode: EnvelopeMode }>;
  adjustments: Map<string, bigint>;
  /** `missing` counts the parts whose envelope amount is not known yet. */
  spent: Map<string, { amount: bigint; missing: number }>;
}

/**
 * One month of an envelope's record (ENV-6). Amounts are minor units of the
 * envelope's currency; `available = opening + topUp + adjustments` and
 * `closing = available − spent`.
 */
export interface EnvelopeMonth {
  month: string;
  /** The starting balance in the first month, else what was carried in. */
  opening: bigint;
  topUp: bigint;
  /** The mode of the month's top-up row, or null when it has none. */
  topUpMode: EnvelopeMode | null;
  /** The previous closing that a reset top-up dropped; null otherwise. */
  dropped: bigint | null;
  adjustments: bigint;
  /** Expenses less refunds; parts with a missing amount add nothing. */
  spent: bigint;
  available: bigint;
  /** The balance; for the current month, the envelope's balance now. */
  closing: bigint;
  /** `topUp + adjustments − spent`, summed as "Left over, net" (3.2). */
  result: bigint;
  /** Whether the month lies before the current one. */
  closed: boolean;
  /** `closing ≥ 0` for a closed month; null for the current one. */
  withinBudget: boolean | null;
  /** A part of this month has no envelope amount (its rate is missing). */
  incomplete: boolean;
  /**
   * The closing depends on an incomplete month: this one, or an earlier one
   * carried in without a reset since.
   */
  closingIncomplete: boolean;
}

/**
 * Computes the record of every month from the envelope's starting month to
 * `upTo`, the current month in the family's time zone (Design 3.1). Months
 * before `upTo` are closed. Nothing of it is stored, so a corrected old
 * expense shows up in its month. An empty list when `upTo` is before the
 * starting month.
 */
export function envelopeMonths(
  envelope: EnvelopeLedger,
  upTo: string,
): EnvelopeMonth[] {
  const months: EnvelopeMonth[] = [];
  let previous: EnvelopeMonth | undefined;
  for (
    let month = envelope.startingMonth;
    month <= upTo;
    month = addMonths(month, 1)
  ) {
    const row = envelope.topUps.get(month);
    const topUp = row?.amount ?? 0n;
    const reset = previous !== undefined && row?.mode === 'reset';
    const opening =
      previous === undefined
        ? envelope.startingBalance
        : reset
          ? 0n
          : previous.closing;
    const adjustments = envelope.adjustments.get(month) ?? 0n;
    const spending = envelope.spent.get(month);
    const spent = spending?.amount ?? 0n;
    const incomplete = (spending?.missing ?? 0) > 0;
    const available = opening + topUp + adjustments;
    const closing = available - spent;
    const closed = month < upTo;
    const current: EnvelopeMonth = {
      month,
      opening,
      topUp,
      topUpMode: row?.mode ?? null,
      dropped: reset && previous ? previous.closing : null,
      adjustments,
      spent,
      available,
      closing,
      result: topUp + adjustments - spent,
      closed,
      withinBudget: closed ? closing >= 0n : null,
      incomplete,
      closingIncomplete:
        incomplete || (!reset && (previous?.closingIncomplete ?? false)),
    };
    months.push(current);
    previous = current;
  }
  return months;
}

/** The periods the history's statistics can cover (ENV-9). */
export type StatisticsPeriod = 'last6' | 'last12' | 'thisYear' | 'all';

/** Statistics of an envelope's closed months in a period (Design 3.2). */
export interface EnvelopeStatistics {
  /** Closed months in the period. */
  months: number;
  /** Of those, the months whose closing was zero or more. */
  withinBudget: number;
  /**
   * Σ spent ÷ months, rounded half away from zero to minor units; null when
   * the period has no closed month.
   */
  averageSpent: bigint | null;
  /** The most negative closing, as a positive amount; null if none. */
  largestOverspend: { month: string; amount: bigint } | null;
  /** Σ result, signed: left over when positive, overspent when negative. */
  leftOverNet: bigint;
  /**
   * A closing in the period depends on a missing envelope amount, in the
   * period or carried in from before it, so the figures are not exact.
   */
  incomplete: boolean;
}

/**
 * Computes the statistics of the closed months of `months` (as returned by
 * `envelopeMonths`) in a period: the last 6 or 12, those of the current
 * month's calendar year, or all. The current month never counts.
 */
export function envelopeStatistics(
  months: readonly EnvelopeMonth[],
  period: StatisticsPeriod,
  currentMonth: string,
): EnvelopeStatistics {
  const closed = months.filter((month) => month.closed);
  const year = currentMonth.slice(0, 4);
  const chosen =
    period === 'last6'
      ? closed.slice(-6)
      : period === 'last12'
        ? closed.slice(-12)
        : period === 'thisYear'
          ? closed.filter(({ month }) => month.startsWith(`${year}-`))
          : closed;
  let spent = 0n;
  let leftOverNet = 0n;
  let withinBudget = 0;
  let largestOverspend: EnvelopeStatistics['largestOverspend'] = null;
  for (const month of chosen) {
    spent += month.spent;
    leftOverNet += month.result;
    if (month.withinBudget) withinBudget += 1;
    if (
      month.closing < 0n &&
      (largestOverspend === null || -month.closing > largestOverspend.amount)
    ) {
      largestOverspend = { month: month.month, amount: -month.closing };
    }
  }
  return {
    months: chosen.length,
    withinBudget,
    averageSpent:
      chosen.length === 0 ? null : divideRounded(spent, BigInt(chosen.length)),
    largestOverspend,
    leftOverNet,
    incomplete: chosen.some((month) => month.closingIncomplete),
  };
}

/** The plan in force in `month`: the latest from `month` or earlier. */
export function planForMonth(
  plans: readonly EnvelopePlan[],
  month: string,
): EnvelopePlan | undefined {
  let found: EnvelopePlan | undefined;
  for (const plan of plans) {
    if (plan.fromMonth <= month) found = plan;
  }
  return found;
}

/** An envelope with its record up to the current month and its plans. */
export interface EnvelopeState {
  ledger: EnvelopeLedger;
  months: EnvelopeMonth[];
  /** The current month's record; its `closing` is the balance. */
  current: EnvelopeMonth | undefined;
  /** The plan in force this month. */
  plan: EnvelopePlan | undefined;
  /** A plan waiting for a later month ("From 1 November", O4), if any. */
  pendingPlan: EnvelopePlan | undefined;
}

/**
 * Reads every envelope, or only `envelopeId`, archived ones included, with
 * its record up to `currentMonth`, in envelope order.
 */
export function listEnvelopeStates(
  database: Database.Database,
  currentMonth: string,
  envelopeId?: number,
): EnvelopeState[] {
  return loadEnvelopeLedgers(database, envelopeId).map((ledger) => {
    const months = envelopeMonths(ledger, currentMonth);
    return {
      ledger,
      months,
      current: months.at(-1),
      plan: planForMonth(ledger.plans, currentMonth),
      pendingPlan: ledger.plans.find(
        ({ fromMonth }) => fromMonth > currentMonth,
      ),
    };
  });
}

type EnvelopeRow = {
  id: bigint;
  name: string;
  currency: string;
  startingBalance: bigint;
  startingMonth: string;
  topupFromMonth: string;
  archivedAt: bigint | null;
};
type PlanRow = {
  envelopeId: bigint;
  fromMonth: string;
  monthlyAmount: bigint;
  mode: EnvelopeMode;
};
type TopUpRow = {
  envelopeId: bigint;
  month: string;
  amount: bigint;
  mode: EnvelopeMode;
};
type SumRow = {
  envelopeId: bigint;
  month: string;
  amount: bigint | null;
  missing: bigint;
};

/**
 * Reads the stored rows of every envelope, or only `envelopeId`, summed by
 * month in SQL, in envelope order. Only confirmed expenses count (a draft
 * counts nowhere, requirements 4.6).
 */
export function loadEnvelopeLedgers(
  database: Database.Database,
  envelopeId?: number,
): EnvelopeLedger[] {
  const only = envelopeId ?? null;
  const envelopes = database
    .prepare(
      `SELECT id, name, currency, starting_balance AS startingBalance,
        starting_month AS startingMonth, topup_from_month AS topupFromMonth,
        archived_at AS archivedAt
      FROM envelope WHERE @only IS NULL OR id = @only ORDER BY position, id`,
    )
    .all({ only }) as EnvelopeRow[];
  const ledgers = new Map<number, EnvelopeLedger>();
  for (const row of envelopes) {
    ledgers.set(Number(row.id), {
      id: Number(row.id),
      name: row.name,
      currency: row.currency,
      startingBalance: row.startingBalance,
      startingMonth: row.startingMonth,
      topupFromMonth: row.topupFromMonth,
      archived: row.archivedAt !== null,
      plans: [],
      topUps: new Map(),
      adjustments: new Map(),
      spent: new Map(),
    });
  }
  const ledgerOf = (id: bigint) => ledgers.get(Number(id));

  const plans = database
    .prepare(
      `SELECT envelope_id AS envelopeId, from_month AS fromMonth,
        monthly_amount AS monthlyAmount, mode
      FROM envelope_plan WHERE @only IS NULL OR envelope_id = @only
      ORDER BY envelope_id, from_month`,
    )
    .all({ only }) as PlanRow[];
  for (const { envelopeId: id, fromMonth, monthlyAmount, mode } of plans) {
    ledgerOf(id)?.plans.push({ fromMonth, monthlyAmount, mode });
  }

  const topUps = database
    .prepare(
      `SELECT envelope_id AS envelopeId, month, amount, mode
      FROM envelope_topup WHERE @only IS NULL OR envelope_id = @only`,
    )
    .all({ only }) as TopUpRow[];
  for (const { envelopeId: id, month, amount, mode } of topUps) {
    ledgerOf(id)?.topUps.set(month, { amount, mode });
  }

  const adjustments = database
    .prepare(
      `SELECT a.envelope_id AS envelopeId,
        MAX(substr(a.date, 1, 7), e.starting_month) AS month,
        SUM(a.amount) AS amount, 0 AS missing
      FROM envelope_adjustment a JOIN envelope e ON e.id = a.envelope_id
      WHERE @only IS NULL OR a.envelope_id = @only
      GROUP BY 1, 2`,
    )
    .all({ only }) as SumRow[];
  for (const { envelopeId: id, month, amount } of adjustments) {
    ledgerOf(id)?.adjustments.set(month, amount ?? 0n);
  }

  const spent = database
    .prepare(
      `SELECT p.envelope_id AS envelopeId,
        MAX(substr(t.date, 1, 7), e.starting_month) AS month,
        SUM(p.envelope_amount) AS amount,
        COUNT(*) - COUNT(p.envelope_amount) AS missing
      FROM txn_part p
        JOIN txn t ON t.id = p.txn_id
        JOIN envelope e ON e.id = p.envelope_id
      WHERE p.envelope_id IS NOT NULL
        AND (@only IS NULL OR p.envelope_id = @only)
        AND t.kind = 'expense' AND t.status = 'confirmed'
      GROUP BY 1, 2`,
    )
    .all({ only }) as SumRow[];
  for (const { envelopeId: id, month, amount, missing } of spent) {
    ledgerOf(id)?.spent.set(month, {
      amount: amount ?? 0n,
      missing: Number(missing),
    });
  }
  return [...ledgers.values()];
}

/**
 * Stores a plan from `fromMonth` on, replacing one already stored for that
 * month, so a second change in a month replaces the pending one (O4).
 */
export function savePlan(
  database: Database.Database,
  plan: EnvelopePlan & { envelopeId: number; createdBy: number; now: number },
): void {
  database
    .prepare(
      `INSERT INTO envelope_plan (envelope_id, from_month, monthly_amount,
        mode, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (envelope_id, from_month) DO UPDATE SET
        monthly_amount = excluded.monthly_amount, mode = excluded.mode,
        created_by = excluded.created_by, created_at = excluded.created_at`,
    )
    .run(
      plan.envelopeId,
      plan.fromMonth,
      plan.monthlyAmount,
      plan.mode,
      plan.createdBy,
      plan.now,
    );
}

/**
 * Inserts the missing top-ups of every envelope that is not archived, for
 * each month from its `topup_from_month` up to `month`, with the amount and
 * mode of that month's plan (Design 3.1). Months already topped up are left
 * as they are, so running it again inserts nothing (COR-3).
 * @returns The number of top-ups inserted.
 */
export function topUpEnvelopes(
  database: Database.Database,
  month: string,
  now: number,
): number {
  const envelopes = database.prepare(
    `SELECT id, topup_from_month AS topupFromMonth FROM envelope
    WHERE archived_at IS NULL AND topup_from_month <= ?`,
  );
  const selectPlans = database.prepare(
    `SELECT from_month AS fromMonth, monthly_amount AS monthlyAmount, mode
    FROM envelope_plan WHERE envelope_id = ? ORDER BY from_month`,
  );
  const insert = database.prepare(
    `INSERT INTO envelope_topup (envelope_id, month, amount, mode, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (envelope_id, month) DO NOTHING`,
  );
  return database.transaction(() => {
    let inserted = 0;
    const rows = envelopes.all(month) as Array<{
      id: bigint;
      topupFromMonth: string;
    }>;
    for (const { id, topupFromMonth } of rows) {
      const plans = selectPlans.all(id) as EnvelopePlan[];
      for (const at of monthsBetween(topupFromMonth, month)) {
        // Creation writes a plan from the starting month, so one is found.
        const plan = planForMonth(plans, at);
        if (!plan) continue;
        inserted += insert.run(
          id,
          at,
          plan.monthlyAmount,
          plan.mode,
          now,
        ).changes;
      }
    }
    return inserted;
  })();
}

type PendingRow = {
  id: bigint;
  amount: bigint;
  date: string;
  accountCurrency: string;
  envelopeCurrency: string;
};

/**
 * Converts the envelope amounts that are still missing because no rate
 * existed when the expense was saved (Design 3.3), at the rate of the
 * transaction's date or the nearest earlier one, rounded once. Parts whose
 * rate is still missing stay null. Run after new rates are stored and at
 * start.
 * @returns The number of parts filled.
 */
export function fillPendingEnvelopeAmounts(
  database: Database.Database,
): number {
  const pending = database
    .prepare(
      `SELECT p.id, p.amount, t.date, a.currency AS accountCurrency,
        e.currency AS envelopeCurrency
      FROM txn_part p
        JOIN txn t ON t.id = p.txn_id
        JOIN account a ON a.id = t.account_id
        JOIN envelope e ON e.id = p.envelope_id
      WHERE p.envelope_id IS NOT NULL AND p.envelope_amount IS NULL`,
    )
    .all() as PendingRow[];
  if (pending.length === 0) return 0;
  const coins = (
    database.prepare('SELECT code, name, decimals FROM coin').all() as Array<{
      code: string;
      name: string;
      decimals: bigint;
    }>
  ).map((coin): CoinCurrency => ({ ...coin, decimals: Number(coin.decimals) }));
  const known = new Map<string, Currency | undefined>();
  const currency = (code: string) => {
    if (!known.has(code)) known.set(code, getCurrency(code, coins));
    return known.get(code);
  };
  const lookup = createRateLookup(database);
  // Only while still missing, so a value typed meanwhile is never replaced.
  const update = database.prepare(
    `UPDATE txn_part SET envelope_amount = ?
    WHERE id = ? AND envelope_amount IS NULL`,
  );
  return database.transaction(() => {
    let filled = 0;
    for (const row of pending) {
      const from = currency(row.accountCurrency);
      const to = currency(row.envelopeCurrency);
      if (!from || !to) continue;
      const result = convert(row.amount, from, to, row.date, lookup);
      if ('missing' in result) continue;
      filled += update.run(result.value, row.id).changes;
    }
    return filled;
  })();
}

/** Divides minor units, rounding half away from zero. */
function divideRounded(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  const absolute = remainder < 0n ? -remainder : remainder;
  if (absolute * 2n < divisor) return quotient;
  return quotient + (value < 0n ? -1n : 1n);
}
