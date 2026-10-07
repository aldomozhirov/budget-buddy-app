import Decimal from 'decimal.js';
import type { Currency } from './currency.js';
import { roundHalfAwayFromZero } from './rounding.js';

const RateDecimal = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export interface DatedRate {
  readonly rate: string;
  readonly date: string;
}

/** The lookup returns the latest stored rate on or before the requested date. */
export type RateLookup = (base: string, quote: string, onOrBefore: string) => DatedRate | undefined;

export type ConversionResult = { readonly value: bigint; readonly rateDate: string } | { readonly missing: true };

interface Leg { readonly value: Decimal; readonly date: string }

function getLeg(from: string, to: string, date: string, lookup: RateLookup): Leg | undefined {
  const direct = lookup(from, to, date);
  if (direct) return { value: parseRate(direct.rate), date: direct.date };
  const inverse = lookup(to, from, date);
  if (!inverse) return undefined;
  const rate = parseRate(inverse.rate);
  return { value: new RateDecimal(1).div(rate), date: inverse.date };
}

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

function rescale(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (toDecimals >= fromDecimals) return amount * 10n ** BigInt(toDecimals - fromDecimals);
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  const quotient = amount / divisor;
  const remainder = amount % divisor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  return absoluteRemainder * 2n >= divisor ? quotient + (amount < 0n ? -1n : 1n) : quotient;
}
