const MINOR_PATTERN = /^-?\d{1,20}$/;

export function parseMinor(value: string): bigint {
  if (!MINOR_PATTERN.test(value)) throw new RangeError('Amount must be a decimal integer with at most 20 digits');
  return BigInt(value);
}

export function toMinorString(value: bigint): string {
  const serialized = value.toString();
  if (!MINOR_PATTERN.test(serialized)) throw new RangeError('Amount must have at most 20 digits');
  return serialized;
}
