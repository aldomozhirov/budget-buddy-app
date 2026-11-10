import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { balanceAt, currencyTotalsAt } from '../src/domain/balance.js';
import { getCheckinSummary } from '../src/domain/summary.js';
import { getWealthSeries } from '../src/domain/wealthSeries.js';
import {
  createFamilyDatabase,
  type FamilyDatabase,
} from './summary-fixture.js';

/*
 * The worked example. Common currency EUR, time zone Europe/Berlin (UTC+2 in
 * summer). Amounts below are written in major units; the code stores minor
 * units (EUR, USD, RUB: 2 decimals, BTC: 8).
 *
 * Check-ins            closed (UTC)            Berlin day
 *   C1                 2026-07-01 10:00        2026-07-01
 *   C2                 2026-08-01 10:00        2026-08-01 (a Saturday)
 *   C3                 2026-08-31 22:30        2026-09-01 (00:30 in Berlin)
 *   C4 (still open)
 *
 * Accounts (owner, type, currency): balances at C1 / C2 / C3
 *   A1 Alex  bank       EUR   1,000.00 / 1,200.00 / 1,200.00 (carried forward)
 *   A2 Alex  bank       USD     500.00 /   600.00 /   450.00
 *   A3 Blair cash       RUB  10,000.00 / 12,000.00 / 9,000.00
 *   A4 Blair crypto     BTC   0.10 / 0.12 / 0.12
 *   A5 Alex  cash       EUR      50.00 /    60.00 / deactivated 15/08 -> 0
 *   A6 Blair investment EUR   first balance 20/08: 300.00; C3: 330.00
 *
 * Rates (units of the quote per one base)    EUR->USD  EUR->RUB  BTC->EUR
 *   2026-07-01 (C1)                            1.1       100       50,000
 *   2026-07-31 (the last day before C2)        1.25      80        -
 *   2026-08-01 (C2)                            -         -         40,000
 *   2026-08-31 (a decoy: C3 closes on 09-01)   9.9       -         -
 *   2026-09-01 (C3)                            1.3       90        45,000
 *   2026-10-08 (the latest, "today's rates")   1.6       100       50,000
 *
 * C1 totals: EUR 1,050.00, USD 500.00, RUB 10,000.00, BTC 0.1
 *   at the rates of 07-01: 1,050.00 + 500/1.1 (454.5454 -> 454.55)
 *   + 10,000/100 (100.00) + 0.1 x 50,000 (5,000.00) = 6,604.55
 * C2 totals: EUR 1,260.00, USD 600.00, RUB 12,000.00, BTC 0.12
 *   at the rates of 07-31 and 08-01: 1,260.00 + 600/1.25 (480.00)
 *   + 12,000/80 (150.00) + 0.12 x 40,000 (4,800.00) = 6,690.00
 *   change C1 -> C2 = 6,690.00 - 6,604.55 = 85.45
 *   per account at the rates of C2: A1 +200.00; A5 +10.00; A2 +100/1.25 = 80.00;
 *   A3 +2,000/80 = 25.00; A4 +0.02 x 40,000 = 800.00; sum "From balances"
 *   1,115.00; "From exchange rates" 85.45 - 1,115.00 = -1,029.55
 * C3 totals: EUR 1,530.00, USD 450.00, RUB 9,000.00, BTC 0.12
 *   at the rates of 09-01: 1,530.00 + 450/1.3 (346.1538 -> 346.15)
 *   + 9,000/90 (100.00) + 0.12 x 45,000 (5,400.00) = 7,376.15
 *   change C2 -> C3 = 7,376.15 - 6,690.00 = 686.15
 *   per account at the rates of C3: A1 0; A2 -150/1.3 = -115.3846 -> -115.38;
 *   A3 -3,000/90 = -33.3333 -> -33.33; A4 0; A5 -60.00; A6 +330.00;
 *   "From balances" = -115.38 - 33.33 - 60.00 + 330.00 = 121.29
 *   "From exchange rates" = 686.15 - 121.29 = 564.86. Rounding each part on
 *   its own would give 564.87 (564.871795): the 0.01 remainder lands here.
 */

const hour = 3_600_000;
const closed1 = Date.parse('2026-07-01T10:00:00Z');
const closed2 = Date.parse('2026-08-01T10:00:00Z');
const closed3 = Date.parse('2026-08-31T22:30:00Z');
const now = Date.parse('2026-10-09T08:00:00Z');

describe('check-in summary and wealth series', () => {
  let family: FamilyDatabase;
  let ids: Record<'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6', number>;
  let c1: number;
  let c2: number;
  let c3: number;
  let c4: number;

  beforeEach(async () => {
    family = await createFamilyDatabase();
    const { account, checkin, snapshot, rate } = family;
    ids = {
      a1: account({
        name: 'Main account',
        owner: 'Alex',
        type: 'bank',
        currency: 'EUR',
      }),
      a2: account({
        name: 'Wise USD',
        owner: 'Alex',
        type: 'bank',
        currency: 'USD',
      }),
      a3: account({
        name: 'Ruble cash',
        owner: 'Blair',
        type: 'cash',
        currency: 'RUB',
      }),
      a4: account({
        name: 'Bitcoin',
        owner: 'Blair',
        type: 'crypto',
        currency: 'BTC',
      }),
      a5: account({
        name: 'Old wallet',
        owner: 'Alex',
        type: 'cash',
        currency: 'EUR',
        deactivatedAt: Date.parse('2026-08-15T09:00:00Z'),
      }),
      a6: account({
        name: 'New savings',
        owner: 'Blair',
        type: 'investment',
        currency: 'EUR',
      }),
    };
    c1 = checkin({ openedAt: closed1 - 2 * hour, closedAt: closed1 });
    c2 = checkin({ openedAt: closed2 - 2 * hour, closedAt: closed2 });
    c3 = checkin({ openedAt: closed3 - 2 * hour, closedAt: closed3 });
    c4 = checkin({
      openedAt: Date.parse('2026-10-01T08:00:00Z'),
      closedAt: null,
    });
    const value = (
      checkinId: number,
      closedAt: number,
      accountId: number,
      amount: bigint,
    ) =>
      snapshot({
        accountId,
        takenAt: closedAt - hour,
        amount,
        source: 'checkin',
        checkinId,
      });
    value(c1, closed1, ids.a1, 100_000n);
    value(c1, closed1, ids.a2, 50_000n);
    value(c1, closed1, ids.a3, 1_000_000n);
    value(c1, closed1, ids.a4, 10_000_000n);
    value(c1, closed1, ids.a5, 5_000n);
    value(c2, closed2, ids.a1, 120_000n);
    value(c2, closed2, ids.a2, 60_000n);
    value(c2, closed2, ids.a3, 1_200_000n);
    value(c2, closed2, ids.a4, 12_000_000n);
    value(c2, closed2, ids.a5, 6_000n);
    snapshot({
      accountId: ids.a6,
      takenAt: Date.parse('2026-08-20T09:00:00Z'),
      amount: 30_000n,
      source: 'opening',
    });
    snapshot({
      accountId: ids.a1,
      takenAt: closed3,
      amount: 120_000n,
      source: 'carried_forward',
      checkinId: c3,
    });
    value(c3, closed3, ids.a2, 45_000n);
    value(c3, closed3, ids.a3, 900_000n);
    value(c3, closed3, ids.a4, 12_000_000n);
    value(c3, closed3, ids.a6, 33_000n);

    rate('EUR', 'USD', '2026-07-01', '1.1');
    rate('EUR', 'RUB', '2026-07-01', '100');
    rate('BTC', 'EUR', '2026-07-01', '50000');
    rate('EUR', 'USD', '2026-07-31', '1.25');
    rate('EUR', 'RUB', '2026-07-31', '80');
    rate('BTC', 'EUR', '2026-08-01', '40000');
    rate('EUR', 'USD', '2026-08-31', '9.9');
    rate('EUR', 'USD', '2026-09-01', '1.3');
    rate('EUR', 'RUB', '2026-09-01', '90');
    rate('BTC', 'EUR', '2026-09-01', '45000');
    rate('EUR', 'USD', '2026-10-08', '1.6');
    rate('EUR', 'RUB', '2026-10-08', '100');
    rate('BTC', 'EUR', '2026-10-08', '50000');
  });

  afterEach(async () => {
    await family.close();
  });

  function summaryOf(checkinId: number) {
    const result = getCheckinSummary(family.database, checkinId);
    if (result.status !== 'ok') throw new Error(`No summary: ${result.status}`);
    return result.summary;
  }

  describe('the summary of C3 against C2', () => {
    it('shows the per-currency totals, differences and equivalents', () => {
      const summary = summaryOf(c3);
      expect(summary.checkin).toMatchObject({
        id: c3,
        closedAt: closed3,
        date: '2026-09-01',
        closedBy: { memberId: 2, name: 'Blair' },
      });
      expect(summary.previous).toEqual({
        id: c2,
        closedAt: closed2,
        date: '2026-08-01',
      });
      expect(summary.commonCurrency).toBe('EUR');
      expect(summary.currencies).toEqual([
        {
          currency: 'EUR',
          current: '153000',
          previous: '126000',
          difference: '27000',
          direction: 'up',
          currentEquivalent: '153000',
          previousEquivalent: '126000',
        },
        {
          currency: 'BTC',
          current: '12000000',
          previous: '12000000',
          difference: '0',
          direction: 'unchanged',
          currentEquivalent: '540000',
          previousEquivalent: '480000',
        },
        {
          currency: 'RUB',
          current: '900000',
          previous: '1200000',
          difference: '-300000',
          direction: 'down',
          currentEquivalent: '10000',
          previousEquivalent: '15000',
        },
        {
          currency: 'USD',
          current: '45000',
          previous: '60000',
          difference: '-15000',
          direction: 'down',
          currentEquivalent: '34615',
          previousEquivalent: '48000',
        },
      ]);
    });

    it('values each close at the rates of its own day in the time zone', () => {
      // C3 closed at 22:30 UTC on 31/08, which is 01/09 in Berlin, so the
      // decoy rate of 31/08 (9.9) must not be used.
      const total = summaryOf(c3).total;
      expect(total).toEqual({
        current: '737615',
        previous: '669000',
        change: '68615',
        direction: 'up',
        complete: true,
      });
    });

    it('splits the change into balances and exchange rates, with the remainder in rates', () => {
      const summary = summaryOf(c3);
      expect(summary.fromBalances).toBe('12129');
      expect(summary.fromExchangeRates).toBe('56486');
      expect(
        BigInt(summary.fromBalances ?? '') +
          BigInt(summary.fromExchangeRates ?? ''),
      ).toBe(BigInt(summary.total.change ?? ''));
    });

    it('sums member and type rows to "From balances"', () => {
      const summary = summaryOf(c3);
      expect(summary.byMember).toEqual([
        { memberId: 1, name: 'Alex', change: '-17538' },
        { memberId: 2, name: 'Blair', change: '29667' },
      ]);
      expect(summary.byType).toEqual([
        { type: 'bank', change: '-11538' },
        { type: 'cash', change: '-9333' },
        { type: 'investment', change: '33000' },
        { type: 'crypto', change: '0' },
      ]);
      const sum = (rows: { change: string | null }[]) =>
        rows.reduce((total, row) => total + BigInt(row.change ?? '0'), 0n);
      expect(sum(summary.byMember)).toBe(BigInt(summary.fromBalances ?? ''));
      expect(sum(summary.byType)).toBe(BigInt(summary.fromBalances ?? ''));
    });

    it('lists the biggest changes by size, without unchanged accounts', () => {
      const names = summaryOf(c3).biggestChanges;
      expect(
        names.map(({ name, change, changeEquivalent }) => [
          name,
          change,
          changeEquivalent,
        ]),
      ).toEqual([
        ['New savings', '33000', '33000'],
        ['Wise USD', '-15000', '-11538'],
        ['Old wallet', '-6000', '-6000'],
        ['Ruble cash', '-300000', '-3333'],
      ]);
      expect(names[0]).toMatchObject({
        type: 'investment',
        ownerName: 'Blair',
      });
      expect(names[1]).toMatchObject({ type: 'bank', ownerName: 'Alex' });
      expect(names[0]).toMatchObject({
        accountId: ids.a6,
        ownerName: 'Blair',
        currency: 'EUR',
      });
    });

    it('lists carried-forward, added and deactivated accounts', () => {
      const also = summaryOf(c3).alsoInThisCheckin;
      expect(also.notChanged.map((entry) => entry.name)).toEqual([
        'Main account',
      ]);
      expect(also.added.map((entry) => entry.name)).toEqual(['New savings']);
      expect(also.deactivated.map((entry) => entry.name)).toEqual([
        'Old wallet',
      ]);
    });
  });

  describe('the summary of C2 against C1', () => {
    it('values the totals and the change at each close date, using the nearest earlier rate', () => {
      const summary = summaryOf(c2);
      // USD and RUB have no rate on Saturday 01/08: Friday 31/07 is used.
      expect(summary.total).toEqual({
        current: '669000',
        previous: '660455',
        change: '8545',
        direction: 'up',
        complete: true,
      });
      expect(
        summary.currencies.map((row) => [
          row.currency,
          row.currentEquivalent,
          row.previousEquivalent,
        ]),
      ).toEqual([
        ['EUR', '126000', '105000'],
        ['BTC', '480000', '500000'],
        ['RUB', '15000', '10000'],
        ['USD', '48000', '45455'],
      ]);
    });

    it('shows a negative currency effect when a coin falls', () => {
      const summary = summaryOf(c2);
      expect(summary.fromBalances).toBe('111500');
      expect(summary.fromExchangeRates).toBe('-102955');
      expect(summary.byMember).toEqual([
        { memberId: 1, name: 'Alex', change: '29000' },
        { memberId: 2, name: 'Blair', change: '82500' },
      ]);
      expect(summary.byType).toEqual([
        { type: 'bank', change: '28000' },
        { type: 'cash', change: '3500' },
        { type: 'crypto', change: '80000' },
      ]);
      expect(
        summary.biggestChanges.map(({ name, changeEquivalent }) => [
          name,
          changeEquivalent,
        ]),
      ).toEqual([
        ['Bitcoin', '80000'],
        ['Main account', '20000'],
        ['Wise USD', '8000'],
        ['Ruble cash', '2500'],
        ['Old wallet', '1000'],
      ]);
    });

    it('lists no added, deactivated or carried-forward accounts', () => {
      expect(summaryOf(c2).alsoInThisCheckin).toEqual({
        notChanged: [],
        added: [],
        deactivated: [],
      });
    });
  });

  describe('the first check-in', () => {
    it('has totals and no comparison', () => {
      const summary = summaryOf(c1);
      expect(summary.previous).toBeNull();
      expect(summary.total).toEqual({
        current: '660455',
        previous: null,
        change: null,
        direction: null,
        complete: true,
      });
      expect(summary.currencies).toEqual([
        {
          currency: 'EUR',
          current: '105000',
          previous: null,
          difference: null,
          direction: null,
          currentEquivalent: '105000',
          previousEquivalent: null,
        },
        {
          currency: 'BTC',
          current: '10000000',
          previous: null,
          difference: null,
          direction: null,
          currentEquivalent: '500000',
          previousEquivalent: null,
        },
        {
          currency: 'RUB',
          current: '1000000',
          previous: null,
          difference: null,
          direction: null,
          currentEquivalent: '10000',
          previousEquivalent: null,
        },
        {
          currency: 'USD',
          current: '50000',
          previous: null,
          difference: null,
          direction: null,
          currentEquivalent: '45455',
          previousEquivalent: null,
        },
      ]);
      expect(summary.fromBalances).toBeNull();
      expect(summary.fromExchangeRates).toBeNull();
      expect(summary.byMember).toEqual([]);
      expect(summary.byType).toEqual([]);
      expect(summary.biggestChanges).toEqual([]);
      expect(summary.alsoInThisCheckin).toEqual({
        notChanged: [],
        added: [],
        deactivated: [],
      });
    });
  });

  it('has no summary for an open or unknown check-in', () => {
    expect(getCheckinSummary(family.database, c4)).toEqual({ status: 'open' });
    expect(getCheckinSummary(family.database, 999)).toEqual({
      status: 'not_found',
    });
  });

  it('is computed from stored data, so a later correction shows up', () => {
    // Correct A1's C2 value from 1,200.00 to 1,300.00: A1's change C1 -> C2
    // is then +300.00 and "From balances" 1,115.00 + 100.00 = 1,215.00.
    family.database
      .prepare(
        'UPDATE snapshot SET amount = 130000 WHERE account_id = ? AND checkin_id = ?',
      )
      .run(ids.a1, c2);
    expect(summaryOf(c2).fromBalances).toBe('121500');
  });

  describe('the wealth series', () => {
    function series(options: {
      view: 'equivalent' | 'currency';
      currency?: string;
      rates: 'dated' | 'today';
    }) {
      const result = getWealthSeries(family.database, { ...options, now });
      if (result.status !== 'ok') throw new Error(result.status);
      return result.series;
    }

    it("has one point per closed check-in, oldest first, at each date's rates", () => {
      const result = series({ view: 'equivalent', rates: 'dated' });
      expect(result.currency).toBe('EUR');
      expect(result.currencies).toEqual(['BTC', 'EUR', 'RUB', 'USD']);
      expect(result.incomplete).toBe(false);
      expect(result.points).toEqual([
        {
          checkinId: c1,
          closedAt: closed1,
          date: '2026-07-01',
          amount: '660455',
        },
        {
          checkinId: c2,
          closedAt: closed2,
          date: '2026-08-01',
          amount: '669000',
        },
        {
          checkinId: c3,
          closedAt: closed3,
          date: '2026-09-01',
          amount: '737615',
        },
      ]);
    });

    // C1: 1,050.00 + 500/1.6 (312.50) + 10,000/100 (100.00) + 0.1 x 50,000
    //   = 6,462.50. C2: 1,260.00 + 375.00 + 120.00 + 6,000.00 = 7,755.00.
    // C3: 1,530.00 + 450/1.6 (281.25) + 90.00 + 6,000.00 = 7,901.25.
    it("with today's rates converts every point at the latest rates", () => {
      const result = series({ view: 'equivalent', rates: 'today' });
      expect(result.rates).toBe('today');
      expect(result.points.map((point) => point.amount)).toEqual([
        '646250',
        '775500',
        '790125',
      ]);
    });

    it('shows one currency in its own unit, whatever the rates', () => {
      expect(
        series({
          view: 'currency',
          currency: 'USD',
          rates: 'dated',
        }).points.map((p) => p.amount),
      ).toEqual(['50000', '60000', '45000']);
      const btc = series({ view: 'currency', currency: 'BTC', rates: 'today' });
      expect(btc.currency).toBe('BTC');
      expect(btc.points.map((p) => p.amount)).toEqual([
        '10000000',
        '12000000',
        '12000000',
      ]);
      expect(
        series({
          view: 'currency',
          currency: 'EUR',
          rates: 'dated',
        }).points.map((p) => p.amount),
      ).toEqual(['105000', '126000', '153000']);
    });

    it('rejects a currency no account holds', () => {
      expect(
        getWealthSeries(family.database, {
          view: 'currency',
          currency: 'JPY',
          rates: 'dated',
          now,
        }),
      ).toEqual({ status: 'unknown_currency' });
    });

    it('matches the summary totals at the same dates', () => {
      const points = series({ view: 'equivalent', rates: 'dated' }).points;
      for (const [index, id] of [c1, c2, c3].entries()) {
        expect(points[index]?.amount).toBe(summaryOf(id).total.current);
      }
    });
  });

  describe('the batched totals', () => {
    it('equal the balances of balanceAt at every close', () => {
      const instants = [closed1, closed2, closed3, closed1 - 3 * hour, now];
      const batched = currencyTotalsAt(family.database, instants);
      instants.forEach((instant, index) => {
        const expected = new Map<string, bigint>();
        for (const account of balanceAt(family.database, instant)) {
          if (account.takenAt === null) continue;
          expected.set(
            account.currency,
            (expected.get(account.currency) ?? 0n) + account.balance,
          );
        }
        for (const [currency, total] of expected) {
          expect(
            batched[index]?.get(currency) ?? 0n,
            `${currency} at ${instant}`,
          ).toBe(total);
        }
      });
    });

    it('applies the same-instant source order as balanceAt', () => {
      const { account, snapshot, database } = family;
      const x = account({
        name: 'Tie',
        owner: 'Alex',
        type: 'bank',
        currency: 'EUR',
      });
      const at = Date.parse('2026-09-15T10:00:00Z');
      // Four snapshots at one instant: the bank's own figure beats a typed
      // one, and a carried-forward value never hides a fresh one, whatever
      // their ids. Order: connector, manual, opening, carried forward.
      snapshot({ accountId: x, takenAt: at, amount: 700n, source: 'manual' });
      snapshot({
        accountId: x,
        takenAt: at,
        amount: 800n,
        source: 'carried_forward',
        checkinId: c3,
      });
      snapshot({ accountId: x, takenAt: at, amount: 600n, source: 'opening' });
      const total = () => currencyTotalsAt(database, [at])[0]?.get('EUR') ?? 0n;
      const before = currencyTotalsAt(database, [at - 1])[0]?.get('EUR') ?? 0n;
      expect(balanceAt(database, at, { accountIds: [x] })[0]?.balance).toBe(
        700n,
      );
      expect(total() - before).toBe(700n);
      database.exec(
        `INSERT INTO snapshot (account_id, taken_at, amount, source, created_by,
          created_at, updated_by, updated_at)
         VALUES (${x}, ${at}, 900, 'connector', 1, 1, 1, 1)`,
      );
      expect(balanceAt(database, at, { accountIds: [x] })[0]?.balance).toBe(
        900n,
      );
      expect(total() - before).toBe(900n);
    });
  });
});

describe('summary edge cases', () => {
  let family: FamilyDatabase;

  afterEach(async () => {
    await family.close();
  });

  /** Two closed check-ins on 2026-07-01 and 2026-08-01 (10:00 UTC). */
  async function twoCheckins(commonCurrency = 'EUR') {
    family = await createFamilyDatabase(commonCurrency);
    const first = family.checkin({
      openedAt: closed1 - hour,
      closedAt: closed1,
    });
    const second = family.checkin({
      openedAt: closed2 - hour,
      closedAt: closed2,
    });
    const value = (
      checkinId: number,
      closedAt: number,
      accountId: number,
      amount: bigint,
    ) =>
      family.snapshot({
        accountId,
        takenAt: closedAt - hour,
        amount,
        source: 'checkin',
        checkinId,
      });
    return { first, second, value };
  }

  function summaryOf(checkinId: number) {
    const result = getCheckinSummary(family.database, checkinId);
    if (result.status !== 'ok') throw new Error(result.status);
    return result.summary;
  }

  // Rate 3 on both days, so nothing moves. Two USD accounts each gain one cent:
  // $1.00 / 3 = 0.3333 -> 0.33 and $1.02 / 3 = 0.34 give a change of 0.01, but
  // each account's one cent is 0.0033 -> 0.00. "From balances" is 0.00 and
  // the 0.01 left over is "From exchange rates": 0.00 + 0.01 = 0.01.
  it('puts a rounding remainder in "From exchange rates" and the lines still add up', async () => {
    const { first, second, value } = await twoCheckins();
    const x = family.account({
      name: 'X',
      owner: 'Alex',
      type: 'bank',
      currency: 'USD',
    });
    const y = family.account({
      name: 'Y',
      owner: 'Alex',
      type: 'bank',
      currency: 'USD',
    });
    family.rate('EUR', 'USD', '2026-07-01', '3');
    family.rate('EUR', 'USD', '2026-08-01', '3');
    value(first, closed1, x, 50n);
    value(first, closed1, y, 50n);
    value(second, closed2, x, 51n);
    value(second, closed2, y, 51n);
    const summary = summaryOf(second);
    expect(summary.total).toMatchObject({
      previous: '33',
      current: '34',
      change: '1',
    });
    expect(summary.fromBalances).toBe('0');
    expect(summary.fromExchangeRates).toBe('1');
  });

  // A half cent rounds away from zero: 0.01 / 2 = 0.005 -> 0.01 and -0.005 -> -0.01.
  it.each([
    [1n, '1'],
    [-1n, '-1'],
  ])(
    'rounds a half minor unit away from zero (%s)',
    async (closing, expected) => {
      const { first, second, value } = await twoCheckins();
      const x = family.account({
        name: 'X',
        owner: 'Alex',
        type: 'bank',
        currency: 'USD',
      });
      family.rate('EUR', 'USD', '2026-07-01', '2');
      family.rate('EUR', 'USD', '2026-08-01', '2');
      value(first, closed1, x, 0n);
      value(second, closed2, x, closing);
      const summary = summaryOf(second);
      expect(summary.biggestChanges[0]?.changeEquivalent).toBe(expected);
      expect(summary.fromBalances).toBe(expected);
      expect(summary.total.change).toBe(expected);
      expect(summary.fromExchangeRates).toBe('0');
    },
  );

  // An amount above 2^53 loses its last digit in a JavaScript number.
  it('keeps amounts above 2^53 exact', async () => {
    const { first, second, value } = await twoCheckins();
    const x = family.account({
      name: 'Big',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    value(first, closed1, x, 9_007_199_254_740_993n);
    value(second, closed2, x, 9_007_199_254_740_995n);
    const summary = summaryOf(second);
    expect(summary.currencies[0]).toMatchObject({
      current: '9007199254740995',
      previous: '9007199254740993',
      difference: '2',
    });
    expect(summary.total.current).toBe('9007199254740995');
    expect(summary.fromBalances).toBe('2');
    expect(summary.fromExchangeRates).toBe('0');
  });

  // CHF has no rate at all: its equivalent cannot be known.
  it('marks the equivalent incomplete when a rate is missing instead of guessing', async () => {
    const { first, second, value } = await twoCheckins();
    const eur = family.account({
      name: 'Main',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    const chf = family.account({
      name: 'Swiss',
      owner: 'Alex',
      type: 'bank',
      currency: 'CHF',
    });
    value(first, closed1, eur, 100_000n);
    value(first, closed1, chf, 20_000n);
    value(second, closed2, eur, 110_000n);
    value(second, closed2, chf, 30_000n);
    const summary = summaryOf(second);
    expect(
      summary.currencies.find((row) => row.currency === 'CHF'),
    ).toMatchObject({
      current: '30000',
      difference: '10000',
      currentEquivalent: null,
      previousEquivalent: null,
    });
    expect(
      summary.currencies.find((row) => row.currency === 'EUR'),
    ).toMatchObject({
      currentEquivalent: '110000',
    });
    expect(summary.total).toEqual({
      current: null,
      previous: null,
      change: null,
      direction: null,
      complete: false,
    });
    expect(summary.missingRates).toEqual([
      { currency: 'CHF', date: '2026-07-01' },
      { currency: 'CHF', date: '2026-08-01' },
    ]);
    expect(summary.fromBalances).toBeNull();
    expect(summary.fromExchangeRates).toBeNull();
    expect(summary.byMember).toEqual([
      { memberId: 1, name: 'Alex', change: null },
    ]);
    // The account whose rate is known is still ranked.
    expect(summary.biggestChanges.map((entry) => entry.name)).toEqual(['Main']);

    const chart = getWealthSeries(family.database, {
      view: 'equivalent',
      rates: 'dated',
      now,
    });
    expect(chart).toMatchObject({ status: 'ok', series: { incomplete: true } });
    if (chart.status === 'ok') {
      expect(chart.series.points.map((point) => point.amount)).toEqual([
        null,
        null,
      ]);
    }
    const chf2 = getWealthSeries(family.database, {
      view: 'currency',
      currency: 'CHF',
      rates: 'dated',
      now,
    });
    if (chf2.status !== 'ok') throw new Error(chf2.status);
    expect(chf2.series.incomplete).toBe(false);
    expect(chf2.series.points.map((point) => point.amount)).toEqual([
      '20000',
      '30000',
    ]);
  });

  it('needs no rate for a currency whose total is zero', async () => {
    const { first, second, value } = await twoCheckins();
    const chf = family.account({
      name: 'Swiss',
      owner: 'Alex',
      type: 'bank',
      currency: 'CHF',
    });
    const eur = family.account({
      name: 'Main',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    value(first, closed1, chf, 0n);
    value(second, closed2, chf, 0n);
    value(first, closed1, eur, 100n);
    value(second, closed2, eur, 150n);
    const summary = summaryOf(second);
    expect(summary.total).toMatchObject({
      current: '150',
      change: '50',
      complete: true,
    });
    expect(summary.missingRates).toEqual([]);
  });

  it('values a total in a common currency other than the euro', async () => {
    // Common currency USD: a EUR account converts through the inverse of
    // EUR->USD (1.25), and a RUB account through the EUR pivot.
    const { first, second, value } = await twoCheckins('USD');
    const eur = family.account({
      name: 'Euro',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    const rub = family.account({
      name: 'Rub',
      owner: 'Alex',
      type: 'cash',
      currency: 'RUB',
    });
    for (const date of ['2026-07-01', '2026-08-01']) {
      family.rate('EUR', 'USD', date, '1.25');
      family.rate('EUR', 'RUB', date, '100');
    }
    value(first, closed1, eur, 10_000n);
    value(first, closed1, rub, 0n);
    value(second, closed2, eur, 10_000n);
    value(second, closed2, rub, 1_000_000n);
    // EUR 100.00 x 1.25 = $125.00; RUB 10,000.00 / 100 x 1.25 = $125.00.
    const summary = summaryOf(second);
    expect(summary.commonCurrency).toBe('USD');
    expect(summary.total).toMatchObject({
      previous: '12500',
      current: '25000',
      change: '12500',
    });
  });

  it('keeps the five biggest of many changes', async () => {
    const { first, second, value } = await twoCheckins();
    for (let index = 1; index <= 7; index += 1) {
      const id = family.account({
        name: `Account ${index}`,
        owner: 'Alex',
        type: 'bank',
        currency: 'EUR',
      });
      value(first, closed1, id, 0n);
      value(
        second,
        closed2,
        id,
        BigInt(index * (index % 2 === 0 ? -100 : 100)),
      );
    }
    const summary = summaryOf(second);
    expect(summary.biggestChanges.map((entry) => entry.name)).toEqual([
      'Account 7',
      'Account 6',
      'Account 5',
      'Account 4',
      'Account 3',
    ]);
    expect(summary.byMember).toEqual([
      { memberId: 1, name: 'Alex', change: '400' },
    ]);
  });

  it('groups accounts with no owner after the members', async () => {
    const { first, second, value } = await twoCheckins();
    const shared = family.account({
      name: 'Joint',
      owner: null,
      type: 'bank',
      currency: 'EUR',
    });
    const own = family.account({
      name: 'Own',
      owner: 'Blair',
      type: 'bank',
      currency: 'EUR',
    });
    for (const id of [shared, own]) {
      value(first, closed1, id, 0n);
      value(second, closed2, id, 100n);
    }
    expect(summaryOf(second).byMember).toEqual([
      { memberId: 2, name: 'Blair', change: '100' },
      { memberId: null, name: null, change: '100' },
    ]);
  });
});

/*
 * The Start point (SUM-4). Europe/Berlin is UTC+2 in summer, so the end of a
 * local day is 21:59:59.999 UTC. Check-ins close on 2026-07-01 and 2026-08-01.
 *
 *   Main  EUR  opening 1,000.00 at the end of 10/06; C1 1,100.00; C2 1,200.00
 *   Wise  USD  opening   550.00 at the end of 20/06 (the latest opening, so
 *              the Start); C1 600.00; C2 650.00
 *
 * Start at 20/06's rate (EUR->USD 1.1): 1,000.00 + 550/1.1 (500.00)
 *   = 1,500.00. At today's rate (1.6): 1,000.00 + 343.75 = 1,343.75.
 */
describe('the Start point of the wealth series', () => {
  let family: FamilyDatabase;
  const mainOpening = Date.parse('2026-06-10T21:59:59.999Z');
  const wiseOpening = Date.parse('2026-06-20T21:59:59.999Z');

  afterEach(async () => {
    await family.close();
  });

  async function familyWithOpenings() {
    family = await createFamilyDatabase();
    const main = family.account({
      name: 'Main',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    const wise = family.account({
      name: 'Wise',
      owner: 'Blair',
      type: 'bank',
      currency: 'USD',
    });
    family.snapshot({
      accountId: main,
      takenAt: mainOpening,
      amount: 100_000n,
      source: 'opening',
    });
    family.snapshot({
      accountId: wise,
      takenAt: wiseOpening,
      amount: 55_000n,
      source: 'opening',
    });
    return { main, wise };
  }

  function closeCheckins(values: { accountId: number; amounts: bigint[] }[]) {
    return [closed1, closed2].map((closedAt, index) => {
      const id = family.checkin({ openedAt: closedAt - hour, closedAt });
      for (const { accountId, amounts } of values) {
        const amount = amounts[index];
        if (amount === undefined) continue;
        family.snapshot({
          accountId,
          takenAt: closedAt - hour,
          amount,
          source: 'checkin',
          checkinId: id,
        });
      }
      return id;
    });
  }

  function series(options: {
    view: 'equivalent' | 'currency';
    currency?: string;
    rates: 'dated' | 'today';
  }) {
    const result = getWealthSeries(family.database, { ...options, now });
    if (result.status !== 'ok') throw new Error(result.status);
    return result.series;
  }

  function rates() {
    family.rate('EUR', 'USD', '2026-06-20', '1.1');
    family.rate('EUR', 'USD', '2026-07-01', '1.2');
    family.rate('EUR', 'USD', '2026-10-08', '1.6');
  }

  it('starts at the latest opening before the first check-in, at its own rates', async () => {
    const { main, wise } = await familyWithOpenings();
    const [c1, c2] = closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    rates();
    const result = series({ view: 'equivalent', rates: 'dated' });
    expect(result.incomplete).toBe(false);
    // C1: 1,100.00 + 600/1.2 (500.00); C2: 1,200.00 + 650/1.2 (541.67).
    expect(result.points).toEqual([
      {
        checkinId: null,
        closedAt: wiseOpening,
        date: '2026-06-20',
        amount: '150000',
      },
      {
        checkinId: c1,
        closedAt: closed1,
        date: '2026-07-01',
        amount: '160000',
      },
      {
        checkinId: c2,
        closedAt: closed2,
        date: '2026-08-01',
        amount: '174167',
      },
    ]);
  });

  it("values the Start at today's rates, like every point", async () => {
    const { main, wise } = await familyWithOpenings();
    closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    rates();
    expect(
      series({ view: 'equivalent', rates: 'today' }).points[0],
    ).toMatchObject({ checkinId: null, amount: '134375' });
  });

  it('shows the openings of one currency in its own unit', async () => {
    const { main, wise } = await familyWithOpenings();
    closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    const usd = series({ view: 'currency', currency: 'USD', rates: 'dated' });
    expect(usd.points.map((point) => point.amount)).toEqual([
      '55000',
      '60000',
      '65000',
    ]);
    expect(usd.points[0]?.checkinId).toBeNull();
    expect(
      series({ view: 'currency', currency: 'EUR', rates: 'today' }).points.map(
        (point) => point.amount,
      ),
    ).toEqual(['100000', '110000', '120000']);
  });

  it('leaves out an account opened after the first check-in', async () => {
    const { main, wise } = await familyWithOpenings();
    const later = family.account({
      name: 'Later',
      owner: 'Alex',
      type: 'cash',
      currency: 'EUR',
    });
    family.snapshot({
      accountId: later,
      takenAt: Date.parse('2026-07-15T10:00:00Z'),
      amount: 77_700n,
      source: 'opening',
    });
    closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    const eur = series({ view: 'currency', currency: 'EUR', rates: 'dated' });
    expect(eur.points[0]).toMatchObject({
      checkinId: null,
      closedAt: wiseOpening,
      amount: '100000',
    });
    // The later account counts from its own opening, so from C2 on.
    expect(eur.points.map((point) => point.amount)).toEqual([
      '100000',
      '110000',
      '197700',
    ]);
  });

  it('has no points without a closed check-in', async () => {
    await familyWithOpenings();
    family.checkin({ openedAt: closed1, closedAt: null });
    expect(series({ view: 'equivalent', rates: 'dated' }).points).toEqual([]);
  });

  it('has no Start without an opening before the first check-in', async () => {
    family = await createFamilyDatabase();
    const main = family.account({
      name: 'Main',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    const [c1] = closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
    ]);
    family.snapshot({
      accountId: main,
      takenAt: Date.parse('2026-07-10T10:00:00Z'),
      amount: 115_000n,
      source: 'opening',
    });
    const points = series({ view: 'equivalent', rates: 'dated' }).points;
    expect(points).toHaveLength(2);
    expect(points[0]?.checkinId).toBe(c1);
  });

  it("has no Start when the latest opening is on the first check-in's day", async () => {
    const { main, wise } = await familyWithOpenings();
    const cash = family.account({
      name: 'Cash',
      owner: 'Alex',
      type: 'cash',
      currency: 'EUR',
    });
    // 01:30 in Berlin on 01/07, the day C1 closes, though still 30/06 in UTC.
    family.snapshot({
      accountId: cash,
      takenAt: Date.parse('2026-06-30T23:30:00Z'),
      amount: 2_000n,
      source: 'opening',
    });
    const [c1, c2] = closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    rates();
    const points = series({ view: 'equivalent', rates: 'dated' }).points;
    expect(points.map((point) => point.checkinId)).toEqual([c1, c2]);
  });

  it('starts on the day before when the opening is late that day in Berlin', async () => {
    const { main, wise } = await familyWithOpenings();
    const cash = family.account({
      name: 'Cash',
      owner: 'Alex',
      type: 'cash',
      currency: 'EUR',
    });
    // 23:30 in Berlin on 30/06, a day before C1.
    const lateOpening = Date.parse('2026-06-30T21:30:00Z');
    family.snapshot({
      accountId: cash,
      takenAt: lateOpening,
      amount: 2_000n,
      source: 'opening',
    });
    closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    // 1,000.00 + 20.00 + 550/1.1 at the nearest earlier rate (20/06).
    rates();
    expect(series({ view: 'equivalent', rates: 'dated' }).points[0]).toEqual({
      checkinId: null,
      closedAt: lateOpening,
      date: '2026-06-30',
      amount: '152000',
    });
  });

  it('makes the Start null and the series incomplete when its rate is missing', async () => {
    const { main, wise } = await familyWithOpenings();
    closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
      { accountId: wise, amounts: [60_000n, 65_000n] },
    ]);
    // No rate on or before 20/06.
    family.rate('EUR', 'USD', '2026-07-01', '1.2');
    const result = series({ view: 'equivalent', rates: 'dated' });
    expect(result.incomplete).toBe(true);
    expect(result.points.map((point) => point.amount)).toEqual([
      null,
      '160000',
      '174167',
    ]);
    expect(result.points[0]?.checkinId).toBeNull();
  });

  it('has no Start when only other sources precede the first check-in', async () => {
    family = await createFamilyDatabase();
    const main = family.account({
      name: 'Main',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    family.snapshot({
      accountId: main,
      takenAt: Date.parse('2026-06-10T10:00:00Z'),
      amount: 100_000n,
      source: 'manual',
    });
    const [c1, c2] = closeCheckins([
      { accountId: main, amounts: [110_000n, 120_000n] },
    ]);
    const points = series({ view: 'equivalent', rates: 'dated' }).points;
    expect(points.map((point) => point.checkinId)).toEqual([c1, c2]);
  });

  it('keeps an opening above 2^53 exact in the Start', async () => {
    family = await createFamilyDatabase();
    const main = family.account({
      name: 'Main',
      owner: 'Alex',
      type: 'bank',
      currency: 'EUR',
    });
    family.snapshot({
      accountId: main,
      takenAt: mainOpening,
      amount: 9_007_199_254_740_993n,
      source: 'opening',
    });
    closeCheckins([
      { accountId: main, amounts: [9_007_199_254_740_995n, 100n] },
    ]);
    for (const view of ['equivalent', 'currency'] as const) {
      const points = series({ view, currency: 'EUR', rates: 'dated' }).points;
      expect(points.map((point) => point.amount)).toEqual([
        '9007199254740993',
        '9007199254740995',
        '100',
      ]);
    }
  });

  /*
   * Berlin's day is 23 hours long on 29/03/2026 (UTC+1 until 01:00 UTC, then
   * UTC+2) and 25 hours long on 25/10/2026 (UTC+2 until 01:00 UTC, then
   * UTC+1). The Start and the first check-in share a day only if both fall
   * inside the same local day, whatever the offset at each instant.
   */
  it.each([
    {
      name: 'spring: 23:59:59 on 28/03 (UTC+1) is the day before',
      opening: '2026-03-28T22:59:59Z',
      close: '2026-03-29T21:59:00Z',
      start: '2026-03-28',
    },
    {
      name: 'spring: 00:00 on 29/03 (UTC+1) is the check-in day at 23:59',
      opening: '2026-03-28T23:00:00Z',
      close: '2026-03-29T21:59:00Z',
      start: undefined,
    },
    {
      name: 'autumn: 23:59:59 on 24/10 (UTC+2) is the day before',
      opening: '2026-10-24T21:59:59Z',
      close: '2026-10-25T22:30:00Z',
      start: '2026-10-24',
    },
    {
      name: 'autumn: 00:00 on 25/10 (UTC+2) is the check-in day at 23:30',
      opening: '2026-10-24T22:00:00Z',
      close: '2026-10-25T22:30:00Z',
      start: undefined,
    },
  ])(
    'puts the Start on the right day across daylight saving, $name',
    async ({ opening, close, start }) => {
      family = await createFamilyDatabase();
      const main = family.account({
        name: 'Main',
        owner: 'Alex',
        type: 'bank',
        currency: 'EUR',
      });
      const takenAt = Date.parse(opening);
      family.snapshot({
        accountId: main,
        takenAt,
        amount: 100_000n,
        source: 'opening',
      });
      const closedAt = Date.parse(close);
      const id = family.checkin({ openedAt: closedAt - hour, closedAt });
      family.snapshot({
        accountId: main,
        takenAt: closedAt - hour,
        amount: 110_000n,
        source: 'checkin',
        checkinId: id,
      });
      const points = series({
        view: 'currency',
        currency: 'EUR',
        rates: 'dated',
      }).points;
      if (start === undefined) {
        expect(points.map((point) => point.checkinId)).toEqual([id]);
      } else {
        expect(points[0]).toEqual({
          checkinId: null,
          closedAt: takenAt,
          date: start,
          amount: '100000',
        });
        expect(points).toHaveLength(2);
      }
    },
  );
});
