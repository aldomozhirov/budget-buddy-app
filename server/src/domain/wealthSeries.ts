import type Database from 'better-sqlite3';
import { toMinorString, type WealthSeries } from '@budget-buddy/shared';
import { currencyTotalsAt } from './balance.js';
import { createValuation } from './valuation.js';

/** What the chart plots (SUM-4, CUR-6). */
export interface WealthSeriesOptions {
  /** `equivalent` plots the common currency; `currency` one currency's unit. */
  view: 'equivalent' | 'currency';
  /** The currency of the `currency` view. */
  currency?: string | undefined;
  /** `dated` values each point at its own day's rates, `today` at the latest. */
  rates: 'dated' | 'today';
  /** The current instant, for `today` and for the latest rates. */
  now: number;
}

/** Result of asking for a series: the series, or an unknown currency. */
export type WealthSeriesResult =
  { status: 'ok'; series: WealthSeries } | { status: 'unknown_currency' };

/**
 * Computes one point per closed check-in, oldest first, from stored data
 * (SUM-1). All balances come from one batched query. In the equivalent view
 * each currency total is converted at its point's rates, or with `today` at
 * the latest stored rates for every point, and a point that lacks a rate is
 * `null`. A single currency needs no rates.
 * @throws {Error} if the family is not set up or an account has an unknown
 * currency.
 */
export function getWealthSeries(
  database: Database.Database,
  options: WealthSeriesOptions,
): WealthSeriesResult {
  const valuation = createValuation(database);
  const checkins = (
    database
      .prepare(
        `SELECT id, closed_at FROM checkin WHERE closed_at IS NOT NULL
         ORDER BY closed_at, id`,
      )
      .all() as { id: bigint; closed_at: bigint }[]
  ).map((row) => ({ id: Number(row.id), closedAt: Number(row.closed_at) }));
  const currencies = (
    database
      .prepare('SELECT DISTINCT currency FROM account ORDER BY currency')
      .all() as { currency: string }[]
  ).map((row) => row.currency);

  const unit =
    options.view === 'currency'
      ? (options.currency ?? valuation.commonCurrency.code)
      : valuation.commonCurrency.code;
  if (options.view === 'currency' && !currencies.includes(unit)) {
    return { status: 'unknown_currency' };
  }

  const totals = currencyTotalsAt(
    database,
    checkins.map((checkin) => checkin.closedAt),
  );
  const latestDate = valuation.dateOf(options.now);
  let incomplete = false;
  const points = checkins.map(({ id, closedAt }, index) => {
    const date = valuation.dateOf(closedAt);
    const byCurrency = totals[index] ?? new Map<string, bigint>();
    let amount: bigint | null = 0n;
    if (options.view === 'currency') {
      amount = byCurrency.get(unit) ?? 0n;
    } else {
      const on = options.rates === 'today' ? latestDate : date;
      for (const [code, total] of byCurrency) {
        const value = valuation.toCommon(total, code, on);
        if (value === undefined) {
          amount = null;
          break;
        }
        amount += value;
      }
    }
    if (amount === null) incomplete = true;
    return {
      checkinId: id,
      closedAt,
      date,
      amount: amount === null ? null : toMinorString(amount),
    };
  });

  return {
    status: 'ok',
    series: {
      view: options.view,
      currency: unit,
      rates: options.rates,
      currencies,
      points,
      incomplete,
    },
  };
}
