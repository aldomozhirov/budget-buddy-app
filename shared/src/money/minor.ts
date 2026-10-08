/** Wire format of an amount: an optionally negative integer of 1-20 digits. */
const MINOR_PATTERN = /^-?\d{1,20}$/;

/**
 * Parses a JSON decimal-integer string, such as `"-198630"`, into minor units.
 * @throws {RangeError} if `value` is not an integer string of at most 20
 * digits (a leading `+`, decimal point or whitespace is rejected).
 */
export function parseMinor(value: string): bigint {
  if (!MINOR_PATTERN.test(value)) throw new RangeError('Amount must be a decimal integer with at most 20 digits');
  return BigInt(value);
}

/**
 * Converts minor units to the JSON decimal-integer string form.
 * @throws {RangeError} if `value` has more than 20 digits.
 */
export function toMinorString(value: bigint): string {
  const serialized = value.toString();
  if (!MINOR_PATTERN.test(serialized)) throw new RangeError('Amount must have at most 20 digits');
  return serialized;
}
