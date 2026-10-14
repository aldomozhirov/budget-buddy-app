import type Database from 'better-sqlite3';
import { strToU8, zipSync } from 'fflate';
import { toCsv } from './csv.js';
import { exportFiles, headerOf, readRows } from './files.js';

/**
 * Builds the zip of CSV files for "Export all data" (BKP-3): members,
 * accounts, snapshots, snapshot revisions, check-ins, categories, envelopes,
 * transactions, rules, rates, coins and settings, without any password
 * hash, session, passkey or push data (SEC-6). All files are read in one
 * transaction, so they agree with each other even while the app is being
 * used. Text is UTF-8.
 * @param now Modification time stamped on each file in the zip.
 */
export function buildExportArchive(
  database: Database.Database,
  now: Date,
): Uint8Array {
  const read = database.transaction(() =>
    exportFiles.map((file) => ({
      name: file.name,
      csv: toCsv(headerOf(file), readRows(database, file)),
    })),
  );
  const files: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const { name, csv } of read.deferred()) {
    files[name] = [strToU8(csv), { mtime: now }];
  }
  return zipSync(files, { level: 6 });
}
