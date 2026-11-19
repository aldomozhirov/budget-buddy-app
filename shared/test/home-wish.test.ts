import { describe, expect, it } from 'vitest';
import { homeWishesSchema, homeWishSchema } from '../src/index.js';

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

describe('homeWishesSchema', () => {
  const card = { wished: null, spent: null, incomplete: false, items: [] };

  it('has no count of open wishes', () => {
    expect(Object.keys(homeWishesSchema.shape)).not.toContain('open');
    expect(homeWishesSchema.parse({ ...card, open: 3 })).not.toHaveProperty(
      'open',
    );
  });

  it('accepts a card without that count and refuses a card without items', () => {
    expect(homeWishesSchema.safeParse(card).success).toBe(true);
    expect(
      homeWishesSchema.safeParse({
        wished: null,
        spent: null,
        incomplete: false,
      }).success,
    ).toBe(false);
  });
});
