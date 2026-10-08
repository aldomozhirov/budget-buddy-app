/** ISO 4217 alphabetic currency codes. Minor-unit exceptions are listed below. */
export const ISO_4217_CODES = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CUC', 'CUP', 'CVE', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL',
  'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'USN', 'UYI', 'UYU', 'UYW', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XCG', 'XDR', 'XOF', 'XPD', 'XPF', 'XPT', 'XSU', 'XTS', 'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWG', 'ZWL',
] as const;

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
const FOUR_DECIMAL = new Set(['CLF', 'UYW']);
/**
 * ISO codes with no minor unit that aren't money a family holds: precious
 * metals, bond-market units, IMF units, and the testing and "no currency"
 * codes. They stay valid but are left out of `listCurrencies`.
 */
export const NON_MONEY_CODES: ReadonlySet<string> = new Set([
  'XAG', 'XAU', 'XPD', 'XPT', 'XBA', 'XBB', 'XBC', 'XBD', 'XDR', 'XSU', 'XUA', 'XTS', 'XXX',
]);
const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });

/** A currency from the bundled ISO 4217 table. */
export interface IsoCurrency {
  readonly code: (typeof ISO_4217_CODES)[number];
  /** English name from Intl, or the code when Intl has none. */
  readonly name: string;
  /** ISO minor-unit exponent: 0, 2, 3 or 4 decimal places. */
  readonly decimals: number;
}

/** Bundled ISO 4217 table keyed by upper-case code, with English names. */
export const ISO_4217: Readonly<Record<string, IsoCurrency>> = Object.freeze(
  Object.fromEntries(
    ISO_4217_CODES.map((code) => [
      code,
      Object.freeze({
        code,
        name: displayNames.of(code) ?? code,
        decimals: FOUR_DECIMAL.has(code) ? 4 : THREE_DECIMAL.has(code) ? 3 : ZERO_DECIMAL.has(code) ? 0 : 2,
      }),
    ]),
  ),
);

/** Looks up an ISO 4217 currency by code, ignoring case. */
export function getIsoCurrency(code: string): IsoCurrency | undefined {
  return ISO_4217[code.toUpperCase()];
}
