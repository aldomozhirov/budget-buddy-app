import type Database from 'better-sqlite3';
import {
  monthOfDate,
  toMinorString,
  type HomeEnvelope,
  type HomeResponse,
} from '@budget-buddy/shared';
import { monthSpent } from '../modules/transactions/list.js';
import { needsCategoryCount } from '../modules/transactions/needsCategory.js';
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
 * Builds everything Home shows (DSH-1, DSH-4, NTF-1, BKP-4). The banner has
 * no amounts, and no wealth figure is sent: Home links to the latest closed
 * check-in's summary instead.
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
    lastClosedCheckinId: lastClosedCheckinId(database),
    spending: spending(database, valuation, options.now),
    needsCategory: needsCategoryCount(database),
    wishes: {
      open: openWishes(database, monthOfDate(valuation.dateOf(options.now))),
    },
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

/** The open wishes of a month, for Home's Wishes row (UI-HOME-9). */
function openWishes(database: Database.Database, month: string): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS n FROM wish
       WHERE month = ? AND state = 'open' AND deleted_at IS NULL`,
    )
    .get(month) as { n: bigint };
  return Number(row.n);
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

/** The latest closed check-in, which Wealth history opens (DSH-1). */
function lastClosedCheckinId(
  database: Database.Database,
): HomeResponse['lastClosedCheckinId'] {
  const last = database
    .prepare(
      `SELECT id FROM checkin WHERE closed_at IS NOT NULL
       ORDER BY closed_at DESC, id DESC LIMIT 1`,
    )
    .get() as { id: bigint } | undefined;
  return last ? Number(last.id) : null;
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
