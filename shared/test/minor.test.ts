import { expect, it } from 'vitest';
import { parseMinor } from '../src/money/minor.js';

it('reports overlong integer amounts outside SQLite range as too large', () => {
  expect(() => parseMinor('9'.repeat(20))).toThrow('Amount is too large');
});
