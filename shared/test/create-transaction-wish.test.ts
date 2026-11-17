import { describe, expect, it } from 'vitest';
import { createTransactionRequestSchema } from '../src/index.js';

const expense = { kind: 'expense', accountId: 1, amount: '4800' };

describe('createTransactionRequestSchema with a wish', () => {
  it('accepts a wish, with or without a link amount', () => {
    expect(
      createTransactionRequestSchema.safeParse({ ...expense, wishId: 3 })
        .success,
    ).toBe(true);
    expect(
      createTransactionRequestSchema.safeParse({
        ...expense,
        wishId: 3,
        linkAmount: '4500',
      }).success,
    ).toBe(true);
  });

  it('refuses a link amount without a wish', () => {
    const result = createTransactionRequestSchema.safeParse({
      ...expense,
      linkAmount: '4500',
    });
    expect(result.success).toBe(false);
  });

  it('refuses a wish with an envelope', () => {
    expect(
      createTransactionRequestSchema.safeParse({
        ...expense,
        wishId: 3,
        envelopeId: 2,
      }).success,
    ).toBe(false);
    expect(
      createTransactionRequestSchema.safeParse({
        ...expense,
        wishId: 3,
        envelopeId: null,
      }).success,
    ).toBe(true);
  });

  it('refuses a wish on an income or a transfer', () => {
    expect(
      createTransactionRequestSchema.safeParse({
        kind: 'income',
        accountId: 1,
        amount: '100',
        wishId: 3,
      }).success,
    ).toBe(false);
    expect(
      createTransactionRequestSchema.safeParse({
        kind: 'transfer',
        accountId: 1,
        toAccountId: 2,
        amount: '100',
        wishId: 3,
      }).success,
    ).toBe(false);
  });

  it('accepts a link kind with a wish only', () => {
    for (const wishFrom of ['wish', 'form']) {
      expect(
        createTransactionRequestSchema.safeParse({
          ...expense,
          wishId: 3,
          wishFrom,
        }).success,
      ).toBe(true);
    }
    expect(
      createTransactionRequestSchema.safeParse({ ...expense, wishFrom: 'form' })
        .success,
    ).toBe(false);
    expect(
      createTransactionRequestSchema.safeParse({
        ...expense,
        wishId: 3,
        wishFrom: 'member',
      }).success,
    ).toBe(false);
  });

  it('accepts neither on an expense, alone or with a null envelope', () => {
    expect(
      createTransactionRequestSchema.safeParse({ ...expense, unplanned: true })
        .success,
    ).toBe(true);
    expect(
      createTransactionRequestSchema.safeParse({
        ...expense,
        envelopeId: null,
        unplanned: true,
      }).success,
    ).toBe(true);
  });

  it('refuses neither with an envelope, a wish, false or an income', () => {
    for (const extra of [
      { envelopeId: 2 },
      { wishId: 3 },
      { unplanned: false },
      { kind: 'income' },
    ]) {
      expect(
        createTransactionRequestSchema.safeParse({
          ...expense,
          unplanned: true,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
});
