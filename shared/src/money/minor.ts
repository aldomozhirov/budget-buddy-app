/** Largest amount SQLite's 64-bit INTEGER can store: 2^63 - 1. */
export const MAX_MINOR = 2n ** 63n - 1n;
/** Smallest amount SQLite's 64-bit INTEGER can store: -2^63. */
export const MIN_MINOR = -(2n ** 63n);

/** Wire format of an amount: an optionally negative integer of 1-19 digits. */
const MINOR_PATTERN = /^-?\d{1,19}$/;

/** Whether an amount fits SQLite's 64-bit INTEGER. */
export function isMinorInRange(value: bigint): boolean {
  return value >= MIN_MINOR && value <= MAX_MINOR;
}

/**
 * Parses a JSON decimal-integer string, such as `"-198630"`, into minor units.
 * @throws {RangeError} if `value` is not an integer string (a leading `+`,
 * decimal point or whitespace is rejected) or is outside the 64-bit range.
 */
export function parseMinor(value: string): bigint {
  if (!MINOR_PATTERN.test(value)) {
    if (/^-?\d+$/u.test(value) && !isMinorInRange(BigInt(value))) {
      throw new RangeError('Amount is too large');
    }
    throw new RangeError(
      'Amount must be a decimal integer with at most 19 digits',
    );
  }
  const amount = BigInt(value);
  if (!isMinorInRange(amount)) throw new RangeError('Amount is too large');
  return amount;
}

/**
 * Converts minor units to the JSON decimal-integer string form.
 * @throws {RangeError} if `value` is outside the 64-bit range.
 */
export function toMinorString(value: bigint): string {
  if (!isMinorInRange(value)) throw new RangeError('Amount is too large');
  return value.toString();
}

/**
 * Writes minor units as an exact decimal string in major units, such as
 * `-1986.30` for `-198630n` with 2 decimals: ASCII minus, a point, no
 * grouping, always `decimals` fraction digits. For files read by machines.
 * @throws {RangeError} if `decimals` is not an integer from 0 to 8.
 */
export function formatMinorDecimal(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new RangeError('Decimals must be an integer from 0 to 8');
  }
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${whole}${decimals === 0 ? '' : `.${fraction}`}`;
}
