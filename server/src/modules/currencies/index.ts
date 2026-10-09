import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  coinCodeParamsSchema,
  coinResponseSchema,
  createCoinRequestSchema,
  currenciesResponseSchema,
  deleteCoinResponseSchema,
  getIsoCurrency,
  listCurrencies,
  updateCoinRequestSchema,
  type CoinSetting,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';

type StoredCoin = {
  code: string;
  name: string;
  decimals: number | bigint;
  feed_id: string;
};

/** Registers currency listing and coin management routes. */
export const currenciesRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/currencies', async () => {
    const storedCoins = readStoredCoins(database);
    const usedCodes = readUsedCurrencyCodes(database);
    const coins = storedCoins.map((coin) => toCoinSetting(coin, usedCodes));
    return currenciesResponseSchema.parse({
      currencies: listCurrencies(coins),
      coins,
    });
  });

  app.post('/api/coins', async (request, reply) => {
    const parsed = createCoinRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the coin details.',
        parsed.error.issues,
      );
    }
    if (getIsoCurrency(parsed.data.code)) {
      return sendValidation(
        reply,
        'A coin code cannot match an ISO currency.',
        [
          {
            path: ['code'],
            message: 'Use a code that is not an ISO currency.',
          },
        ],
      );
    }

    try {
      database
        .prepare(
          'INSERT INTO coin (code, name, decimals, feed_id, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          parsed.data.code,
          parsed.data.name,
          parsed.data.decimals,
          `${parsed.data.code}-EUR`,
          clock.now().getTime(),
        );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return sendCoinConflict(reply, 'A coin with that code already exists.');
      }
      throw error;
    }

    return reply.code(201).send(
      coinResponseSchema.parse({
        coin: toCoinSetting(
          readCoin(database, parsed.data.code)!,
          readUsedCurrencyCodes(database),
        ),
      }),
    );
  });

  app.patch('/api/coins/:code', async (request, reply) => {
    const parsedParams = coinCodeParamsSchema.safeParse(request.params);
    const parsedBody = updateCoinRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      const issues = [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues),
      ];
      return sendValidation(reply, 'Check the coin details.', issues);
    }

    const oldCode = parsedParams.data.code;
    const current = readCoin(database, oldCode);
    if (!current) return sendCoinNotFound(reply);

    const nextCode = parsedBody.data.code ?? oldCode;
    const nextName = parsedBody.data.name ?? current.name;
    const nextDecimals = parsedBody.data.decimals ?? Number(current.decimals);
    const usedCodes = readUsedCurrencyCodes(database);
    const inUse = usedCodes.has(oldCode);

    if (getIsoCurrency(nextCode)) {
      return sendValidation(
        reply,
        'A coin code cannot match an ISO currency.',
        [
          {
            path: ['code'],
            message: 'Use a code that is not an ISO currency.',
          },
        ],
      );
    }
    if (
      inUse &&
      (nextCode !== oldCode || nextDecimals !== Number(current.decimals))
    ) {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message: 'Code and decimals cannot change while a coin is in use.',
        },
      });
    }

    try {
      database
        .prepare(
          'UPDATE coin SET code = ?, name = ?, decimals = ?, feed_id = ? WHERE code = ?',
        )
        .run(
          nextCode,
          nextName,
          nextDecimals,
          nextCode === oldCode ? current.feed_id : `${nextCode}-EUR`,
          oldCode,
        );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return sendCoinConflict(reply, 'A coin with that code already exists.');
      }
      throw error;
    }

    return coinResponseSchema.parse({
      coin: toCoinSetting(
        readCoin(database, nextCode)!,
        readUsedCurrencyCodes(database),
      ),
    });
  });

  app.delete('/api/coins/:code', async (request, reply) => {
    const parsedParams = coinCodeParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidation(reply, 'Choose a coin.', parsedParams.error.issues);
    }

    const code = parsedParams.data.code;
    if (!readCoin(database, code)) return sendCoinNotFound(reply);
    if (readUsedCurrencyCodes(database).has(code)) {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message: 'This coin is in use and cannot be deleted.',
        },
      });
    }

    database.prepare('DELETE FROM coin WHERE code = ?').run(code);
    return deleteCoinResponseSchema.parse({ deleted: true });
  });
};

function readStoredCoins(database: Database.Database): StoredCoin[] {
  return database
    .prepare('SELECT code, name, decimals, feed_id FROM coin ORDER BY code')
    .all() as StoredCoin[];
}

function readCoin(
  database: Database.Database,
  code: string,
): StoredCoin | undefined {
  return database
    .prepare('SELECT code, name, decimals, feed_id FROM coin WHERE code = ?')
    .get(code) as StoredCoin | undefined;
}

function readUsedCurrencyCodes(database: Database.Database): Set<string> {
  const codes = new Set(
    (
      database.prepare('SELECT DISTINCT currency FROM account').all() as Array<{
        currency: string;
      }>
    ).map(({ currency }) => currency.toUpperCase()),
  );
  const family = database
    .prepare('SELECT common_currency FROM family WHERE id = 1')
    .get() as { common_currency: string } | undefined;
  if (family) codes.add(family.common_currency.toUpperCase());
  return codes;
}

function toCoinSetting(
  coin: StoredCoin,
  usedCodes: ReadonlySet<string>,
): CoinSetting {
  return {
    code: coin.code,
    name: coin.name,
    decimals: Number(coin.decimals),
    inUse: usedCodes.has(coin.code.toUpperCase()),
  };
}

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

function sendCoinConflict(reply: FastifyReply, message: string) {
  return reply.code(409).send({
    error: { code: 'conflict', message, fields: { code: message } },
  });
}

function sendCoinNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'Coin not found.' },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      error.code === 'SQLITE_CONSTRAINT_UNIQUE')
  );
}
