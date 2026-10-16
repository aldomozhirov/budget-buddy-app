import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  categorySuggestionsQuerySchema,
  categorySuggestionsResponseSchema,
  exchangeRate,
  merchantsQuerySchema,
  merchantsResponseSchema,
  ratePairQuerySchema,
  ratePairResponseSchema,
  todayInTimeZone,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { searchMerchants } from '../../domain/merchants.js';
import { suggestCategories } from '../../domain/suggestions.js';
import { createRateLookup } from '../../rates/lookup.js';

/**
 * Registers `GET /api/merchants`, `GET /api/suggestions/categories` and
 * `GET /api/rates/pair`, the lookups behind the Add form (UI-ADD-3, CAT-5,
 * UI-ADD-15; Design 3.6).
 */
export const suggestionRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/merchants', async (request, reply) => {
    const parsed = merchantsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidation(reply, 'Check the search.');
    return merchantsResponseSchema.parse({
      merchants: searchMerchants(database, parsed.data),
    });
  });

  app.get('/api/suggestions/categories', async (request, reply) => {
    const parsed = categorySuggestionsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidation(reply, 'Check the query.');
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return reply.code(403).send({
        error: { code: 'profile_required', message: 'Choose a profile first.' },
      });
    }
    const family = database
      .prepare('SELECT time_zone AS tz FROM family')
      .get() as { tz: string } | undefined;
    if (!family) throw new Error('The family has not been set up.');
    return categorySuggestionsResponseSchema.parse({
      categoryIds: suggestCategories(database, {
        ...parsed.data,
        memberId,
        timeZone: family.tz,
        today: todayInTimeZone(clock.now(), family.tz),
      }),
    });
  });

  app.get('/api/rates/pair', async (request, reply) => {
    const parsed = ratePairQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidation(reply, 'Check the query.');
    const { from, to, date } = parsed.data;
    return ratePairResponseSchema.parse({
      rate:
        from === to
          ? null
          : (exchangeRate(from, to, date, createRateLookup(database)) ?? null),
    });
  });
};

function sendValidation(reply: FastifyReply, message: string) {
  return reply
    .code(400)
    .send({ error: { code: 'validation', message, fields: {} } });
}
