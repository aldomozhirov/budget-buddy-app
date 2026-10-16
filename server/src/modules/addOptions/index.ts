import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  addOptionsResponseSchema,
  todayInTimeZone,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import {
  KNOWN_MERCHANT_LIMIT,
  knownMerchants,
} from '../../domain/merchants.js';
import { loadRules } from '../../domain/rules.js';
import { orderCategories, orderedAccounts } from '../../domain/suggestions.js';

/** Registers `GET /api/add-options` (Design 4; D3, TXN-7). */
export const addOptionsRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/add-options', async (request, reply) => {
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return reply.code(403).send({
        error: { code: 'profile_required', message: 'Choose a profile first.' },
      });
    }
    const family = database
      .prepare('SELECT common_currency AS cc, time_zone AS tz FROM family')
      .get() as { cc: string; tz: string } | undefined;
    if (!family) throw new Error('The family has not been set up.');
    const context = {
      memberId,
      timeZone: family.tz,
      today: todayInTimeZone(clock.now(), family.tz),
    };

    const categories = new Map(
      (
        database
          .prepare(
            `SELECT c.id, c.name, c.kind,
                    CASE WHEN e.archived_at IS NULL THEN e.id END AS envelopeId
               FROM category c
               LEFT JOIN envelope e ON e.id = c.default_envelope_id
              WHERE c.archived_at IS NULL`,
          )
          .all() as {
          id: bigint;
          name: string;
          kind: 'expense' | 'income';
          envelopeId: bigint | null;
        }[]
      ).map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          name: row.name,
          kind: row.kind,
          defaultEnvelopeId:
            row.envelopeId === null ? null : Number(row.envelopeId),
        },
      ]),
    );

    return addOptionsResponseSchema.parse({
      profileId: memberId,
      profiles: (
        database
          .prepare('SELECT id, name FROM member WHERE active = 1 ORDER BY id')
          .all() as { id: bigint; name: string }[]
      ).map((row) => ({ id: Number(row.id), name: row.name })),
      accounts: orderedAccounts(database, context),
      categories: orderCategories(database, context).map((id) =>
        categories.get(id),
      ),
      envelopes: (
        database
          .prepare(
            `SELECT e.id, e.name, e.currency,
                    CASE WHEN c.archived_at IS NULL AND c.kind = 'expense'
                         THEN c.id END AS categoryId
               FROM envelope e
               LEFT JOIN category c ON c.id = e.default_category_id
              WHERE e.archived_at IS NULL ORDER BY e.position, e.id`,
          )
          .all() as {
          id: bigint;
          name: string;
          currency: string;
          categoryId: bigint | null;
        }[]
      ).map((row) => ({
        id: Number(row.id),
        name: row.name,
        currency: row.currency,
        defaultCategoryId:
          row.categoryId === null ? null : Number(row.categoryId),
      })),
      rules: loadRules(database),
      merchants: knownMerchants(database, { limit: KNOWN_MERCHANT_LIMIT }).map(
        ({ merchant, key }) => ({ merchant, key }),
      ),
      commonCurrency: family.cc,
      timeZone: family.tz,
    });
  });
};
