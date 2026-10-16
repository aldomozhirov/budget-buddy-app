import { getIsoCurrency, ISO_4217, NON_MONEY_CODES, type IsoCurrency } from './iso4217.js';

/** A user-defined coin, such as a row of the `coin` table. */
export interface CoinCurrency {
  readonly code: string;
  readonly name: string;
  /** Decimal places of the minor unit; 0-8 for a coin. */
  readonly decimals: number;
}

/** A fiat or coin currency resolved for arithmetic and display. */
export interface Currency extends CoinCurrency {
  readonly kind: 'fiat' | 'coin';
  /** Narrow display symbol, such as `€` or `₿`, or else the code. */
  readonly symbol: string;
}

/** Symbols for well-known coins; other coins display their code. */
const COIN_SYMBOLS: Readonly<Record<string, string>> = { BTC: '₿', ETH: 'Ξ', USDT: '₮' };

/**
 * Marks an ISO currency as fiat and adds Intl's narrow symbol, or the code.
 * Intl accepts any well-formed three-letter code, so this never throws.
 */
function fromIso(currency: IsoCurrency): Currency {
  const symbol = new Intl.NumberFormat('en', { style: 'currency', currency: currency.code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(1)
    .find((part) => part.type === 'currency')?.value ?? currency.code;
  return { ...currency, kind: 'fiat', symbol };
}

/**
 * Resolves a coin for arithmetic and display, in upper case.
 * @throws {RangeError} if its decimals are not an integer from 0 to 8.
 */
function fromCoin(coin: CoinCurrency): Currency {
  if (!Number.isInteger(coin.decimals) || coin.decimals < 0 || coin.decimals > 8) {
    throw new RangeError(`Coin decimals must be between 0 and 8: ${coin.code}`);
  }
  const code = coin.code.toUpperCase();
  return { ...coin, code, kind: 'coin', symbol: COIN_SYMBOLS[code] ?? code };
}

/**
 * Resolves a code, ignoring case, to an ISO currency or else to one of
 * `coins`. ISO codes win over a coin with the same code; a coin's code is
 * returned in upper case. Returns `undefined` when neither matches.
 * @throws {RangeError} if the matching coin's decimals are not an integer
 * from 0 to 8.
 */
export function getCurrency(code: string, coins: readonly CoinCurrency[] = []): Currency | undefined {
  const upperCode = code.toUpperCase();
  const iso = getIsoCurrency(upperCode);
  if (iso) return fromIso(iso);
  const coin = coins.find((candidate) => candidate.code.toUpperCase() === upperCode);
  return coin ? fromCoin(coin) : undefined;
}

/**
 * Lists the currencies to offer in a picker: every ISO currency except
 * `NON_MONEY_CODES`, then `coins`, skipping coins whose code is already an
 * ISO code. `getCurrency` still resolves the hidden codes.
 * @throws {RangeError} if a coin's decimals are not an integer from 0 to 8.
 */
export function listCurrencies(coins: readonly CoinCurrency[] = []): Currency[] {
  return [
    ...Object.values(ISO_4217).filter(({ code }) => !NON_MONEY_CODES.has(code)).map(fromIso),
    ...coins.filter((coin) => !getIsoCurrency(coin.code)).map(fromCoin),
  ];
}
