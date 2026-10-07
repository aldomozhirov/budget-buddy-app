import { getIsoCurrency, ISO_4217, type IsoCurrency } from './iso4217.js';

export interface CoinCurrency {
  readonly code: string;
  readonly name: string;
  readonly decimals: number;
}

export interface Currency extends CoinCurrency {
  readonly kind: 'fiat' | 'coin';
  readonly symbol: string;
}

const COIN_SYMBOLS: Readonly<Record<string, string>> = { BTC: '₿', ETH: 'Ξ', USDT: '₮' };

function fromIso(currency: IsoCurrency): Currency {
  let symbol: string = currency.code;
  try {
    symbol = new Intl.NumberFormat('en', { style: 'currency', currency: currency.code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(1)
      .find((part) => part.type === 'currency')?.value ?? currency.code;
  } catch {
    // Some ISO fund/testing codes are not supported by the current ICU data.
  }
  return { ...currency, kind: 'fiat', symbol };
}

export function getCurrency(code: string, coins: readonly CoinCurrency[] = []): Currency | undefined {
  const upperCode = code.toUpperCase();
  const iso = getIsoCurrency(upperCode);
  if (iso) return fromIso(iso);
  const coin = coins.find((candidate) => candidate.code.toUpperCase() === upperCode);
  if (!coin) return undefined;
  if (!Number.isInteger(coin.decimals) || coin.decimals < 0 || coin.decimals > 8) {
    throw new RangeError(`Coin decimals must be between 0 and 8: ${coin.code}`);
  }
  return { ...coin, code: upperCode, kind: 'coin', symbol: COIN_SYMBOLS[upperCode] ?? upperCode };
}

export function listCurrencies(coins: readonly CoinCurrency[] = []): Currency[] {
  return [
    ...Object.values(ISO_4217).map(fromIso),
    ...coins.filter((coin) => !getIsoCurrency(coin.code)).map((coin) => {
      const currency = getCurrency(coin.code, [coin]);
      if (!currency) throw new Error(`Invalid coin currency: ${coin.code}`);
      return currency;
    }),
  ];
}
