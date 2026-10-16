import Decimal from 'decimal.js';
import type { Currency } from './currency.js';
import { roundHalfAwayFromZero } from './rounding.js';

/** Decimal context for rates: 34 significant digits, ties away from zero. */
const RateDecimal = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
});

/** A stored exchange rate and the date it applies to. */
export interface DatedRate {
  /** Exact decimal string: units of quote per one unit of base. */
  readonly rate: string;
  /** YYYY-MM-DD. */
  readonly date: string;
}

/**
 * Rate source giving the latest stored `base`-to-`quote` rate dated on or
 * before `onOrBefore` (YYYY-MM-DD), or `undefined` when there is none.
 */
export type RateLookup = (
  base: string,
  quote: string,
  onOrBefore: string,
) => DatedRate | undefined;

/**
 * A converted amount in the target's minor units with the date of the oldest
 * rate used, or `{ missing: true }` when no rate path exists.
 */
export type ConversionResult =
  | { readonly value: bigint; readonly rateDate: string }
  | { readonly missing: true };

/** One conversion step: the rate to multiply by and the date it is from. */
interface Leg {
  readonly value: Decimal;
  readonly date: string;
}

/**
 * Finds the `from`-to-`to` rate, inverting the `to`-to-`from` rate when there
 * is no direct one.
 * @throws {RangeError} if the stored rate is not a finite positive decimal.
 */
function getLeg(
  from: string,
  to: string,
  date: string,
  lookup: RateLookup,
): Leg | undefined {
  const direct = lookup(from, to, date);
  if (direct) return { value: parseRate(direct.rate), date: direct.date };
  const inverse = lookup(to, from, date);
  if (!inverse) return undefined;
  const rate = parseRate(inverse.rate);
  return { value: new RateDecimal(1).div(rate), date: inverse.date };
}

/**
 * Parses a stored rate string.
 * @throws {RangeError} if it is not a finite positive decimal.
 */
function parseRate(value: string): Decimal {
  let rate: Decimal;
  try {
    rate = new RateDecimal(value);
  } catch {
    throw new RangeError('Rate must be a finite positive decimal');
  }
  if (!rate.isFinite() || !rate.gt(0))
    throw new RangeError('Rate must be a finite positive decimal');
  return rate;
}

/**
 * Finds the rate path from `from` to `to`: a direct (or inverted) rate if one
 * exists, even when older than a pivot route; otherwise the first pivot with
 * rates for both legs. Undefined when there is none.
 * @throws {RangeError} if a stored rate is not a finite positive decimal.
 */
function findLegs(
  from: string,
  to: string,
  date: string,
  lookup: RateLookup,
  pivots: readonly string[],
): Leg[] | undefined {
  const direct = getLeg(from, to, date, lookup);
  if (direct) return [direct];
  for (const pivot of pivots) {
    if (pivot === from || pivot === to) continue;
    const first = getLeg(from, pivot, date, lookup);
    const second = getLeg(pivot, to, date, lookup);
    if (first && second) return [first, second];
  }
  return undefined;
}

/** The oldest date among the legs: the date a conversion is "at". */
function oldestDate(legs: readonly Leg[], fallback: string): string {
  return legs.map((leg) => leg.date).sort()[0] ?? fallback;
}

/**
 * The rate `convert` uses between two different currencies on `date`: units
 * of `to` per one whole unit of `from`, through the same path, as an exact
 * decimal string in plain notation (34 significant digits).
 * @param date YYYY-MM-DD date the rates must not be later than.
 * @returns The rate with `date`, the oldest rate date used, or undefined
 * when no rate path exists.
 * @throws {RangeError} if a stored rate is not a finite positive decimal.
 * @example
 * // With one stored rate: USD→EUR 0.9149 dated 2026-10-02.
 * exchangeRate('USD', 'EUR', '2026-10-03', lookup);
 * // { rate: '0.9149', date: '2026-10-02' }
 */
export function exchangeRate(
  from: string,
  to: string,
  date: string,
  lookup: RateLookup,
  pivots: readonly string[] = ['EUR', 'USD'],
): DatedRate | undefined {
  const legs = findLegs(from, to, date, lookup, pivots);
  if (!legs) return undefined;
  const rate = legs.reduce(
    (value, leg) => value.mul(leg.value),
    new RateDecimal(1),
  );
  return { rate: rate.toFixed(), date: oldestDate(legs, date) };
}

/**
 * Converts minor units between currencies at the latest rates on or before
 * `date`, through the rate path of `exchangeRate`. Works to 34 significant
 * digits and rounds once, half away from zero, to the target's minor units.
 * Same-code amounts are only rescaled.
 * @param date YYYY-MM-DD date the rates must not be later than.
 * @param pivots Currency codes tried in order as a single intermediate.
 * @returns The value with `rateDate`, the oldest rate date used (`date` for
 * the same currency), or `{ missing: true }` when no rate path exists.
 * @throws {RangeError} if a stored rate is not a finite positive decimal.
 */
export function convert(
  amount: bigint,
  from: Currency,
  to: Currency,
  date: string,
  lookup: RateLookup,
  pivots: readonly string[] = ['EUR', 'USD'],
): ConversionResult {
  if (from.code === to.code)
    return {
      value: rescale(amount, from.decimals, to.decimals),
      rateDate: date,
    };
  const legs = findLegs(from.code, to.code, date, lookup, pivots);
  if (!legs) return { missing: true };
  const sourceMajor = new RateDecimal(amount.toString()).div(
    new RateDecimal(10).pow(from.decimals),
  );
  const targetMajor = legs.reduce(
    (value, leg) => value.mul(leg.value),
    sourceMajor,
  );
  const targetMinor = targetMajor.mul(new RateDecimal(10).pow(to.decimals));
  return {
    value: roundHalfAwayFromZero(targetMinor, 0),
    rateDate: oldestDate(legs, date),
  };
}

/** Changes the decimal places of minor units, rounding half away from zero. */
function rescale(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  if (toDecimals >= fromDecimals)
    return amount * 10n ** BigInt(toDecimals - fromDecimals);
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  const quotient = amount / divisor;
  const remainder = amount % divisor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  return absoluteRemainder * 2n >= divisor
    ? quotient + (amount < 0n ? -1n : 1n)
    : quotient;
}
