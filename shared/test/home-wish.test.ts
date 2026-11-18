import { describe, expect, it } from 'vitest';
import { homeWishSchema } from '../src/index.js';

const wish = {
  id: 1,
  name: 'Tyres',
  currency: 'EUR',
  amount: '100',
  spent: '0',
};

describe('homeWishSchema', () => {
  it('accepts an open or done state', () => {
    expect(homeWishSchema.parse({ ...wish, state: 'open' }).state).toBe('open');
    expect(homeWishSchema.parse({ ...wish, state: 'done' }).state).toBe('done');
  });

  it('refuses another state or none', () => {
    expect(
      homeWishSchema.safeParse({ ...wish, state: 'dropped' }).success,
    ).toBe(false);
    expect(homeWishSchema.safeParse(wish).success).toBe(false);
  });
});
