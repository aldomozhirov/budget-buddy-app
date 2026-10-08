import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { migrationVersion } from '../../db/migrate.js';

/** Reports app and migration health, returning 503 whenever SQLite cannot be read. */
export const healthRoutes: FastifyPluginAsync<{
  database: Database.Database;
}> = async (app, { database }) => {
  app.get('/api/health', async (_request, reply) => {
    try {
      database.prepare('SELECT 1').get();
      return {
        status: 'ok',
        migrationVersion: migrationVersion(database),
        appVersion: '0.1.0',
      };
    } catch {
      return reply.code(503).send({
        error: { code: 'unavailable', message: 'Database unavailable' },
      });
    }
  });
};
