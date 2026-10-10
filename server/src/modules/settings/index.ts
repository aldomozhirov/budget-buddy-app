import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  listCurrencies,
  settingsResponseSchema,
  updateSettingsRequestSchema,
} from '@budget-buddy/shared';
import type { BackfillRequester } from '../../rates/service.js';

const supportedTimeZones = new Set([
  ...Intl.supportedValuesOf('timeZone'),
  'UTC',
]);

/** Registers family-wide money and time zone settings routes. */
export const settingsRoutes: FastifyPluginAsync<{
  database: Database.Database;
  rates?: BackfillRequester;
}> = async (app, { database, rates }) => {
  app.get('/api/settings', async (_request, reply) => {
    const settings = database
      .prepare('SELECT common_currency, time_zone FROM family WHERE id = 1')
      .get() as { common_currency: string; time_zone: string } | undefined;
    if (!settings) {
      return reply.code(403).send({
        error: {
          code: 'forbidden_state',
          message: 'First start has not been completed.',
        },
      });
    }
    return settingsResponseSchema.parse({
      commonCurrency: settings.common_currency,
      timeZone: settings.time_zone,
    });
  });

  app.patch('/api/settings', async (request, reply) => {
    const parsed = updateSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the money settings.',
        parsed.error.issues,
      );
    }

    const current = database
      .prepare('SELECT common_currency, time_zone FROM family WHERE id = 1')
      .get() as { common_currency: string; time_zone: string } | undefined;
    if (!current) {
      return reply.code(403).send({
        error: {
          code: 'forbidden_state',
          message: 'First start has not been completed.',
        },
      });
    }

    if (parsed.data.commonCurrency !== undefined) {
      const coins = database
        .prepare('SELECT code, name, decimals FROM coin ORDER BY code')
        .all() as Array<{
        code: string;
        name: string;
        decimals: number | bigint;
      }>;
      const accountCodes = new Set(
        (
          database
            .prepare('SELECT DISTINCT currency FROM account')
            .all() as Array<{
            currency: string;
          }>
        ).map(({ currency }) => currency.toUpperCase()),
      );
      accountCodes.add(current.common_currency.toUpperCase());
      const selectableCurrencies = listCurrencies(
        coins
          .filter((coin) => accountCodes.has(coin.code.toUpperCase()))
          .map(({ code, name, decimals }) => ({
            code,
            name,
            decimals: Number(decimals),
          })),
      );
      if (
        !selectableCurrencies.some(
          ({ code }) => code === parsed.data.commonCurrency,
        )
      ) {
        return sendValidation(reply, 'Choose an available currency.', [
          {
            path: ['commonCurrency'],
            message: 'Choose an ISO currency or a coin in use.',
          },
        ]);
      }
    }

    if (
      parsed.data.timeZone !== undefined &&
      !supportedTimeZones.has(parsed.data.timeZone)
    ) {
      return sendValidation(reply, 'Choose a supported time zone.', [
        { path: ['timeZone'], message: 'Choose a time zone from the list.' },
      ]);
    }

    database
      .prepare(
        'UPDATE family SET common_currency = ?, time_zone = ? WHERE id = 1',
      )
      .run(
        parsed.data.commonCurrency ?? current.common_currency,
        parsed.data.timeZone ?? current.time_zone,
      );

    // Every figure is converted into the common currency, so a new one needs
    // rates for the whole history.
    if (
      parsed.data.commonCurrency !== undefined &&
      parsed.data.commonCurrency !== current.common_currency
    ) {
      rates?.requestBackfill();
    }

    return settingsResponseSchema.parse({
      commonCurrency: parsed.data.commonCurrency ?? current.common_currency,
      timeZone: parsed.data.timeZone ?? current.time_zone,
    });
  });
};

function sendValidation(
  reply: FastifyReply,
  message: string,
  issues: readonly { path: PropertyKey[]; message: string }[],
) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    fields[field] ??= issue.message;
  }
  return reply.code(400).send({
    error: { code: 'validation', message, fields },
  });
}
