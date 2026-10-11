import type { BackupStatusResponse } from '@budget-buddy/shared';
import { formatDayTime } from './ratesFormat.js';

/**
 * Writes a file size the way Finder does, in powers of 1000 with one decimal
 * above a kilobyte: "812 B", "4.2 KB", "4.2 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 999.95 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The look of the Backup row: the colour of its dot and its second line. */
export interface BackupRowView {
  tone: 'ok' | 'warn' | 'none';
  /** "Last today 03:30 · 4.2 MB · 14 daily, 12 monthly kept" (design). */
  text: string;
}

/**
 * Words the Backup row of Settings (UI-SET-1, BKP-4). A good night is the
 * design's line; a failed night turns the dot to the warning colour and says
 * so, naming the last good copy.
 */
export function describeBackupRow(status: BackupStatusResponse): BackupRowView {
  const { last, failure } = status;
  const kept = `${status.daily.limit} daily, ${status.monthly.limit} monthly kept`;
  const when = last
    ? formatDayTime(last.finishedAt, status.today, status.timeZone)
    : '';
  if (failure) {
    return {
      tone: 'warn',
      text: last
        ? `Last backup failed · last good one ${when}`
        : 'Last backup failed · none saved yet',
    };
  }
  if (!last) {
    return {
      tone: 'none',
      text: `No backup yet · runs every night at ${status.time}`,
    };
  }
  return {
    tone: 'ok',
    text: `Last ${when} · ${formatBytes(last.bytes)} · ${kept}`,
  };
}
