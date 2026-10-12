import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';
import { systemClock, type Clock } from '../clock.js';
import { migrateDatabase } from './migrate.js';

/**
 * Fails with a plain reason when the app's user cannot write a folder. SQLite
 * would only say "unable to open database file", which hides a mounted folder
 * that belongs to another user.
 * @throws {Error} naming the folder and the user the app runs as.
 */
async function requireWritable(folder: string, what: string): Promise<void> {
  try {
    await access(folder, constants.W_OK);
  } catch {
    const user = `${process.getuid?.() ?? '?'}:${process.getgid?.() ?? '?'}`;
    throw new Error(
      `The ${what} folder ${folder} cannot be written by the app (running as user ${user}). Give that user write access to it; with docker compose, set BB_UID and BB_GID in .env to the owner of the folder (README, First install).`,
    );
  }
}

/**
 * Opens the configured database, enables WAL and foreign-key enforcement, then
 * applies pending migrations before exposing the connection to the app.
 * The connection is closed again if startup migration fails.
 */
export async function openDatabase(
  config: AppConfig,
  clock: Clock = systemClock,
): Promise<Database.Database> {
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.backupDir, { recursive: true });
  await requireWritable(config.dataDir, 'data');
  await requireWritable(config.backupDir, 'backups');
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
