import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../src/db/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** The kinds of balance snapshot the summary tests write. */
export type SnapshotSource =
  'opening' | 'manual' | 'checkin' | 'carried_forward';

/** A migrated database with an Alex and Blair family, and writers for rows. */
export interface FamilyDatabase {
  database: Database.Database;
  /** Adds an account; returns its id. */
  account(input: {
    name: string;
    owner: 'Alex' | 'Blair' | null;
    type: 'bank' | 'cash' | 'investment' | 'crypto' | 'we_owe' | 'owed_to_us';
    currency: string;
    deactivatedAt?: number;
  }): number;
  /** Adds a check-in; closed ones are closed by Blair. Returns its id. */
  checkin(input: { openedAt: number; closedAt: number | null }): number;
  /** Adds a snapshot of an account, in minor units. */
  snapshot(input: {
    accountId: number;
    takenAt: number;
    amount: bigint;
    source: SnapshotSource;
    checkinId?: number;
  }): void;
  /** Stores a rate: `rate` units of `quote` per one `base` on `date`. */
  rate(base: string, quote: string, date: string, rate: string): void;
  close(): Promise<void>;
}

/**
 * Creates a migrated database in a temporary folder with a family whose common
 * currency is EUR, in Europe/Berlin, with members Alex (1) and Blair (2) and
 * the BTC coin (8 decimals).
 */
export async function createFamilyDatabase(
  commonCurrency = 'EUR',
): Promise<FamilyDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'budget-buddy-summary-'));
  const database = new Database(join(directory, 'family.sqlite'));
  database.pragma('foreign_keys = ON');
  await migrateDatabase(database, { backupDir: directory, migrationsFolder });
  database
    .prepare(
      `INSERT INTO family (id, password_hash, common_currency, time_zone,
        created_at) VALUES (1, 'x', ?, 'Europe/Berlin', 1)`,
    )
    .run(commonCurrency);
  for (const name of ['Alex', 'Blair']) {
    database
      .prepare('INSERT INTO member (name, created_at) VALUES (?, 1)')
      .run(name);
  }
  database
    .prepare(
      `INSERT OR IGNORE INTO coin (code, name, decimals, feed_id, created_at)
       VALUES ('BTC', 'Bitcoin', 8, 'coinbase', 1)`,
    )
    .run();
  const memberId = { Alex: 1, Blair: 2 };

  return {
    database,
    account({ name, owner, type, currency, deactivatedAt }) {
      return Number(
        database
          .prepare(
            `INSERT INTO account (name, owner_member_id, type, currency,
              active, deactivated_at, created_by, created_at, updated_by,
              updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`,
          )
          .run(
            name,
            owner === null ? null : memberId[owner],
            type,
            currency,
            deactivatedAt === undefined ? 1 : 0,
            deactivatedAt ?? null,
          ).lastInsertRowid,
      );
    },
    checkin({ openedAt, closedAt }) {
      return Number(
        database
          .prepare(
            `INSERT INTO checkin (opened_at, opened_by, closed_at, closed_by)
             VALUES (?, 1, ?, ?)`,
          )
          .run(openedAt, closedAt, closedAt === null ? null : 2)
          .lastInsertRowid,
      );
    },
    snapshot({ accountId, takenAt, amount, source, checkinId }) {
      database
        .prepare(
          `INSERT INTO snapshot (account_id, taken_at, amount, source,
            checkin_id, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?)`,
        )
        .run(
          accountId,
          takenAt,
          amount,
          source,
          checkinId ?? null,
          takenAt,
          takenAt,
        );
    },
    rate(base, quote, date, rate) {
      database
        .prepare(
          `INSERT INTO rate (base, quote, date, rate, source, fetched_at)
           VALUES (?, ?, ?, ?, 'test', 1)`,
        )
        .run(base, quote, date, rate);
    },
    async close() {
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
