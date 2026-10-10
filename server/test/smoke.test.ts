import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('health route', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let database: Database.Database | undefined;
  let backupDir: string | undefined;

  afterEach(async () => {
    await app?.close();
    database?.close();
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
    app = undefined;
    database = undefined;
    backupDir = undefined;
  });

  it('reports the service status', async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    backupDir = await mkdtemp(join(tmpdir(), 'budget-buddy-health-'));
    await migrateDatabase(database, {
      backupDir,
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    app = await createApp({ database });
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      migrationVersion: 3,
    });
  });
});
