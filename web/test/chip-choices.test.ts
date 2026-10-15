import { describe, expect, it } from 'vitest';
import { chipChoices } from '../src/screens/categories/chipChoices.js';

const items = [1, 2, 3, 4, 5].map((id) => ({ id }));

describe('chipChoices', () => {
  it('takes the first items', () => {
    expect(chipChoices(items, null, 3).map((item) => item.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it('keeps the order when the pick is among them', () => {
    expect(chipChoices(items, 2, 3).map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('puts a pick from beyond the row in front', () => {
    expect(chipChoices(items, 5, 3).map((item) => item.id)).toEqual([5, 1, 2]);
  });

  it('ignores a pick that is not in the list', () => {
    expect(chipChoices(items, 9, 3).map((item) => item.id)).toEqual([1, 2, 3]);
  });
});
