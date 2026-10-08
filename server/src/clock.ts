/** Supplies the current instant to code that must be deterministic in tests. */
export interface Clock {
  /** Returns the current instant. */
  now(): Date;
}

/** Production clock; tests should pass a fixed implementation instead. */
export const systemClock: Clock = {
  now: () => new Date(),
};
