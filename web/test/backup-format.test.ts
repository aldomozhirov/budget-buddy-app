import { describe, expect, it } from 'vitest';
import type { BackupStatusResponse } from '@budget-buddy/shared';
import {
  describeBackupRow,
  formatBytes,
} from '../src/screens/settings/backupFormat';

const status = (
  patch: Partial<BackupStatusResponse>,
): BackupStatusResponse => ({
  today: '2026-10-11',
  timeZone: 'Europe/Berlin',
  time: '03:30',
  last: { finishedAt: Date.parse('2026-10-11T01:30:00Z'), bytes: 4_200_000 },
  failure: null,
  daily: { kept: 5, limit: 14 },
  monthly: { kept: 2, limit: 12 },
  ...patch,
});

describe('formatBytes', () => {
  it('uses powers of 1000 and one decimal above a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(163_840)).toBe('163.8 KB');
    expect(formatBytes(4_200_000)).toBe('4.2 MB');
    expect(formatBytes(999_990)).toBe('1.0 MB');
    expect(formatBytes(3_500_000_000)).toBe('3.5 GB');
  });
});

describe('describeBackupRow', () => {
  it('is the design line after a good night', () => {
    expect(describeBackupRow(status({}))).toEqual({
      tone: 'ok',
      text: 'Last today 03:30 · 4.2 MB · 14 daily, 12 monthly kept',
    });
  });

  it('names yesterday and older dates', () => {
    const last = { finishedAt: Date.parse('2026-10-10T01:30:00Z'), bytes: 800 };
    expect(describeBackupRow(status({ last })).text).toContain(
      'Last yesterday 03:30 · 800 B',
    );
    expect(
      describeBackupRow(status({ last, today: '2026-10-13' })).text,
    ).toContain('Last 10/10/2026 03:30');
  });

  it('says there is no backup yet, and when the first runs', () => {
    expect(describeBackupRow(status({ last: null }))).toEqual({
      tone: 'none',
      text: 'No backup yet · runs every night at 03:30',
    });
  });

  it('warns after a failed night and names the last good copy', () => {
    const failure = { at: Date.parse('2026-10-11T01:31:00Z'), message: 'x' };
    expect(
      describeBackupRow(
        status({
          failure,
          last: { finishedAt: Date.parse('2026-10-10T01:30:00Z'), bytes: 1 },
        }),
      ),
    ).toEqual({
      tone: 'warn',
      text: 'Last backup failed · last good one yesterday 03:30',
    });
    expect(describeBackupRow(status({ failure, last: null }))).toEqual({
      tone: 'warn',
      text: 'Last backup failed · none saved yet',
    });
  });
});
