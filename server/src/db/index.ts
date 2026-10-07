import { mkdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import { systemClock, type Clock } from '../clock.js';
import { migrateDatabase } from './migrate.js';

export async function openDatabase(
  config: AppConfig,
  clock: Clock = systemClock,
): Promise<Database.Database> {
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.backupDir, { recursive: true });
  const database = new Database(config.databasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, { backupDir: config.backupDir, clock });
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
