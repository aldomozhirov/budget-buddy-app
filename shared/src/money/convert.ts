import Decimal from 'decimal.js';
import type { Currency } from './currency.js';
import { roundHalfAwayFromZero } from './rounding.js';

/** Decimal context for rates: 34 significant digits, ties away from zero. */
const RateDecimal = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

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
export type RateLookup = (base: string, quote: string, onOrBefore: string) => DatedRate | undefined;

/**
 * A converted amount in the target's minor units with the date of the oldest
 * rate used, or `{ missing: true }` when no rate path exists.
 */
export type ConversionResult = { readonly value: bigint; readonly rateDate: string } | { readonly missing: true };

/** One conversion step: the rate to multiply by and the date it is from. */
interface Leg { readonly value: Decimal; readonly date: string }

/**
 * Finds the `from`-to-`to` rate, inverting the `to`-to-`from` rate when there
 * is no direct one.
 * @throws {RangeError} if the stored rate is not a finite positive decimal.
 */
function getLeg(from: string, to: string, date: string, lookup: RateLookup): Leg | undefined {
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
  if (!rate.isFinite() || !rate.gt(0)) throw new RangeError('Rate must be a finite positive decimal');
  return rate;
}

/**
 * Converts minor units between currencies at the latest rates on or before
 * `date`. A direct (or inverted) rate is used if one exists, even when older
 * than a pivot route; otherwise the first pivot with rates for both legs.
 * Works to 34 significant digits and rounds once, half away from zero, to
 * the target's minor units. Same-code amounts are only rescaled.
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
  if (from.code === to.code) return { value: rescale(amount, from.decimals, to.decimals), rateDate: date };
  const direct = getLeg(from.code, to.code, date, lookup);
  let legs: Leg[] | undefined = direct ? [direct] : undefined;
  if (!legs) {
    for (const pivot of pivots) {
      if (pivot === from.code || pivot === to.code) continue;
      const first = getLeg(from.code, pivot, date, lookup);
      const second = getLeg(pivot, to.code, date, lookup);
      if (first && second) { legs = [first, second]; break; }
    }
  }
  if (!legs) return { missing: true };
  const sourceMajor = new RateDecimal(amount.toString()).div(new RateDecimal(10).pow(from.decimals));
  const targetMajor = legs.reduce((value, leg) => value.mul(leg.value), sourceMajor);
  const targetMinor = targetMajor.mul(new RateDecimal(10).pow(to.decimals));
  return { value: roundHalfAwayFromZero(targetMinor, 0), rateDate: legs.map((leg) => leg.date).sort()[0] ?? date };
}

/** Changes the decimal places of minor units, rounding half away from zero. */
function rescale(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (toDecimals >= fromDecimals) return amount * 10n ** BigInt(toDecimals - fromDecimals);
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  const quotient = amount / divisor;
  const remainder = amount % divisor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  return absoluteRemainder * 2n >= divisor ? quotient + (amount < 0n ? -1n : 1n) : quotient;
}
