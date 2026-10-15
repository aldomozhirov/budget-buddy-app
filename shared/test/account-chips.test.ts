import { describe, expect, it } from 'vitest';
import {
  accountChipLabels,
  pickAccountChips,
  type ChipAccount,
} from '../src/index.js';

function account(
  id: number,
  name: string,
  extra: Partial<ChipAccount> = {},
): ChipAccount {
  return {
    id,
    name,
    ownerMemberId: 1,
    ownerName: 'Alena',
    type: 'bank',
    currency: 'EUR',
    symbol: '€',
    ...extra,
  };
}

describe('pickAccountChips', () => {
  it('takes the first five', () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((id) => account(id, `Bank ${id}`));
    expect(pickAccountChips(all, 1).map((entry) => entry.id)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('puts the profile’s cash account in place of the fifth', () => {
    const all = [
      ...[1, 2, 3, 4, 5].map((id) => account(id, `Bank ${id}`)),
      account(6, 'Max cash', { type: 'cash', ownerMemberId: 2 }),
      account(7, 'Wallet', { type: 'cash' }),
    ];
    expect(pickAccountChips(all, 1).map((entry) => entry.id)).toEqual([
      1, 2, 3, 4, 7,
    ]);
  });

  it('keeps a short list and a cash account already in it', () => {
    const all = [account(1, 'Wallet', { type: 'cash' }), account(2, 'Bank')];
    expect(pickAccountChips(all, 1)).toEqual(all);
    expect(pickAccountChips([], 1)).toEqual([]);
  });
});

describe('accountChipLabels', () => {
  it('names another profile’s account with its owner', () => {
    const labels = accountChipLabels(
      [account(1, 'DKB', { ownerMemberId: 2, ownerName: 'Max' })],
      1,
      'EUR',
    ).map((chip) => chip.label);
    expect(labels).toEqual(['Max · DKB']);
  });

  it('adds the symbol for a foreign currency or a clash', () => {
    const labels = accountChipLabels(
      [
        account(1, 'Cash', { type: 'cash' }),
        account(2, 'Cash', { type: 'cash', currency: 'USD', symbol: '$' }),
        account(3, 'Wise', { currency: 'USD', symbol: '$' }),
        account(4, 'Bank'),
      ],
      1,
      'EUR',
    ).map((chip) => chip.label);
    expect(labels).toEqual(['Cash €', 'Cash $', 'Wise $', 'Bank']);
  });

  it('compares names without case', () => {
    const labels = accountChipLabels(
      [
        account(1, 'cash'),
        account(2, 'Cash', { currency: 'USD', symbol: '$' }),
      ],
      1,
      'EUR',
    ).map((chip) => chip.label);
    expect(labels).toEqual(['cash €', 'Cash $']);
  });
});
