import { describe, expect, it } from 'vitest';
import {
  formatRateDate,
  formatUpdated,
} from '../src/screens/settings/ratesFormat';

const berlin = 'Europe/Berlin';

describe('formatUpdated', () => {
  it('names today and yesterday and prints the time in the family zone', () => {
    const sixBerlin = Date.parse('2026-10-09T04:00:00Z');
    expect(formatUpdated(sixBerlin, '2026-10-09', berlin)).toBe(
      'Updated today 06:00',
    );
    expect(formatUpdated(sixBerlin, '2026-10-10', berlin)).toBe(
      'Updated yesterday 06:00',
    );
    expect(formatUpdated(sixBerlin, '2026-10-12', berlin)).toBe(
      'Updated 09/10/2026 06:00',
    );
  });

  it('reads the local date, not the UTC one, around midnight', () => {
    const justAfterMidnight = Date.parse('2026-10-08T22:30:00Z');
    expect(formatUpdated(justAfterMidnight, '2026-10-09', berlin)).toBe(
      'Updated today 00:30',
    );
  });

  it('keeps the time zone offset through the autumn clock change', () => {
    const winter = Date.parse('2026-10-26T05:00:00Z');
    expect(formatUpdated(winter, '2026-10-26', berlin)).toBe(
      'Updated today 06:00',
    );
  });
});

describe('formatRateDate', () => {
  it('uses words for the last two days and the date after that', () => {
    expect(formatRateDate('2026-10-09', 0, berlin)).toBe('Today');
    expect(formatRateDate('2026-10-08', 1, berlin)).toBe('Yesterday');
    expect(formatRateDate('2026-10-06', 3, berlin)).toBe('06/10/2026');
  });
});
