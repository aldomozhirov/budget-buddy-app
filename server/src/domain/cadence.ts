import type Database from 'better-sqlite3';
import type { CadenceSetting } from '@budget-buddy/shared';

/** The cadence columns of the `family` row, as read from SQLite. */
export interface CadenceFields {
  cadenceKind: 'off' | 'monthly' | 'weeks';
  cadenceDayOfMonth: string | null;
  cadenceEveryWeeks: number | bigint | null;
  cadenceWeekday: number | bigint | null;
  cadenceTime: string | null;
}

/** The `family` columns that hold a cadence, named as in `CadenceFields`. */
export const cadenceSelect = `cadence_kind AS cadenceKind,
  cadence_day_of_month AS cadenceDayOfMonth,
  cadence_every_weeks AS cadenceEveryWeeks,
  cadence_weekday AS cadenceWeekday, cadence_time AS cadenceTime`;

/**
 * Reads the stored columns as a cadence. A row that is only partly filled in
 * (a kind without its day, weekday or time) counts as off, so nothing is
 * scheduled from half a setting.
 */
export function cadenceFromFields(fields: CadenceFields): CadenceSetting {
  const time = fields.cadenceTime;
  if (fields.cadenceKind === 'monthly' && time !== null) {
    const stored = fields.cadenceDayOfMonth;
    const day = stored === 'last' ? 'last' : Number(stored);
    if (stored !== null && (day === 'last' || Number.isInteger(day))) {
      return { kind: 'monthly', day, time };
    }
  }
  if (
    fields.cadenceKind === 'weeks' &&
    time !== null &&
    fields.cadenceEveryWeeks !== null &&
    fields.cadenceWeekday !== null
  ) {
    return {
      kind: 'weeks',
      every: Number(fields.cadenceEveryWeeks),
      weekday: Number(fields.cadenceWeekday),
      time,
    };
  }
  return { kind: 'off' };
}

/** The values for the cadence columns, in the order of `cadenceUpdate`. */
export function cadenceColumns(
  setting: CadenceSetting,
  anchorDate: string,
): [
  string,
  string | null,
  number | null,
  number | null,
  string | null,
  string | null,
] {
  if (setting.kind === 'monthly') {
    return ['monthly', String(setting.day), null, null, setting.time, null];
  }
  if (setting.kind === 'weeks') {
    return [
      'weeks',
      null,
      setting.every,
      setting.weekday,
      setting.time,
      anchorDate,
    ];
  }
  return ['off', null, null, null, null, null];
}

/** SQL that stores a cadence; bind the values from `cadenceColumns`. */
export const cadenceUpdate = `UPDATE family SET cadence_kind = ?,
  cadence_day_of_month = ?, cadence_every_weeks = ?, cadence_weekday = ?,
  cadence_time = ?, cadence_anchor_date = ? WHERE id = 1`;

/** Reads the family's cadence and the date "every N weeks" counts from. */
export function readCadence(database: Database.Database): {
  cadence: CadenceSetting;
  anchorDate: string | null;
} {
  const row = database
    .prepare(
      `SELECT ${cadenceSelect}, cadence_anchor_date AS anchorDate
      FROM family WHERE id = 1`,
    )
    .get() as (CadenceFields & { anchorDate: string | null }) | undefined;
  if (!row) return { cadence: { kind: 'off' }, anchorDate: null };
  return { cadence: cadenceFromFields(row), anchorDate: row.anchorDate };
}
