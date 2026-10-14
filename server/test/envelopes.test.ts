import { localSlotInstant } from '@budget-buddy/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  envelopeMonths,
  envelopeStatistics,
  fillPendingEnvelopeAmounts,
  listEnvelopeStates,
  loadEnvelopeLedgers,
  savePlan,
  topUpEnvelopes,
  type EnvelopeMode,
  type EnvelopeMonth,
} from '../src/domain/envelopes.js';
import {
  createEnvelopeTopUpJob,
  envelopeTopUpJobName,
} from '../src/jobs/envelopeTopUp.js';
import { createJobRunner } from '../src/jobs/runner.js';
import {
  createFamilyDatabase,
  type FamilyDatabase,
} from './summary-fixture.js';

let family: FamilyDatabase;
let now: number;
const clock = { now: () => new Date(now) };
let eur: number;
let usd: number;

/** Sets the fake clock to an ISO instant. */
const at = (iso: string) => {
  now = Date.parse(iso);
};

/** One tick of a fresh runner, as after a server start. */
const tick = () =>
  createJobRunner({
    database: family.database,
    clock,
    jobs: [createEnvelopeTopUpJob({ database: family.database, clock })],
  }).tick();

/**
 * Adds an envelope as creation does: the plan from the starting month and
 * the first top-up in the month after it. Returns its id.
 */
function envelope(input: {
  name: string;
  startingMonth: string;
  startingBalance: bigint;
  monthlyAmount: bigint;
  mode: EnvelopeMode;
  currency?: string;
}): number {
  const [year, month] = input.startingMonth.split('-').map(Number) as [
    number,
    number,
  ];
  const next =
    month === 12
      ? `${year + 1}-01`
      : `${year}-${String(month + 1).padStart(2, '0')}`;
  const id = Number(
    family.database
      .prepare(
        `INSERT INTO envelope (name, currency, starting_balance,
          starting_month, topup_from_month, position, created_by, created_at,
          updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, (SELECT COUNT(*) + 1 FROM envelope),
          1, ?, 1, ?)`,
      )
      .run(
        input.name,
        input.currency ?? 'EUR',
        input.startingBalance,
        input.startingMonth,
        next,
        now,
        now,
      ).lastInsertRowid,
  );
  savePlan(family.database, {
    envelopeId: id,
    fromMonth: input.startingMonth,
    monthlyAmount: input.monthlyAmount,
    mode: input.mode,
    createdBy: 1,
    now,
  });
  return id;
}

/** Adds an expense (negative: a refund) with one part in an envelope. */
function expense(input: {
  envelopeId: number;
  date: string;
  amount: bigint;
  /** Defaults to `amount`; null when its rate is missing. */
  envelopeAmount?: bigint | null;
  accountId?: number;
  status?: 'draft' | 'confirmed';
}): number {
  const txnId = Number(
    family.database
      .prepare(
        `INSERT INTO txn (kind, status, date, account_id, amount, member_id,
          created_by, created_at, updated_by, updated_at)
        VALUES ('expense', ?, ?, ?, ?, 1, 1, 1, 1, 1)`,
      )
      .run(
        input.status ?? 'confirmed',
        input.date,
        input.accountId ?? eur,
        input.amount,
      ).lastInsertRowid,
  );
  return Number(
    family.database
      .prepare(
        `INSERT INTO txn_part (txn_id, position, amount, envelope_id,
          envelope_amount) VALUES (?, 1, ?, ?, ?)`,
      )
      .run(
        txnId,
        input.amount,
        input.envelopeId,
        input.envelopeAmount === undefined
          ? input.amount
          : input.envelopeAmount,
      ).lastInsertRowid,
  );
}

/** Adds a hand adjustment, or one side of a move when `moveId` is set. */
function adjustment(
  envelopeId: number,
  date: string,
  amount: bigint,
  moveId: string | null = null,
): void {
  family.database
    .prepare(
      `INSERT INTO envelope_adjustment (envelope_id, date, amount, move_id,
        created_by, created_at) VALUES (?, ?, ?, ?, 1, 1)`,
    )
    .run(envelopeId, date, amount, moveId);
}

/** The stored top-ups, as `envelope month amount mode` lines. */
function topUps(): string[] {
  return (
    family.database
      .prepare(
        `SELECT envelope_id AS id, month, amount, mode FROM envelope_topup
        ORDER BY envelope_id, month`,
      )
      .all() as Array<{
      id: bigint;
      month: string;
      amount: bigint;
      mode: string;
    }>
  ).map(({ id, month, amount, mode }) => `${id} ${month} ${amount} ${mode}`);
}

/** The job's done slots in `job_run`. */
function doneSlots(): string[] {
  return (
    family.database
      .prepare(
        `SELECT slot FROM job_run WHERE job = ? AND status = 'done'
        ORDER BY slot`,
      )
      .all(envelopeTopUpJobName) as Array<{ slot: string }>
  ).map(({ slot }) => slot);
}

/** The record of one envelope up to `upTo`. */
function record(envelopeId: number, upTo: string): EnvelopeMonth[] {
  const [ledger] = loadEnvelopeLedgers(family.database, envelopeId);
  if (!ledger) throw new Error(`No envelope ${envelopeId}`);
  return envelopeMonths(ledger, upTo);
}

/** The figures of a record that a hand computation gives. */
const figures = (months: EnvelopeMonth[]) =>
  months.map((month) => ({
    month: month.month,
    opening: month.opening,
    topUp: month.topUp,
    dropped: month.dropped,
    adjustments: month.adjustments,
    spent: month.spent,
    available: month.available,
    closing: month.closing,
    result: month.result,
    withinBudget: month.withinBudget,
  }));

beforeEach(async () => {
  family = await createFamilyDatabase();
  eur = family.account({
    name: 'Joint',
    owner: null,
    type: 'bank',
    currency: 'EUR',
  });
  usd = family.account({
    name: 'Wise $',
    owner: 'Alex',
    type: 'bank',
    currency: 'USD',
  });
  // 13 July 2026, 12:00 in Berlin.
  at('2026-07-13T10:00:00Z');
});

afterEach(async () => {
  await family.close();
});

describe('envelope months', () => {
  it('computes carry-over and reset records over four months', async () => {
    // Created on 13 July: Groceries €200.00 carry-over at €500.00 a month,
    // Eating out €50.00 reset at €150.00 a month.
    const groceries = envelope({
      name: 'Groceries',
      startingMonth: '2026-07',
      startingBalance: 200_00n,
      monthlyAmount: 500_00n,
      mode: 'carry_over',
    });
    const eatingOut = envelope({
      name: 'Eating out',
      startingMonth: '2026-07',
      startingBalance: 50_00n,
      monthlyAmount: 150_00n,
      mode: 'reset',
    });
    await tick();
    // The 1st at 00:00 in Berlin (CEST, UTC+2) each month.
    for (const instant of [
      '2026-07-31T22:00:00Z',
      '2026-08-31T22:00:00Z',
      '2026-09-30T22:00:00Z',
    ]) {
      at(instant);
      await tick();
    }

    // July: Groceries spends €195.50, Eating out €70.00 (overspent).
    expense({ envelopeId: groceries, date: '2026-07-14', amount: 150_00n });
    expense({ envelopeId: groceries, date: '2026-07-31', amount: 45_50n });
    expense({ envelopeId: eatingOut, date: '2026-07-20', amount: 70_00n });
    // August: a move of €30.00 to Eating out; Groceries spends €520.00 and
    // gets €12.00 back (refund), so it is overspent by €33.50.
    adjustment(groceries, '2026-08-05', -30_00n, 'move-1');
    adjustment(eatingOut, '2026-08-05', 30_00n, 'move-1');
    expense({ envelopeId: groceries, date: '2026-08-10', amount: 520_00n });
    expense({ envelopeId: groceries, date: '2026-08-12', amount: -12_00n });
    expense({ envelopeId: eatingOut, date: '2026-08-15', amount: 120_00n });
    // September: €25.00 added by hand to Groceries.
    adjustment(groceries, '2026-09-02', 25_00n);
    expense({ envelopeId: groceries, date: '2026-09-09', amount: 410_00n });
    expense({ envelopeId: eatingOut, date: '2026-09-19', amount: 160_00n });
    // October, the current month. A draft counts nowhere.
    expense({ envelopeId: groceries, date: '2026-10-01', amount: 100_00n });
    expense({ envelopeId: eatingOut, date: '2026-10-03', amount: 25_00n });
    expense({
      envelopeId: groceries,
      date: '2026-10-02',
      amount: 999_00n,
      status: 'draft',
    });

    expect(figures(record(groceries, '2026-10'))).toEqual([
      {
        month: '2026-07',
        opening: 200_00n,
        topUp: 0n,
        dropped: null,
        adjustments: 0n,
        spent: 195_50n,
        available: 200_00n,
        closing: 4_50n,
        result: -195_50n,
        withinBudget: true,
      },
      {
        month: '2026-08',
        opening: 4_50n,
        topUp: 500_00n,
        dropped: null,
        adjustments: -30_00n,
        spent: 508_00n,
        available: 474_50n,
        closing: -33_50n,
        result: -38_00n,
        withinBudget: false,
      },
      {
        // The negative balance carries over.
        month: '2026-09',
        opening: -33_50n,
        topUp: 500_00n,
        dropped: null,
        adjustments: 25_00n,
        spent: 410_00n,
        available: 491_50n,
        closing: 81_50n,
        result: 115_00n,
        withinBudget: true,
      },
      {
        month: '2026-10',
        opening: 81_50n,
        topUp: 500_00n,
        dropped: null,
        adjustments: 0n,
        spent: 100_00n,
        available: 581_50n,
        closing: 481_50n,
        result: 400_00n,
        withinBudget: null,
      },
    ]);
    expect(figures(record(eatingOut, '2026-10'))).toEqual([
      {
        month: '2026-07',
        opening: 50_00n,
        topUp: 0n,
        dropped: null,
        adjustments: 0n,
        spent: 70_00n,
        available: 50_00n,
        closing: -20_00n,
        result: -70_00n,
        withinBudget: false,
      },
      {
        // The reset drops July's overspend but the record keeps it.
        month: '2026-08',
        opening: 0n,
        topUp: 150_00n,
        dropped: -20_00n,
        adjustments: 30_00n,
        spent: 120_00n,
        available: 180_00n,
        closing: 60_00n,
        result: 60_00n,
        withinBudget: true,
      },
      {
        month: '2026-09',
        opening: 0n,
        topUp: 150_00n,
        dropped: 60_00n,
        adjustments: 0n,
        spent: 160_00n,
        available: 150_00n,
        closing: -10_00n,
        result: -10_00n,
        withinBudget: false,
      },
      {
        month: '2026-10',
        opening: 0n,
        topUp: 150_00n,
        dropped: -10_00n,
        adjustments: 0n,
        spent: 25_00n,
        available: 150_00n,
        closing: 125_00n,
        result: 125_00n,
        withinBudget: null,
      },
    ]);

    // Statistics of the closed months July to September (Design 3.2).
    const groceriesStats = envelopeStatistics(
      record(groceries, '2026-10'),
      'all',
      '2026-10',
    );
    expect(groceriesStats).toEqual({
      months: 3,
      withinBudget: 2,
      // (195.50 + 508.00 + 410.00) ÷ 3 = 371.1666… → €371.17.
      averageSpent: 371_17n,
      largestOverspend: { month: '2026-08', amount: 33_50n },
      // −195.50 − 38.00 + 115.00.
      leftOverNet: -118_50n,
      incomplete: false,
    });
    const eatingOutStats = envelopeStatistics(
      record(eatingOut, '2026-10'),
      'all',
      '2026-10',
    );
    expect(eatingOutStats).toEqual({
      months: 3,
      withinBudget: 1,
      // (70.00 + 120.00 + 160.00) ÷ 3 = 116.6666… → €116.67.
      averageSpent: 116_67n,
      largestOverspend: { month: '2026-07', amount: 20_00n },
      // −70.00 + 60.00 − 10.00.
      leftOverNet: -20_00n,
      incomplete: false,
    });
    for (const period of ['last6', 'last12', 'thisYear'] as const) {
      expect(
        envelopeStatistics(record(groceries, '2026-10'), period, '2026-10'),
      ).toEqual(groceriesStats);
    }

    // In January the closed months of "This year" are none.
    const january = record(groceries, '2027-01');
    expect(envelopeStatistics(january, 'thisYear', '2027-01')).toMatchObject({
      months: 0,
      withinBudget: 0,
      averageSpent: null,
      largestOverspend: null,
      leftOverNet: 0n,
    });
    // Last 6 of the seven closed months July to January leaves July out.
    const february = record(groceries, '2027-02');
    expect(envelopeStatistics(february, 'last6', '2027-02')).toMatchObject({
      months: 6,
      // Aug −38.00, Sep +115.00, Oct +400.00, Nov to Jan: no top-ups yet.
      leftOverNet: 477_00n,
    });

    // The current state of both, in envelope order.
    const states = listEnvelopeStates(family.database, '2026-10');
    expect(
      states.map(({ ledger, current }) => [ledger.name, current?.closing]),
    ).toEqual([
      ['Groceries', 481_50n],
      ['Eating out', 125_00n],
    ]);
  });

  it('counts an expense dated before the first month in the first month', () => {
    at('2026-10-13T10:00:00Z');
    const id = envelope({
      name: 'Unexpected',
      startingMonth: '2026-10',
      startingBalance: 300_00n,
      monthlyAmount: 100_00n,
      mode: 'carry_over',
    });
    expense({ envelopeId: id, date: '2026-09-28', amount: 40_00n });
    expense({ envelopeId: id, date: '2026-10-02', amount: 10_00n });
    expect(figures(record(id, '2026-10'))).toEqual([
      {
        month: '2026-10',
        opening: 300_00n,
        topUp: 0n,
        dropped: null,
        adjustments: 0n,
        spent: 50_00n,
        available: 300_00n,
        closing: 250_00n,
        result: -50_00n,
        withinBudget: null,
      },
    ]);
    expect(record(id, '2026-09')).toEqual([]);
  });

  it('marks a month with a missing envelope amount incomplete', () => {
    at('2026-08-13T10:00:00Z');
    const groceries = envelope({
      name: 'Groceries',
      startingMonth: '2026-08',
      startingBalance: 100_00n,
      monthlyAmount: 100_00n,
      mode: 'carry_over',
    });
    const eatingOut = envelope({
      name: 'Eating out',
      startingMonth: '2026-08',
      startingBalance: 100_00n,
      monthlyAmount: 100_00n,
      mode: 'reset',
    });
    topUpEnvelopes(family.database, '2026-10', now);
    for (const envelopeId of [groceries, eatingOut]) {
      expense({ envelopeId, date: '2026-08-20', amount: 30_00n });
      // $10.00 paid abroad with no EUR/USD rate yet.
      expense({
        envelopeId,
        date: '2026-08-21',
        amount: 10_00n,
        envelopeAmount: null,
        accountId: usd,
      });
    }

    const carried = record(groceries, '2026-10');
    expect(carried.map((month) => month.spent)).toEqual([30_00n, 0n, 0n]);
    expect(carried.map((month) => month.incomplete)).toEqual([
      true,
      false,
      false,
    ]);
    // The carried balance stays uncertain; a reset ends that.
    expect(carried.map((month) => month.closingIncomplete)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      record(eatingOut, '2026-10').map((month) => month.closingIncomplete),
    ).toEqual([true, false, false]);
    expect(envelopeStatistics(carried, 'all', '2026-10').incomplete).toBe(true);
    // "This year" in February 2027 covers January only, whose carried
    // closing still lacks August's amount; the reset envelope's does not.
    expect(
      envelopeStatistics(record(groceries, '2027-02'), 'thisYear', '2027-02'),
    ).toMatchObject({ months: 1, incomplete: true });
    expect(
      envelopeStatistics(record(eatingOut, '2027-02'), 'thisYear', '2027-02'),
    ).toMatchObject({ months: 1, incomplete: false });
  });
});

describe('envelope top-up job', () => {
  it('does nothing harmful while the family has no envelopes', async () => {
    await tick();
    expect(topUps()).toEqual([]);
    expect(doneSlots()).toEqual(['2026-07-01T00:00']);
    expect(topUpEnvelopes(family.database, '2026-07', now)).toBe(0);
    expect(fillPendingEnvelopeAmounts(family.database)).toBe(0);
    expect(listEnvelopeStates(family.database, '2026-07')).toEqual([]);
    expect(
      family.database.prepare('SELECT COUNT(*) AS n FROM envelope').get(),
    ).toEqual({ n: 0n });
  });

  it('tops up a mid-month envelope from the next 1st only', async () => {
    const id = envelope({
      name: 'Groceries',
      startingMonth: '2026-07',
      startingBalance: 500_00n,
      monthlyAmount: 500_00n,
      mode: 'carry_over',
    });
    await tick();
    expect(topUps()).toEqual([]);
    expect(record(id, '2026-07')[0]).toMatchObject({
      opening: 500_00n,
      topUp: 0n,
      closing: 500_00n,
    });

    // 1 August 00:00 in Berlin is 31 July 22:00 UTC.
    at('2026-07-31T21:59:59Z');
    await tick();
    expect(topUps()).toEqual([]);
    at('2026-07-31T22:00:00Z');
    await tick();
    expect(topUps()).toEqual([`${id} 2026-08 50000 carry_over`]);
  });

  it('inserts nothing new when a slot runs twice', async () => {
    const id = envelope({
      name: 'Groceries',
      startingMonth: '2026-07',
      startingBalance: 0n,
      monthlyAmount: 500_00n,
      mode: 'carry_over',
    });
    at('2026-08-02T10:00:00Z');
    await tick();
    await tick();
    const job = createEnvelopeTopUpJob({ database: family.database, clock });
    await job.run('2026-08-01T00:00');
    expect(topUpEnvelopes(family.database, '2026-08', now)).toBe(0);
    expect(topUps()).toEqual([`${id} 2026-08 50000 carry_over`]);
    expect(doneSlots()).toEqual(['2026-08-01T00:00']);
  });

  it('applies a mid-month change from the next top-up, the last one winning', async () => {
    const id = envelope({
      name: 'Groceries',
      startingMonth: '2026-07',
      startingBalance: 0n,
      monthlyAmount: 500_00n,
      mode: 'carry_over',
    });
    at('2026-09-01T08:00:00Z');
    await tick();
    expect(topUps()).toEqual([
      `${id} 2026-08 50000 carry_over`,
      `${id} 2026-09 50000 carry_over`,
    ]);

    // Changed twice on 15 September: the second replaces the first.
    at('2026-09-15T10:00:00Z');
    const change = (monthlyAmount: bigint, mode: EnvelopeMode) =>
      savePlan(family.database, {
        envelopeId: id,
        fromMonth: '2026-10',
        monthlyAmount,
        mode,
        createdBy: 2,
        now,
      });
    change(550_00n, 'carry_over');
    change(600_00n, 'reset');
    await tick();
    const [september] = listEnvelopeStates(family.database, '2026-09');
    expect(september?.plan).toEqual({
      fromMonth: '2026-07',
      monthlyAmount: 500_00n,
      mode: 'carry_over',
    });
    expect(september?.pendingPlan).toEqual({
      fromMonth: '2026-10',
      monthlyAmount: 600_00n,
      mode: 'reset',
    });
    expect(topUps()).toHaveLength(2);

    at('2026-09-30T22:00:00Z');
    await tick();
    expect(topUps()).toEqual([
      `${id} 2026-08 50000 carry_over`,
      `${id} 2026-09 50000 carry_over`,
      `${id} 2026-10 60000 reset`,
    ]);
    const [october] = listEnvelopeStates(family.database, '2026-10');
    expect(october?.pendingPlan).toBeUndefined();
    expect(october?.plan?.monthlyAmount).toBe(600_00n);
  });

  it('skips an archived envelope and tops a restored one up from the month after', async () => {
    const id = envelope({
      name: 'Holidays',
      startingMonth: '2026-07',
      startingBalance: 0n,
      monthlyAmount: 100_00n,
      mode: 'carry_over',
    });
    at('2026-08-10T10:00:00Z');
    await tick();
    family.database
      .prepare('UPDATE envelope SET archived_at = ? WHERE id = ?')
      .run(now, id);
    for (const instant of ['2026-08-31T22:00:00Z', '2026-09-30T22:00:00Z']) {
      at(instant);
      await tick();
    }
    expect(topUps()).toEqual([`${id} 2026-08 10000 carry_over`]);

    // Restored on 5 October: topped up from November on.
    at('2026-10-05T10:00:00Z');
    family.database
      .prepare(
        `UPDATE envelope SET archived_at = NULL, topup_from_month = '2026-11'
        WHERE id = ?`,
      )
      .run(id);
    await tick();
    expect(topUps()).toHaveLength(1);
    at('2026-10-31T23:00:00Z');
    await tick();
    expect(topUps()).toEqual([
      `${id} 2026-08 10000 carry_over`,
      `${id} 2026-11 10000 carry_over`,
    ]);
    // The archived months keep their record, without top-ups.
    expect(record(id, '2026-11').map((month) => month.topUp)).toEqual([
      0n,
      100_00n,
      0n,
      0n,
      100_00n,
    ]);
  });

  it('makes up November and December after downtime from 28 October to 3 December', async () => {
    const id = envelope({
      name: 'Groceries',
      startingMonth: '2026-07',
      startingBalance: 0n,
      monthlyAmount: 500_00n,
      mode: 'carry_over',
    });
    at('2026-10-20T10:00:00Z');
    await tick();
    savePlan(family.database, {
      envelopeId: id,
      fromMonth: '2026-11',
      monthlyAmount: 550_00n,
      mode: 'carry_over',
      createdBy: 1,
      now,
    });
    at('2026-10-28T10:00:00Z');
    await tick();
    expect(topUps()).toHaveLength(3);

    // Off until 3 December; the runner runs only the latest missed slot.
    at('2026-12-03T09:00:00Z');
    await tick();
    expect(topUps()).toEqual([
      `${id} 2026-08 50000 carry_over`,
      `${id} 2026-09 50000 carry_over`,
      `${id} 2026-10 50000 carry_over`,
      `${id} 2026-11 55000 carry_over`,
      `${id} 2026-12 55000 carry_over`,
    ]);
    expect(doneSlots()).toEqual(['2026-10-01T00:00', '2026-12-01T00:00']);
  });

  it('is due at 00:00 on the 1st in Europe/Berlin', () => {
    const job = createEnvelopeTopUpJob({ database: family.database, clock });
    const settings = { timeZone: 'Europe/Berlin' } as Parameters<
      typeof job.dueSlots
    >[1];
    // After the change to winter time, 1 November 00:00 is 23:00 UTC.
    expect(
      job.dueSlots(new Date('2026-10-31T22:59:59Z'), settings, null),
    ).toEqual(['2026-10-01T00:00']);
    expect(
      job.dueSlots(
        new Date('2026-10-31T22:59:59Z'),
        settings,
        '2026-10-01T00:00',
      ),
    ).toEqual([]);
    expect(
      job.dueSlots(
        new Date('2026-10-31T23:00:00Z'),
        settings,
        '2026-10-01T00:00',
      ),
    ).toEqual(['2026-11-01T00:00']);
  });

  it('runs at the first valid minute when daylight saving skips midnight', async () => {
    // Paraguay moved its clocks from 00:00 to 01:00 on 1 October 2023.
    family.database
      .prepare(`UPDATE family SET time_zone = 'America/Asuncion'`)
      .run();
    expect(
      localSlotInstant('2023-10-01', '00:00', 'America/Asuncion').toISOString(),
    ).toBe('2023-10-01T04:00:00.000Z');
    at('2023-09-13T15:00:00Z');
    const id = envelope({
      name: 'Groceries',
      startingMonth: '2023-09',
      startingBalance: 0n,
      monthlyAmount: 1_000_000n,
      mode: 'reset',
      currency: 'PYG',
    });
    await tick();

    // 30 September 23:59 local time (UTC−4).
    at('2023-10-01T03:59:00Z');
    await tick();
    expect(topUps()).toEqual([]);
    // 1 October 01:00 local time (UTC−3), the first minute of the day.
    at('2023-10-01T04:00:00Z');
    await tick();
    expect(topUps()).toEqual([`${id} 2023-10 1000000 reset`]);
    expect(doneSlots()).toEqual(['2023-09-01T00:00', '2023-10-01T00:00']);
  });
});

describe('pending envelope amounts', () => {
  it('fills missing amounts once a rate is stored, keeping typed ones', () => {
    const id = envelope({
      name: 'Holidays',
      startingMonth: '2026-07',
      startingBalance: 0n,
      monthlyAmount: 0n,
      mode: 'carry_over',
    });
    const pending = expense({
      envelopeId: id,
      date: '2026-07-14',
      amount: 10_00n,
      envelopeAmount: null,
      accountId: usd,
    });
    const typed = expense({
      envelopeId: id,
      date: '2026-07-14',
      amount: 20_00n,
      envelopeAmount: 17_00n,
      accountId: usd,
    });
    const later = expense({
      envelopeId: id,
      date: '2026-07-01',
      amount: 5_00n,
      envelopeAmount: null,
      accountId: usd,
    });
    const amountOf = (partId: number) =>
      (
        family.database
          .prepare('SELECT envelope_amount AS value FROM txn_part WHERE id = ?')
          .get(partId) as { value: bigint | null }
      ).value;

    expect(fillPendingEnvelopeAmounts(family.database)).toBe(0);
    // 1 EUR = 1.093 USD from 10 July; none earlier.
    family.rate('EUR', 'USD', '2026-07-10', '1.093');
    expect(fillPendingEnvelopeAmounts(family.database)).toBe(1);
    // $10.00 ÷ 1.093 = €9.149… → €9.15.
    expect(amountOf(pending)).toBe(9_15n);
    expect(amountOf(typed)).toBe(17_00n);
    // Dated 1 July, before the first rate: still missing.
    expect(amountOf(later)).toBeNull();
    expect(record(id, '2026-07')[0]).toMatchObject({
      spent: 26_15n,
      incomplete: true,
    });
  });
});
