import { describe, expect, it } from 'vitest';
import type { HomeResponse } from '@budget-buddy/shared';
import { createMoneyFormatter } from '../src/screens/summary/summaryFormat';
import { wishesCardLines } from '../src/screens/home/wishesCard';

const formatter = createMoneyFormatter([]);
const card: HomeResponse['wishes'] = {
  open: 2,
  wished: '83000',
  spent: '12000',
  incomplete: false,
  items: [
    {
      id: 1,
      name: 'Salzburg',
      currency: 'EUR',
      amount: '35000',
      spent: '12000',
    },
    { id: 2, name: 'Tyres', currency: 'EUR', amount: '48000', spent: '0' },
  ],
};

describe('wishesCardLines', () => {
  it('shows amounts when revealed', () => {
    const lines = wishesCardLines(card, true, 'EUR', formatter);
    expect(lines.figure).toBe('€120.00');
    expect(lines.caption).toBe('spent of €830.00 wished');
    expect(lines.rows.map((row) => row.text)).toEqual([
      '€120.00 of €350.00',
      'Nothing spent yet',
    ]);
    expect(lines.footer).toBe('2 open this month · see all wishes');
    expect(lines.empty).toBe(false);
  });

  it('shows no digit of an amount when hidden', () => {
    const lines = wishesCardLines(card, false, 'EUR', formatter);
    expect(lines.figure).toBe('€ • • • •');
    expect(lines.caption).toBe('spent on wishes');
    expect(lines.rows.map((row) => row.text)).toEqual([
      '34% spent',
      'Nothing spent yet',
    ]);
    expect(lines.rows[0]?.share).toBe(34);
  });

  it('marks a total that leaves a currency out', () => {
    const lines = wishesCardLines(
      { ...card, incomplete: true },
      true,
      'EUR',
      formatter,
    );
    expect(lines.caption).toBe('spent of €830.00 wished · Rate missing');
  });

  it('says over budget past the amount, hidden', () => {
    const over = {
      ...card,
      items: [{ ...card.items[0]!, spent: '40000' }],
    };
    const lines = wishesCardLines(over, false, 'EUR', formatter);
    expect(lines.rows[0]).toMatchObject({ text: 'Over budget', over: true });
    expect(lines.rows[0]?.share).toBe(100);
  });

  it('has an empty state that plans a wish', () => {
    const none = {
      open: 0,
      wished: null,
      spent: null,
      incomplete: false,
      items: [],
    };
    const lines = wishesCardLines(none, true, 'EUR', formatter);
    expect(lines.empty).toBe(true);
    expect(lines.footer).toBe('Plan a wish');
    expect(lines.rows).toEqual([]);
  });
});
