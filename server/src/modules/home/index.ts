import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { homeResponseSchema } from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { getHome } from '../../domain/home.js';

/** Registers the one call behind the Home screen (DSH-1, NTF-1, BKP-4). */
export const homeRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/home', async (request) => {
    const context = request.authContext!;
    return homeResponseSchema.parse(
      getHome(database, {
        memberId: context.memberId!,
        deviceId: context.deviceId,
        now: clock.now().getTime(),
      }),
    );
  });
};
