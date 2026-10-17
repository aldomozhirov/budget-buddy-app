import type Database from 'better-sqlite3';
import {
  monthOfDate,
  toMinorString,
  type HomeEnvelope,
  type HomeResponse,
} from '@budget-buddy/shared';
import { monthSpent } from '../modules/transactions/list.js';
import { needsCategoryCount } from '../modules/transactions/needsCategory.js';
import { currencyTotalsAt } from './balance.js';
import { getCheckin } from './checkin.js';
import { listEnvelopeStates } from './envelopes.js';
import { createValuation, type Valuation } from './valuation.js';

const dayMs = 86_400_000;

type FamilyRow = {
  cadence_kind: 'off' | 'monthly' | 'weeks';
  cadence_every_weeks: bigint | null;
};

/** Who is asking, and when, for the Home summary. */
export interface HomeOptions {
  /** The signed-in profile, whose accounts the banner counts. */
  memberId: number;
  /** The device whose "Hide amounts on Home" setting is reported. */
  deviceId: string;
  /** The current instant (UTC epoch milliseconds). */
  now: number;
}

/**
 * Builds everything Home shows (DSH-1, DSH-4, NTF-1, BKP-4, O2). The banner has
 * no amounts. Wealth is the latest balances at the latest rates, with the
 * change against the latest closed check-in's equivalent at its own rates.
 * @throws {Error} if the family is not set up or an account has an unknown
 * currency.
 */
export function getHome(
  database: Database.Database,
  options: HomeOptions,
): HomeResponse {
  const valuation = createValuation(database);
  const device = database
    .prepare('SELECT hide_home_amounts FROM device WHERE id = ?')
    .get(options.deviceId) as { hide_home_amounts: bigint } | undefined;
  return {
    today: valuation.dateOf(options.now),
    commonCurrency: valuation.commonCurrency.code,
    // An unknown device gets the safe default.
    hideAmounts: device === undefined || device.hide_home_amounts !== 0n,
    checkin: openCheckin(database, valuation, options),
    wealth: wealth(database, valuation, options.now),
    spending: spending(database, valuation, options.now),
    needsCategory: needsCategoryCount(database),
    backupWarning: backupWarning(database, options.now),
  };
}

function openCheckin(
  database: Database.Database,
  valuation: Valuation,
  options: HomeOptions,
): HomeResponse['checkin'] {
  const open = database
    .prepare('SELECT id FROM checkin WHERE closed_at IS NULL')
    .get() as { id: bigint } | undefined;
  if (!open) return null;
  const checkin = getCheckin(
    database,
    Number(open.id),
    options.memberId,
    options.now,
  );
  if (!checkin) return null;
  const mine = checkin.members.find(
    (member) => member.memberId === options.memberId,
  );
  const family = database
    .prepare(
      'SELECT cadence_kind, cadence_every_weeks FROM family WHERE id = 1',
    )
    .get() as FamilyRow;
  const scheduled = checkin.scheduleSlot !== null;
  return {
    id: checkin.id,
    scheduled,
    cadence: scheduled ? cadenceName(family) : null,
    openedBy: checkin.openedBy?.name ?? null,
    openedByYou: checkin.openedBy?.memberId === options.memberId,
    openedDate: valuation.dateOf(checkin.openedAt),
    accountsLeft: mine ? mine.accounts - mine.completed : 0,
  };
}

/** A rhythm with a plain name: monthly, or every week; anything else none. */
function cadenceName(family: FamilyRow): 'monthly' | 'weekly' | null {
  if (family.cadence_kind === 'monthly') return 'monthly';
  if (family.cadence_kind === 'weeks' && family.cadence_every_weeks === 1n) {
    return 'weekly';
  }
  return null;
}

/**
 * This month's envelopes card: the month's spending in the common currency
 * and the active envelopes with the share used. Null without envelopes.
 */
function spending(
  database: Database.Database,
  valuation: Valuation,
  now: number,
): HomeResponse['spending'] {
  const today = valuation.dateOf(now);
  const envelopes = listEnvelopeStates(database, monthOfDate(today))
    .filter(({ ledger, current }) => !ledger.archived && current)
    .map(({ ledger, current }): HomeEnvelope => {
      const { available, spent, closing } = current!;
      const over = closing < 0n;
      return {
        id: ledger.id,
        name: ledger.name,
        currency: ledger.currency,
        available: toMinorString(available),
        spent: toMinorString(spent),
        left: toMinorString(closing),
        share: over ? 100 : shareUsed(spent, available),
        over,
      };
    });
  if (envelopes.length === 0) return null;
  return { spent: monthSpent(database, valuation, today), envelopes };
}

/** Whole percent of `available` that `spent` is, rounded down; 0 to 100. */
function shareUsed(spent: bigint, available: bigint): number {
  if (spent <= 0n || available <= 0n) return 0;
  return Number(spent >= available ? 100n : (spent * 100n) / available);
}

function wealth(
  database: Database.Database,
  valuation: Valuation,
  now: number,
): HomeResponse['wealth'] {
  const last = database
    .prepare(
      `SELECT id, closed_at FROM checkin WHERE closed_at IS NOT NULL
       ORDER BY closed_at DESC, id DESC LIMIT 1`,
    )
    .get() as { id: bigint; closed_at: bigint } | undefined;
  if (!last) return null;
  const closedAt = Number(last.closed_at);
  const [atCheckin, current] = currencyTotalsAt(database, [closedAt, now]) as [
    Map<string, bigint>,
    Map<string, bigint>,
  ];
  const before = equivalent(valuation, atCheckin, valuation.dateOf(closedAt));
  const amount = equivalent(valuation, current, valuation.dateOf(now));
  return {
    checkinId: Number(last.id),
    amount: amount === null ? null : toMinorString(amount),
    lastCheckinDate: valuation.dateOf(closedAt),
    change:
      amount === null || before === null
        ? null
        : toMinorString(amount - before),
  };
}

/** Sums currency totals in the common currency; null when a rate is missing. */
function equivalent(
  valuation: Valuation,
  totals: Map<string, bigint>,
  date: string,
): bigint | null {
  let sum = 0n;
  for (const [code, total] of totals) {
    const value = valuation.toCommon(total, code, date);
    if (value === undefined) return null;
    sum += value;
  }
  return sum;
}

/**
 * Warns when the last successful nightly backup is over two days old. Backups
 * written before a migration do not count, and no warning is given before the
 * first nightly backup exists, since there is no age to report.
 */
function backupWarning(
  database: Database.Database,
  now: number,
): HomeResponse['backupWarning'] {
  const last = database
    .prepare(
      `SELECT finished_at FROM backup
       WHERE status = 'done' AND kind IN ('daily', 'monthly')
         AND finished_at IS NOT NULL
       ORDER BY finished_at DESC LIMIT 1`,
    )
    .get() as { finished_at: bigint } | undefined;
  if (!last) return null;
  const age = now - Number(last.finished_at);
  if (age <= 2 * dayMs) return null;
  return { daysAgo: Math.floor(age / dayMs) };
}
