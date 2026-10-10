import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  accountIdParamsSchema,
  accountResponseSchema,
  accountsQuerySchema,
  accountsResponseSchema,
  changeAccountCurrencyRequestSchema,
  createAccountRequestSchema,
  currencyRelabelResponseSchema,
  deleteAccountResponseSchema,
  endOfLocalDay,
  getCurrency,
  isMinorInRange,
  parseMinor,
  roundHalfAwayFromZero,
  todayInTimeZone,
  toMinorString,
  updateAccountRequestSchema,
  type Currency,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import type { BackfillRequester } from '../../rates/service.js';
import { balanceAt, type AccountBalance } from '../../domain/balance.js';

/** Registers account listing, maintenance, balance and currency routes. */
export const accountRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
  rates?: BackfillRequester;
}> = async (app, options) => {
  const { database, rates } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/accounts', async (request, reply) => {
    const parsed = accountsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the account filters.',
        parsed.error.issues,
      );
    }
    const filters = parsed.data;
    const accounts = balanceAt(database, clock.now().getTime(), {
      ...(filters.owner === undefined ? {} : { owner: filters.owner }),
      ...(filters.type === undefined ? {} : { type: filters.type }),
      ...(filters.currency === undefined ? {} : { currency: filters.currency }),
      includeInactive: filters.inactive === 'true',
    });
    return accountsResponseSchema.parse({
      accounts: accounts.map(toAccountResponse),
    });
  });

  app.post('/api/accounts', async (request, reply) => {
    const parsed = createAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the account details.',
        parsed.error.issues,
      );
    }
    const { name, ownerMemberId, type, currency, openingBalance, openingDate } =
      parsed.data;
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    if (openingDate !== undefined && openingBalance === undefined) {
      return sendValidation(
        reply,
        'Add an opening balance or remove its date.',
        [{ path: ['openingDate'], message: 'Add an opening balance first.' }],
      );
    }
    const currencyInfo = lookupCurrency(database, currency);
    if (!currencyInfo) {
      return sendValidation(reply, 'Choose a currency from the list.', [
        {
          path: ['currency'],
          message: 'Choose an ISO currency or a coin in Settings.',
        },
      ]);
    }
    if (
      ownerMemberId !== undefined &&
      ownerMemberId !== null &&
      !memberExists(database, ownerMemberId)
    ) {
      return sendValidation(reply, 'Choose an existing profile.', [
        { path: ['ownerMemberId'], message: 'Choose an existing profile.' },
      ]);
    }

    let openingAmount: bigint | undefined;
    if (openingBalance !== undefined) {
      try {
        openingAmount = parseMinor(openingBalance);
      } catch (error) {
        const tooLarge =
          error instanceof RangeError &&
          error.message === 'Amount is too large';
        return sendValidation(
          reply,
          tooLarge
            ? 'Amount is too large'
            : 'Enter a whole amount in minor units.',
          [
            {
              path: ['openingBalance'],
              message: tooLarge
                ? 'Amount is too large'
                : 'Enter a valid amount.',
            },
          ],
        );
      }
    }
    const now = clock.now().getTime();
    const takenAt =
      openingAmount === undefined
        ? undefined
        : snapshotInstant(database, openingDate, now);
    if (takenAt === null) {
      return sendValidation(reply, 'Choose today or an earlier date.', [
        {
          path: ['openingDate'],
          message: 'A balance date cannot be in the future.',
        },
      ]);
    }

    const result = database.transaction(() => {
      const insert = database
        .prepare(
          `INSERT INTO account
             (name, owner_member_id, type, currency, created_by, created_at,
              updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          ownerMemberId ?? null,
          type,
          currencyInfo.code,
          memberId,
          now,
          memberId,
          now,
        );
      const accountId = Number(insert.lastInsertRowid);
      if (openingAmount !== undefined && takenAt !== undefined) {
        database
          .prepare(
            `INSERT INTO snapshot
               (account_id, taken_at, amount, source, created_by, created_at,
                updated_by, updated_at)
             VALUES (?, ?, ?, 'opening', ?, ?, ?, ?)`,
          )
          .run(accountId, takenAt, openingAmount, memberId, now, memberId, now);
      }
      return accountId;
    })();
    const account = findAccount(database, result, clock.now().getTime(), true);
    if (!account) throw new Error('Created account could not be reloaded.');
    rates?.requestBackfill();
    return reply.code(201).send(accountResponseSchema.parse({ account }));
  });

  app.get('/api/accounts/:id', async (request, reply) => {
    const parsed = accountIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Check the account.', [
        { path: ['id'], message: 'Choose an account.' },
      ]);
    const account = findAccount(
      database,
      parsed.data.id,
      clock.now().getTime(),
      true,
    );
    if (!account) return sendNotFound(reply, 'Account not found.');
    return accountResponseSchema.parse({ account });
  });

  app.patch('/api/accounts/:id', async (request, reply) => {
    const parsedParams = accountIdParamsSchema.safeParse(request.params);
    const parsedBody = updateAccountRequestSchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return sendValidation(reply, 'Check the account details.', [
        ...(!parsedParams.success
          ? [{ path: ['id'], message: 'Choose an account.' }]
          : []),
        ...(!parsedBody.success ? parsedBody.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const { id } = parsedParams.data;
    const { name, ownerMemberId, type } = parsedBody.data;
    if (
      ownerMemberId !== undefined &&
      ownerMemberId !== null &&
      !memberExists(database, ownerMemberId)
    ) {
      return sendValidation(reply, 'Choose an existing profile.', [
        { path: ['ownerMemberId'], message: 'Choose an existing profile.' },
      ]);
    }
    const now = clock.now().getTime();
    const result = database
      .prepare(
        `UPDATE account
         SET name = COALESCE(?, name),
             owner_member_id = CASE WHEN ? = 1 THEN ? ELSE owner_member_id END,
             type = COALESCE(?, type), updated_by = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name ?? null,
        ownerMemberId === undefined ? 0 : 1,
        ownerMemberId ?? null,
        type ?? null,
        memberId,
        now,
        id,
      );
    if (result.changes === 0) return sendNotFound(reply, 'Account not found.');
    const account = findAccount(database, id, now, true);
    if (!account) return sendNotFound(reply, 'Account not found.');
    return accountResponseSchema.parse({ account });
  });

  app.delete('/api/accounts/:id', async (request, reply) => {
    const parsed = accountIdParamsSchema.safeParse(request.params);
    if (!parsed.success)
      return sendValidation(reply, 'Check the account.', [
        { path: ['id'], message: 'Choose an account.' },
      ]);
    const result = database.transaction(() => {
      const exists = database
        .prepare('SELECT id FROM account WHERE id = ?')
        .get(parsed.data.id);
      if (!exists) return 'not_found' as const;
      const snapshots = database
        .prepare('SELECT 1 AS found FROM snapshot WHERE account_id = ? LIMIT 1')
        .get(parsed.data.id);
      if (snapshots) return 'has_history' as const;
      database
        .prepare('DELETE FROM snapshot_revision WHERE account_id = ?')
        .run(parsed.data.id);
      database.prepare('DELETE FROM account WHERE id = ?').run(parsed.data.id);
      return 'deleted' as const;
    })();
    if (result === 'not_found')
      return sendNotFound(reply, 'Account not found.');
    if (result === 'has_history') {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message: 'An account with balance history cannot be deleted.',
        },
      });
    }
    return deleteAccountResponseSchema.parse({ deleted: true });
  });

  app.post('/api/accounts/:id/currency', async (request, reply) => {
    const parsedParams = accountIdParamsSchema.safeParse(request.params);
    const parsedBody = changeAccountCurrencyRequestSchema.safeParse(
      request.body,
    );
    if (!parsedParams.success || !parsedBody.success) {
      return sendValidation(reply, 'Check the currency change.', [
        ...(!parsedParams.success
          ? [{ path: ['id'], message: 'Choose an account.' }]
          : []),
        ...(!parsedBody.success ? parsedBody.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined)
      return sendProfileRequired(reply);
    const existing = database
      .prepare('SELECT currency FROM account WHERE id = ?')
      .get(parsedParams.data.id) as { currency: string } | undefined;
    if (!existing) return sendNotFound(reply, 'Account not found.');
    const target = lookupCurrency(database, parsedBody.data.currency);
    if (!target) {
      return sendValidation(reply, 'Choose a currency from the list.', [
        {
          path: ['currency'],
          message: 'Choose an ISO currency or a coin in Settings.',
        },
      ]);
    }
    const source = lookupCurrency(database, existing.currency);
    if (!source)
      throw new Error(`Unknown stored currency ${existing.currency}.`);
    const now = clock.now().getTime();
    let preview: CurrencyRelabelPreview;
    try {
      preview = makeCurrencyRelabelPreview(
        database,
        parsedParams.data.id,
        source,
        target,
      );
    } catch {
      return sendValidation(
        reply,
        'The new currency would make a stored amount too large.',
        [
          {
            path: ['currency'],
            message: 'The amount would be too large in that currency.',
          },
        ],
      );
    }
    if (source.code === target.code) {
      return currencyRelabelResponseSchema.parse({
        ...preview.response,
        requiresConfirmation: false,
      });
    }
    if (parsedBody.data.confirm !== true) {
      return currencyRelabelResponseSchema.parse({
        ...preview.response,
        requiresConfirmation: true,
      });
    }
    const updated = database.transaction(() => {
      const current = database
        .prepare('SELECT currency FROM account WHERE id = ?')
        .get(parsedParams.data.id) as { currency: string } | undefined;
      if (!current) return false;
      if (current.currency !== source.code) return false;
      const snapshots = database
        .prepare(
          'SELECT id, amount FROM snapshot WHERE account_id = ? ORDER BY id',
        )
        .all(parsedParams.data.id) as Array<{ id: bigint; amount: bigint }>;
      for (const snapshot of snapshots) {
        const amount = rescaleMinor(
          snapshot.amount,
          source.decimals,
          target.decimals,
        );
        database
          .prepare(
            'UPDATE snapshot SET amount = ?, updated_by = ?, updated_at = ? WHERE id = ?',
          )
          .run(amount, memberId, now, snapshot.id);
      }
      const revisions = database
        .prepare(
          'SELECT id, old_amount FROM snapshot_revision WHERE account_id = ? ORDER BY id',
        )
        .all(parsedParams.data.id) as Array<{ id: bigint; old_amount: bigint }>;
      for (const revision of revisions) {
        database
          .prepare('UPDATE snapshot_revision SET old_amount = ? WHERE id = ?')
          .run(
            rescaleMinor(revision.old_amount, source.decimals, target.decimals),
            revision.id,
          );
      }
      database
        .prepare(
          'UPDATE account SET currency = ?, updated_by = ?, updated_at = ? WHERE id = ?',
        )
        .run(target.code, memberId, now, parsedParams.data.id);
      return true;
    })();
    if (!updated)
      return sendNotFound(
        reply,
        'Account changed before the currency was relabelled.',
      );
    rates?.requestBackfill();
    return currencyRelabelResponseSchema.parse({
      ...preview.response,
      requiresConfirmation: false,
    });
  });

  for (const [action, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    app.post(`/api/accounts/:id/${action}`, async (request, reply) => {
      const parsed = accountIdParamsSchema.safeParse(request.params);
      if (!parsed.success)
        return sendValidation(reply, 'Check the account.', [
          { path: ['id'], message: 'Choose an account.' },
        ]);
      const memberId = request.authContext?.memberId;
      if (memberId === null || memberId === undefined)
        return sendProfileRequired(reply);
      const now = clock.now().getTime();
      const result = database
        .prepare(
          `UPDATE account
           SET active = ?,
               deactivated_at = CASE
                 WHEN ? = 1 THEN NULL
                 WHEN active = 1 THEN ?
                 ELSE deactivated_at
               END,
               updated_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          active ? 1 : 0,
          active ? 1 : 0,
          now,
          memberId,
          now,
          parsed.data.id,
        );
      if (result.changes === 0)
        return sendNotFound(reply, 'Account not found.');
      const account = findAccount(database, parsed.data.id, now, true);
      if (!account) return sendNotFound(reply, 'Account not found.');
      return accountResponseSchema.parse({ account });
    });
  }
};

interface CurrencyRelabelPreview {
  response: {
    accountId: number;
    fromCurrency: string;
    toCurrency: string;
    requiresConfirmation: boolean;
    example: {
      takenAt: number;
      beforeAmount: string;
      afterAmount: string;
    } | null;
    precisionLosses: Array<{
      recordType: 'snapshot' | 'revision';
      recordId: number;
      snapshotId: number;
      revisionId: number | null;
      takenAt: number;
      beforeAmount: string;
      afterAmount: string;
    }>;
  };
}

function toAccountResponse(account: AccountBalance) {
  return {
    id: account.accountId,
    name: account.name,
    ownerMemberId: account.ownerMemberId,
    ownerName: account.ownerName,
    ownerActive: account.ownerActive,
    type: account.type,
    currency: account.currency,
    active: account.active,
    deactivatedAt: account.deactivatedAt,
    balance: toMinorString(account.balance),
    balanceTakenAt: account.takenAt,
    balanceSource: account.source,
    balanceUpdatedBy: account.updatedBy,
    stale: account.stale,
    createdBy: account.createdBy,
    createdAt: account.createdAt,
    updatedBy: account.updatedByAccount,
    updatedAt: account.updatedAt,
  };
}

function findAccount(
  database: Database.Database,
  accountId: number,
  at: number,
  includeInactive: boolean,
) {
  return balanceAt(database, at, {
    accountIds: [accountId],
    includeInactive,
  }).map(toAccountResponse)[0];
}

function lookupCurrency(
  database: Database.Database,
  code: string,
): Currency | undefined {
  const iso = getCurrency(code);
  if (iso) return iso;
  const coin = database
    .prepare(
      'SELECT code, name, decimals FROM coin WHERE code = ? COLLATE NOCASE',
    )
    .get(code) as
    { code: string; name: string; decimals: bigint | number } | undefined;
  return coin
    ? getCurrency(code, [
        { code: coin.code, name: coin.name, decimals: Number(coin.decimals) },
      ])
    : undefined;
}

function memberExists(database: Database.Database, memberId: number): boolean {
  return (
    database.prepare('SELECT 1 FROM member WHERE id = ?').get(memberId) !==
    undefined
  );
}

function snapshotInstant(
  database: Database.Database,
  date: string | undefined,
  now: number,
): number | null {
  if (date === undefined) return now;
  const family = database
    .prepare('SELECT time_zone FROM family WHERE id = 1')
    .get() as { time_zone: string } | undefined;
  if (!family) return null;
  try {
    const localToday = todayInTimeZone(new Date(now), family.time_zone);
    if (date > localToday) return null;
    if (date === localToday) return now;
    return endOfLocalDay(date, family.time_zone).getTime();
  } catch {
    return null;
  }
}

function makeCurrencyRelabelPreview(
  database: Database.Database,
  accountId: number,
  source: Currency,
  target: Currency,
): CurrencyRelabelPreview {
  const snapshots = database
    .prepare(
      `SELECT id, taken_at, amount FROM snapshot
       WHERE account_id = ?
       ORDER BY taken_at DESC, ${sourcePrioritySql()}, id DESC`,
    )
    .all(accountId) as Array<{ id: bigint; taken_at: bigint; amount: bigint }>;
  const exampleSnapshot = snapshots[0];
  const example = exampleSnapshot
    ? {
        takenAt: Number(exampleSnapshot.taken_at),
        beforeAmount: toMinorString(exampleSnapshot.amount),
        afterAmount: toMinorString(
          rescaleMinor(
            exampleSnapshot.amount,
            source.decimals,
            target.decimals,
          ),
        ),
      }
    : null;
  const precisionLosses: CurrencyRelabelPreview['response']['precisionLosses'] =
    snapshots.flatMap((snapshot) => {
      const after = rescaleMinor(
        snapshot.amount,
        source.decimals,
        target.decimals,
      );
      const losesPrecision = hasRescaleRemainder(
        snapshot.amount,
        source.decimals,
        target.decimals,
      );
      return losesPrecision
        ? [
            {
              recordType: 'snapshot' as const,
              recordId: Number(snapshot.id),
              snapshotId: Number(snapshot.id),
              revisionId: null,
              takenAt: Number(snapshot.taken_at),
              beforeAmount: toMinorString(snapshot.amount),
              afterAmount: toMinorString(after),
            },
          ]
        : [];
    });
  const revisions = database
    .prepare(
      `SELECT id, snapshot_id, old_taken_at, old_amount FROM snapshot_revision
       WHERE account_id = ? ORDER BY id`,
    )
    .all(accountId) as Array<{
    id: bigint;
    snapshot_id: bigint;
    old_taken_at: bigint;
    old_amount: bigint;
  }>;
  precisionLosses.push(
    ...revisions.flatMap((revision) => {
      const after = rescaleMinor(
        revision.old_amount,
        source.decimals,
        target.decimals,
      );
      const losesPrecision = hasRescaleRemainder(
        revision.old_amount,
        source.decimals,
        target.decimals,
      );
      return losesPrecision
        ? [
            {
              recordType: 'revision' as const,
              recordId: Number(revision.id),
              snapshotId: Number(revision.snapshot_id),
              revisionId: Number(revision.id),
              takenAt: Number(revision.old_taken_at),
              beforeAmount: toMinorString(revision.old_amount),
              afterAmount: toMinorString(after),
            },
          ]
        : [];
    }),
  );
  return {
    response: {
      accountId,
      fromCurrency: source.code,
      toCurrency: target.code,
      requiresConfirmation: true,
      example,
      precisionLosses,
    },
  };
}

function sourcePrioritySql(): string {
  return `CASE source
    WHEN 'connector' THEN 0 WHEN 'statement' THEN 1 WHEN 'photo' THEN 2
    WHEN 'checkin' THEN 3 WHEN 'manual' THEN 4 WHEN 'opening' THEN 5
    WHEN 'carried_forward' THEN 6 ELSE 7 END`;
}

function hasRescaleRemainder(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): boolean {
  if (toDecimals >= fromDecimals) return false;
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  return amount % divisor !== 0n;
}

function rescaleMinor(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  let result: bigint;
  if (toDecimals >= fromDecimals) {
    result = amount * 10n ** BigInt(toDecimals - fromDecimals);
  } else {
    const divisor = 10n ** BigInt(fromDecimals - toDecimals);
    const absolute = amount < 0n ? -amount : amount;
    const whole = absolute / divisor;
    const remainder = (absolute % divisor)
      .toString()
      .padStart(fromDecimals - toDecimals, '0');
    const value = `${amount < 0n ? '-' : ''}${whole}.${remainder}`;
    result = roundHalfAwayFromZero(value, 0);
  }
  if (!isMinorInRange(result)) throw new RangeError('Amount is too large');
  return result;
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
  return reply
    .code(400)
    .send({ error: { code: 'validation', message, fields } });
}

function sendNotFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: { code: 'not_found', message } });
}

function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
