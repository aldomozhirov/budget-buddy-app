import { describe, expect, it } from 'vitest';
import {
  fillOnSave,
  type FillCategory,
  type FillEnvelope,
} from '../src/spending/index.js';

/** Groceries (1) ↔ envelope Groceries (10); Travel (2) → archived (11). */
const categories = new Map<number, FillCategory>([
  [1, { defaultEnvelopeId: 10, archived: false }],
  [2, { defaultEnvelopeId: 11, archived: false }],
  [3, { defaultEnvelopeId: null, archived: true }],
]);
const envelopes = new Map<number, FillEnvelope>([
  [10, { defaultCategoryId: 1, archived: false }],
  [11, { defaultCategoryId: null, archived: true }],
  [12, { defaultCategoryId: 3, archived: false }],
]);
const fill = (
  kind: 'expense' | 'income' | 'transfer',
  categoryId: number | null,
  envelopeId: number | null,
) =>
  fillOnSave(
    { kind, categoryId, envelopeId },
    (id) => categories.get(id),
    (id) => envelopes.get(id),
  );

describe('fillOnSave', () => {
  it('fills an empty envelope from the category and says so', () => {
    expect(fill('expense', 1, null)).toEqual({
      categoryId: 1,
      envelopeId: 10,
      filled: { envelope: 'category' },
    });
  });

  it('fills an empty category from the envelope and says so', () => {
    expect(fill('expense', null, 10)).toEqual({
      categoryId: 1,
      envelopeId: 10,
      filled: { category: 'envelope' },
    });
  });

  it('keeps what was chosen and does not chain', () => {
    expect(fill('expense', 1, 12)).toEqual({
      categoryId: 1,
      envelopeId: 12,
      filled: {},
    });
    expect(fill('expense', null, null).filled).toEqual({});
  });

  it('uses only active defaults', () => {
    expect(fill('expense', 2, null)).toEqual({
      categoryId: 2,
      envelopeId: null,
      filled: {},
    });
    expect(fill('expense', null, 12)).toEqual({
      categoryId: null,
      envelopeId: 12,
      filled: {},
    });
  });

  it('fills nothing on income or a transfer', () => {
    expect(fill('income', 1, null).filled).toEqual({});
    expect(fill('transfer', null, 10).filled).toEqual({});
  });
});
