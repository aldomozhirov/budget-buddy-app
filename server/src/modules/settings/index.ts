import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  listCurrencies,
  nextCadenceSlot,
  sameCadenceSetting,
  settingsResponseSchema,
  todayInTimeZone,
  updateSettingsRequestSchema,
  type CadenceSetting,
} from '@budget-buddy/shared';
import type { Clock } from '../../clock.js';
import { systemClock } from '../../clock.js';
import {
  cadenceColumns,
  cadenceUpdate,
  readCadence,
} from '../../domain/cadence.js';
import { settleSlotsUntil } from '../../jobs/checkinSchedule.js';
import { settleFollowUpsUntil } from '../../jobs/followUp.js';
import type { BackfillRequester } from '../../rates/service.js';

const supportedTimeZones = new Set([
  ...Intl.supportedValuesOf('timeZone'),
  'UTC',
]);

const settingsSelect =
  'SELECT common_currency, time_zone, followup_days FROM family WHERE id = 1';

type SettingsRow = {
  common_currency: string;
  time_zone: string;
  followup_days: number | bigint;
};

/** Registers family-wide money and time zone settings routes. */
export const settingsRoutes: FastifyPluginAsync<{
  database: Database.Database;
  rates?: BackfillRequester;
  clock?: Clock;
}> = async (app, { database, rates, clock = systemClock }) => {
  /** The response body: money settings, the cadence and its next slot. */
  function settingsBody(
    commonCurrency: string,
    timeZone: string,
    followupDays: number,
  ) {
    const { cadence, anchorDate } = readCadence(database);
    const now = clock.now();
    const next = nextCadenceSlot(
      cadence,
      anchorDate ?? todayInTimeZone(now, timeZone),
      now,
      timeZone,
    );
    return settingsResponseSchema.parse({
      commonCurrency,
      timeZone,
      cadence,
      nextSlot: next?.key ?? null,
      followupDays,
    });
  }

  app.get('/api/settings', async (_request, reply) => {
    const settings = database.prepare(settingsSelect).get() as
      SettingsRow | undefined;
    if (!settings) {
      return reply.code(403).send({
        error: {
          code: 'forbidden_state',
          message: 'First start has not been completed.',
        },
      });
    }
    return settingsBody(
      settings.common_currency,
      settings.time_zone,
      Number(settings.followup_days),
    );
  });

  app.patch('/api/settings', async (request, reply) => {
    const parsed = updateSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(reply, 'Check the settings.', parsed.error.issues);
    }

    const current = database.prepare(settingsSelect).get() as
      SettingsRow | undefined;
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

    const timeZone = parsed.data.timeZone ?? current.time_zone;
    const commonCurrency =
      parsed.data.commonCurrency ?? current.common_currency;
    const followupDays =
      parsed.data.followupDays ?? Number(current.followup_days);
    database.transaction(() => {
      database
        .prepare(
          `UPDATE family SET common_currency = ?, time_zone = ?,
            followup_days = ? WHERE id = 1`,
        )
        .run(commonCurrency, timeZone, followupDays);
      const cadenceChanged =
        parsed.data.cadence !== undefined &&
        saveCadence(parsed.data.cadence, timeZone);
      // Slot keys are local times, so a new zone starts counting from now,
      // whether or not the same request also sent a cadence.
      const zoneChanged = timeZone !== current.time_zone;
      if (cadenceChanged || zoneChanged) {
        settleSlotsUntil(database, clock.now(), timeZone);
      }
      // Reminders count from now too, so a new interval or zone never sends
      // one for a time that has passed.
      if (followupDays !== Number(current.followup_days) || zoneChanged) {
        settleFollowUpsUntil(database, clock.now(), timeZone);
      }
    })();

    // Every figure is converted into the common currency, so a new one needs
    // rates for the whole history.
    if (
      parsed.data.commonCurrency !== undefined &&
      parsed.data.commonCurrency !== current.common_currency
    ) {
      rates?.requestBackfill();
    }

    return settingsBody(commonCurrency, timeZone, followupDays);
  });

  /**
   * Stores a cadence that differs from the saved one and returns whether it
   * did. The caller settles the slots up to now, so the change moves the next
   * slot without opening a check-in for a past one. "Every N weeks" counts
   * from today.
   */
  function saveCadence(setting: CadenceSetting, timeZone: string): boolean {
    if (sameCadenceSetting(setting, readCadence(database).cadence))
      return false;
    database
      .prepare(cadenceUpdate)
      .run(...cadenceColumns(setting, todayInTimeZone(clock.now(), timeZone)));
    return true;
  }
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
