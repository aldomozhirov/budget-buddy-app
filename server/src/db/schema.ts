import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer as sqliteInteger,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * Snapshot of ISO 4217 codes used to generate a deterministic database CHECK.
 * The schema test compares it with the shared ISO table so additions cannot drift.
 */
const ISO_4217_CODES = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BOV',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHE',
  'CHF',
  'CHW',
  'CLF',
  'CLP',
  'CNY',
  'COP',
  'COU',
  'CRC',
  'CUC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MXV',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SLL',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'USN',
  'UYI',
  'UYU',
  'UYW',
  'UZS',
  'VED',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XCD',
  'XCG',
  'XDR',
  'XOF',
  'XPD',
  'XPF',
  'XPT',
  'XSU',
  'XTS',
  'XUA',
  'XXX',
  'YER',
  'ZAR',
  'ZMW',
  'ZWG',
  'ZWL',
] as const;

/** Maps safe SQLite integers to JS numbers while rejecting precision loss. */
const integer = customType<{
  data: number;
  driverData: bigint | number | string;
}>({
  dataType: () => 'integer',
  toDriver: (value) => value,
  fromDriver: (value) => {
    const exact = typeof value === 'bigint' ? value : BigInt(value);
    const number = Number(exact);
    if (!Number.isSafeInteger(number)) {
      throw new RangeError('Unsafe SQLite INTEGER read');
    }
    return number;
  },
});

const booleanInteger = sqliteInteger;

/** Amount columns stay SQLite INTEGER but are exposed as exact JavaScript BigInts. */
const moneyInteger = customType<{
  data: bigint;
  driverData: bigint | number | string;
}>({
  dataType: () => 'integer',
  toDriver: (value) => value,
  fromDriver: (value) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new RangeError(
        'Unsafe SQLite INTEGER read; select it as text to preserve precision',
      );
    }
    return BigInt(value);
  },
});

const isoCodesSql = sql.raw(
  ISO_4217_CODES.map((code) => `'${code}'`).join(', '),
);

/**
 * Selects an integer column through TEXT so a SQL expression preserves every
 * digit before conversion to BigInt. Use this for aggregates or casts too.
 */
export function exactMoneyInteger(column: AnySQLiteColumn | SQLWrapper) {
  return sql<bigint>`CAST(${column} AS TEXT)`.mapWith((value) =>
    BigInt(value as string),
  );
}

export const family = sqliteTable(
  'family',
  {
    id: integer('id').primaryKey(),
    passwordHash: text('password_hash').notNull(),
    passwordEpoch: integer('password_epoch').notNull().default(0),
    commonCurrency: text('common_currency').notNull().default('EUR'),
    timeZone: text('time_zone').notNull().default('Europe/Berlin'),
    cadenceKind: text('cadence_kind', { enum: ['off', 'monthly', 'weeks'] })
      .notNull()
      .default('off'),
    cadenceDayOfMonth: text('cadence_day_of_month'),
    cadenceEveryWeeks: integer('cadence_every_weeks'),
    cadenceWeekday: integer('cadence_weekday'),
    cadenceTime: text('cadence_time'),
    cadenceAnchorDate: text('cadence_anchor_date'),
    followupDays: integer('followup_days').notNull().default(2),
    failedSignins: integer('failed_signins').notNull().default(0),
    lockedUntil: integer('locked_until'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check('family_singleton_id_check', sql`${table.id} = 1`),
    check('family_password_epoch_check', sql`${table.passwordEpoch} >= 0`),
    check('family_followup_days_check', sql`${table.followupDays} >= 0`),
    check(
      'family_cadence_kind_check',
      sql`${table.cadenceKind} IN ('off', 'monthly', 'weeks')`,
    ),
    check(
      'family_cadence_day_check',
      sql`${table.cadenceDayOfMonth} IS NULL OR ${table.cadenceDayOfMonth} = 'last' OR (length(${table.cadenceDayOfMonth}) = 1 AND ${table.cadenceDayOfMonth} GLOB '[1-9]') OR (length(${table.cadenceDayOfMonth}) = 2 AND ${table.cadenceDayOfMonth} GLOB '[0-9][0-9]' AND ${table.cadenceDayOfMonth} BETWEEN '10' AND '28')`,
    ),
    check(
      'family_cadence_weeks_check',
      sql`${table.cadenceEveryWeeks} IS NULL OR ${table.cadenceEveryWeeks} BETWEEN 1 AND 8`,
    ),
    check(
      'family_cadence_weekday_check',
      sql`${table.cadenceWeekday} IS NULL OR ${table.cadenceWeekday} BETWEEN 1 AND 7`,
    ),
    check(
      'family_cadence_time_check',
      sql`${table.cadenceTime} IS NULL OR (${table.cadenceTime} GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(${table.cadenceTime}, 1, 2) <= '23')`,
    ),
  ],
);

export const member = sqliteTable(
  'member',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    active: booleanInteger('active', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: integer('created_at').notNull(),
    deactivatedAt: integer('deactivated_at'),
  },
  (table) => [
    uniqueIndex('member_active_name_unique')
      .on(sql`unicode_casefold(${table.name})`)
      .where(sql`${table.active} = 1`),
    check('member_active_boolean_check', sql`${table.active} IN (0, 1)`),
  ],
);

export const device = sqliteTable(
  'device',
  {
    id: text('id').primaryKey(),
    defaultMemberId: integer('default_member_id').references(() => member.id),
    hideHomeAmounts: booleanInteger('hide_home_amounts', { mode: 'boolean' })
      .notNull()
      .default(true),
    label: text('label'),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (table) => [
    check(
      'device_hide_home_amounts_boolean_check',
      sql`${table.hideHomeAmounts} IN (0, 1)`,
    ),
  ],
);

export const session = sqliteTable(
  'session',
  {
    id: integer('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    memberId: integer('member_id').references(() => member.id),
    passwordEpoch: integer('password_epoch').notNull(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    unique('session_token_hash_unique').on(table.tokenHash),
    index('session_device_idx').on(table.deviceId),
  ],
);

export const passkey = sqliteTable(
  'passkey',
  {
    id: integer('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [unique('passkey_credential_id_unique').on(table.credentialId)],
);

export const pushSubscription = sqliteTable(
  'push_subscription',
  {
    id: integer('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => member.id),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSuccessAt: integer('last_success_at'),
    failures: integer('failures').notNull().default(0),
  },
  (table) => [unique('push_subscription_endpoint_unique').on(table.endpoint)],
);

export const coin = sqliteTable(
  'coin',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    decimals: integer('decimals').notNull(),
    feedId: text('feed_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check('coin_decimals_check', sql`${table.decimals} BETWEEN 0 AND 8`),
    check(
      'coin_iso_code_check',
      sql`${table.code} COLLATE NOCASE NOT IN (${isoCodesSql})`,
    ),
  ],
);

export const account = sqliteTable(
  'account',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    ownerMemberId: integer('owner_member_id').references(() => member.id),
    type: text('type', {
      enum: ['bank', 'cash', 'investment', 'crypto', 'we_owe', 'owed_to_us'],
    }).notNull(),
    currency: text('currency').notNull(),
    active: booleanInteger('active', { mode: 'boolean' })
      .notNull()
      .default(true),
    deactivatedAt: integer('deactivated_at'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => member.id),
    createdAt: integer('created_at').notNull(),
    updatedBy: integer('updated_by')
      .notNull()
      .references(() => member.id),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check(
      'account_type_check',
      sql`${table.type} IN ('bank', 'cash', 'investment', 'crypto', 'we_owe', 'owed_to_us')`,
    ),
    check('account_active_boolean_check', sql`${table.active} IN (0, 1)`),
  ],
);

export const checkin = sqliteTable(
  'checkin',
  {
    id: integer('id').primaryKey(),
    openedAt: integer('opened_at').notNull(),
    openedBy: integer('opened_by').references(() => member.id),
    scheduleSlot: text('schedule_slot'),
    closedAt: integer('closed_at'),
    closedBy: integer('closed_by').references(() => member.id),
  },
  (table) => [
    unique('checkin_schedule_slot_unique').on(table.scheduleSlot),
    uniqueIndex('checkin_one_open_unique')
      .on(sql`1`)
      .where(sql`${table.closedAt} IS NULL`),
  ],
);

export const snapshot = sqliteTable(
  'snapshot',
  {
    id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => account.id),
    takenAt: integer('taken_at').notNull(),
    amount: moneyInteger('amount').notNull(),
    source: text('source', {
      enum: [
        'opening',
        'manual',
        'checkin',
        'carried_forward',
        'photo',
        'statement',
        'connector',
      ],
    }).notNull(),
    checkinId: integer('checkin_id').references(() => checkin.id),
    sourceRef: text('source_ref'),
    externalId: text('external_id'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => member.id),
    createdAt: integer('created_at').notNull(),
    updatedBy: integer('updated_by')
      .notNull()
      .references(() => member.id),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_checkin_account_unique')
      .on(table.checkinId, table.accountId)
      .where(sql`${table.checkinId} IS NOT NULL`),
    uniqueIndex('snapshot_source_external_unique')
      .on(table.sourceRef, table.externalId)
      .where(
        sql`${table.sourceRef} IS NOT NULL AND ${table.externalId} IS NOT NULL`,
      ),
    index('snapshot_account_taken_at_idx').on(
      table.accountId,
      sql`${table.takenAt} DESC`,
    ),
    check(
      'snapshot_source_check',
      sql`${table.source} IN ('opening', 'manual', 'checkin', 'carried_forward', 'photo', 'statement', 'connector')`,
    ),
    check(
      'snapshot_external_source_check',
      sql`${table.externalId} IS NULL OR ${table.sourceRef} IS NOT NULL`,
    ),
    check(
      'snapshot_carried_forward_check',
      sql`${table.source} != 'carried_forward' OR ${table.checkinId} IS NOT NULL`,
    ),
  ],
);

export const snapshotRevision = sqliteTable(
  'snapshot_revision',
  {
    id: integer('id').primaryKey(),
    snapshotId: integer('snapshot_id').notNull(),
    accountId: integer('account_id')
      .notNull()
      .references(() => account.id),
    action: text('action', { enum: ['update', 'delete'] }).notNull(),
    oldAmount: moneyInteger('old_amount').notNull(),
    oldTakenAt: integer('old_taken_at').notNull(),
    changedBy: integer('changed_by')
      .notNull()
      .references(() => member.id),
    changedAt: integer('changed_at').notNull(),
  },
  (table) => [
    check(
      'snapshot_revision_action_check',
      sql`${table.action} IN ('update', 'delete')`,
    ),
  ],
);

export const rate = sqliteTable(
  'rate',
  {
    id: integer('id').primaryKey(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    date: text('date').notNull(),
    rate: text('rate').notNull(),
    source: text('source').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (table) => [
    unique('rate_base_quote_date_unique').on(
      table.base,
      table.quote,
      table.date,
    ),
  ],
);

export const rateFetch = sqliteTable('rate_fetch', {
  id: integer('id').primaryKey(),
  feedId: text('feed_id').notNull(),
  date: text('date').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  at: integer('at').notNull(),
});

export const jobRun = sqliteTable(
  'job_run',
  {
    id: integer('id').primaryKey(),
    job: text('job').notNull(),
    slot: text('slot').notNull(),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    error: text('error'),
  },
  (table) => [
    unique('job_run_job_slot_unique').on(table.job, table.slot),
    check(
      'job_run_status_check',
      sql`${table.status} IN ('running', 'done', 'failed')`,
    ),
  ],
);

export const notification = sqliteTable(
  'notification',
  {
    id: integer('id').primaryKey(),
    event: text('event').notNull(),
    checkinId: integer('checkin_id')
      .notNull()
      .references(() => checkin.id),
    memberId: integer('member_id')
      .notNull()
      .references(() => member.id),
    slot: text('slot').notNull(),
    sentAt: integer('sent_at').notNull(),
  },
  (table) => [
    unique('notification_event_checkin_member_slot_unique').on(
      table.event,
      table.checkinId,
      table.memberId,
      table.slot,
    ),
  ],
);

export const backup = sqliteTable(
  'backup',
  {
    id: integer('id').primaryKey(),
    kind: text('kind', {
      enum: ['daily', 'monthly', 'pre_migration'],
    }).notNull(),
    path: text('path').notNull(),
    bytes: integer('bytes'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    status: text('status').notNull(),
    error: text('error'),
  },
  (table) => [
    check(
      'backup_kind_check',
      sql`${table.kind} IN ('daily', 'monthly', 'pre_migration')`,
    ),
    check(
      'backup_status_check',
      sql`${table.status} IN ('running', 'done', 'failed')`,
    ),
  ],
);
