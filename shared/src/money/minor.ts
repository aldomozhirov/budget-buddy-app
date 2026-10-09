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
