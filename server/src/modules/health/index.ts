import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { migrationVersion } from '../../db/migrate.js';
import { appVersion } from '../../version.js';

/**
 * Reports app and migration health and the build's version and commit,
 * returning 503 whenever SQLite cannot be read.
 */
export const healthRoutes: FastifyPluginAsync<{
  database: Database.Database;
  /** Commit the copy was built from (`APP_COMMIT`). */
  appCommit: string;
}> = async (app, { database, appCommit }) => {
  app.get(
    '/api/health',
    { config: { auth: 'open' } },
    async (_request, reply) => {
      try {
        database.prepare('SELECT 1').get();
        return {
          status: 'ok',
          migrationVersion: migrationVersion(database),
          appVersion,
          commit: appCommit,
        };
      } catch {
        return reply.code(503).send({
          error: { code: 'unavailable', message: 'Database unavailable' },
        });
      }
    },
  );
};
