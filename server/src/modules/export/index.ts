import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { todayInTimeZone } from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { buildExportArchive } from '../../export/archive.js';

/**
 * Registers `GET /api/export` (BKP-3): the zip of CSV files, for a signed-in
 * member with a profile like every other route. The archive is built in
 * memory, since a family's data is small, and is never cached.
 */
export const exportRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const clock = options.clock ?? systemClock;

  app.get('/api/export', async (_request, reply) => {
    const now = clock.now();
    const family = options.database
      .prepare('SELECT time_zone FROM family WHERE id = 1')
      .get() as { time_zone: string } | undefined;
    const date = todayInTimeZone(now, family?.time_zone ?? 'UTC');
    const archive = buildExportArchive(options.database, now);
    return reply
      .type('application/zip')
      .header(
        'content-disposition',
        `attachment; filename="budget-buddy-export-${date}.zip"`,
      )
      .header('cache-control', 'no-store')
      .send(Buffer.from(archive));
  });
};
