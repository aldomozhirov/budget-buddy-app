import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  addMonths,
  adjustmentIdParamsSchema,
  adjustmentResponseSchema,
  createAdjustmentRequestSchema,
  createEnvelopeRequestSchema,
  createMoveRequestSchema,
  deleteEnvelopeResponseSchema,
  envelopeDetailQuerySchema,
  envelopeDetailResponseSchema,
  envelopeHistoryQuerySchema,
  envelopeHistoryResponseSchema,
  envelopeIdParamsSchema,
  envelopeResponseSchema,
  envelopesQuerySchema,
  envelopesResponseSchema,
  monthOfDate,
  moveResponseSchema,
  todayInTimeZone,
  toMinorString,
  updateEnvelopeRequestSchema,
  type Envelope,
  type EnvelopeAdjustment,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { lookupCurrency, rescaleMinor } from '../../domain/currencies.js';
import {
  closedMonthsInPeriod,
  envelopeStatistics,
  listEnvelopeStates,
  planForMonth,
  savePlan,
  type EnvelopeMonth,
  type EnvelopePlan,
  type EnvelopeState,
} from '../../domain/envelopes.js';

/** Registers the envelope, adjustment, move and history routes. */
export const envelopeRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  /** Today's date and month in the family time zone. */
  const today = () => {
    const family = database
      .prepare('SELECT time_zone FROM family WHERE id = 1')
      .get() as { time_zone: string } | undefined;
    if (!family) throw new Error('The family has not been set up.');
    const date = todayInTimeZone(clock.now(), family.time_zone);
    return { date, month: monthOfDate(date) };
  };

  app.get('/api/envelopes', async (request, reply) => {
    const parsed = envelopesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the envelope filters.',
        parsed.error.issues,
      );
    }
    const archived = parsed.data.archived === 'true';
    const envelopes = loadEnvelopes(database, today().month).filter(
      (envelope) => envelope.archived === archived,
    );
    return envelopesResponseSchema.parse({ envelopes });
  });

  app.post('/api/envelopes', async (request, reply) => {
    const parsed = createEnvelopeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the envelope details.',
        parsed.error.issues,
      );
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const currency = lookupCurrency(database, body.currency);
    if (!currency) return sendUnknownCurrency(reply);
    const categoryProblem = checkDefaultCategory(
      database,
      body.defaultCategoryId,
    );
    if (categoryProblem) return sendValidation(reply, ...categoryProblem);
    const { month } = today();
    const now = clock.now().getTime();

    const id = database.transaction(() => {
      if (nameTaken(database, body.name)) return null;
      const position = database
        .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM envelope')
        .get() as { next: bigint };
      const inserted = database
        .prepare(
          `INSERT INTO envelope
             (name, currency, starting_balance, starting_month,
              topup_from_month, default_category_id, position, created_by,
              created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          body.name,
          currency.code,
          BigInt(body.startingBalance ?? '0'),
          month,
          addMonths(month, 1),
          body.defaultCategoryId ?? null,
          position.next,
          memberId,
          now,
          memberId,
          now,
        );
      const envelopeId = Number(inserted.lastInsertRowid);
      savePlan(database, {
        envelopeId,
        fromMonth: month,
        monthlyAmount: BigInt(body.monthlyAmount),
        mode: body.mode,
        createdBy: memberId,
        now,
      });
      return envelopeId;
    })();
    if (id === null) return sendNameTaken(reply);
    const envelope = loadEnvelopes(database, month, id)[0];
    if (!envelope) throw new Error('Created envelope could not be reloaded.');
    return reply.code(201).send(envelopeResponseSchema.parse({ envelope }));
  });

  app.get('/api/envelopes/:id', async (request, reply) => {
    const params = envelopeIdParamsSchema.safeParse(request.params);
    const query = envelopeDetailQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return sendValidation(reply, 'Check the envelope.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose an envelope.' }]
          : []),
        ...(!query.success ? query.error.issues : []),
      ]);
    }
    const current = today().month;
    const state = listEnvelopeStates(database, current, params.data.id)[0];
    if (!state) return sendNotFound(reply);
    const month = query.data.month ?? current;
    const record = state.months.find((entry) => entry.month === month);
    if (!record) {
      return sendValidation(reply, 'Choose a month of this envelope.', [
        {
          path: ['month'],
          message: `Choose a month from ${state.ledger.startingMonth} to ${current}.`,
        },
      ]);
    }
    const envelope = loadEnvelopes(database, current, params.data.id)[0];
    if (!envelope) return sendNotFound(reply);
    return envelopeDetailResponseSchema.parse({
      envelope,
      month: toMonthResponse(record),
      expenses: loadExpenses(database, state, month),
      adjustments: loadAdjustments(database, state, month),
    });
  });

  app.patch('/api/envelopes/:id', async (request, reply) => {
    const params = envelopeIdParamsSchema.safeParse(request.params);
    const body = updateEnvelopeRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendValidation(reply, 'Check the envelope details.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose an envelope.' }]
          : []),
        ...(!body.success ? body.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { id } = params.data;
    const { month } = today();
    const now = clock.now().getTime();
    const outcome = database.transaction(() =>
      updateEnvelope(database, id, body.data, { memberId, month, now }),
    )();
    if (outcome.kind === 'not_found') return sendNotFound(reply);
    if (outcome.kind === 'name_taken') return sendNameTaken(reply);
    if (outcome.kind === 'conflict') {
      return reply.code(409).send({
        error: { code: 'conflict', message: outcome.message },
      });
    }
    if (outcome.kind === 'invalid') {
      return sendValidation(reply, outcome.message, outcome.issues);
    }
    const envelope = loadEnvelopes(database, month, id)[0];
    if (!envelope) return sendNotFound(reply);
    return envelopeResponseSchema.parse({ envelope });
  });

  app.delete('/api/envelopes/:id', async (request, reply) => {
    const params = envelopeIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidation(reply, 'Check the envelope.', [
        { path: ['id'], message: 'Choose an envelope.' },
      ]);
    }
    const { id } = params.data;
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const now = clock.now().getTime();
    const result = database.transaction(() => {
      const exists = database
        .prepare('SELECT 1 AS found FROM envelope WHERE id = ?')
        .get(id);
      if (!exists) return 'not_found' as const;
      if (isUsed(database, id)) return 'used' as const;
      // What only names the envelope stops naming it; the rules and
      // categories themselves stay.
      database
        .prepare(
          `UPDATE category SET default_envelope_id = NULL, updated_by = ?,
             updated_at = ? WHERE default_envelope_id = ?`,
        )
        .run(memberId, now, id);
      database
        .prepare(
          `UPDATE rule SET envelope_id = NULL, updated_by = ?, updated_at = ?
           WHERE envelope_id = ?`,
        )
        .run(memberId, now, id);
      database
        .prepare('DELETE FROM envelope_topup WHERE envelope_id = ?')
        .run(id);
      database
        .prepare('DELETE FROM envelope_plan WHERE envelope_id = ?')
        .run(id);
      database.prepare('DELETE FROM envelope WHERE id = ?').run(id);
      return 'deleted' as const;
    })();
    if (result === 'not_found') return sendNotFound(reply);
    if (result === 'used') {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message:
            'An envelope with expenses or adjustments cannot be deleted. ' +
            'Archive it instead.',
        },
      });
    }
    return deleteEnvelopeResponseSchema.parse({ deleted: true });
  });

  app.get('/api/envelopes/:id/history', async (request, reply) => {
    const params = envelopeIdParamsSchema.safeParse(request.params);
    const query = envelopeHistoryQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return sendValidation(reply, 'Check the history.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose an envelope.' }]
          : []),
        ...(!query.success ? query.error.issues : []),
      ]);
    }
    const period = query.data.period ?? 'last6';
    const current = today().month;
    const state = listEnvelopeStates(database, current, params.data.id)[0];
    if (!state) return sendNotFound(reply);
    const closed = closedMonthsInPeriod(state.months, period, current);
    // The chart shows this month too, outlined; it is not in the statistics.
    const months = [...closed, ...state.months.filter((m) => !m.closed)];
    const statistics = envelopeStatistics(state.months, period, current);
    return envelopeHistoryResponseSchema.parse({
      envelopeId: state.ledger.id,
      currency: state.ledger.currency,
      period,
      months: months.map(toMonthResponse),
      statistics: {
        months: statistics.months,
        withinBudget: statistics.withinBudget,
        averageSpent:
          statistics.averageSpent === null
            ? null
            : toMinorString(statistics.averageSpent),
        largestOverspend: statistics.largestOverspend && {
          month: statistics.largestOverspend.month,
          amount: toMinorString(statistics.largestOverspend.amount),
        },
        leftOverNet: toMinorString(statistics.leftOverNet),
        incomplete: statistics.incomplete,
      },
    });
  });

  app.post('/api/envelopes/:id/adjustments', async (request, reply) => {
    const params = envelopeIdParamsSchema.safeParse(request.params);
    const body = createAdjustmentRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendValidation(reply, 'Check the adjustment.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose an envelope.' }]
          : []),
        ...(!body.success ? body.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { date: todayDate } = today();
    const date = body.data.date ?? todayDate;
    if (date > todayDate) return sendFutureDate(reply);
    const now = clock.now().getTime();
    const result = database.transaction(() => {
      const envelope = findEnvelope(database, params.data.id);
      if (!envelope) return 'not_found' as const;
      if (envelope.archived) return 'archived' as const;
      return insertAdjustment(database, {
        envelopeId: params.data.id,
        date,
        amount: BigInt(body.data.amount),
        note: body.data.note ?? null,
        moveId: null,
        counterpartEnvelopeId: null,
        memberId,
        now,
      });
    })();
    if (result === 'not_found') return sendNotFound(reply);
    if (result === 'archived') return sendArchived(reply);
    return reply
      .code(201)
      .send(adjustmentResponseSchema.parse({ adjustment: result }));
  });

  app.post('/api/envelopes/moves', async (request, reply) => {
    const body = createMoveRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidation(reply, 'Check the move.', body.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { fromEnvelopeId, toEnvelopeId, note } = body.data;
    if (fromEnvelopeId === toEnvelopeId) {
      return sendValidation(reply, 'Choose two different envelopes.', [
        {
          path: ['toEnvelopeId'],
          message: 'Choose a different envelope to move to.',
        },
      ]);
    }
    const { date: todayDate } = today();
    const date = body.data.date ?? todayDate;
    if (date > todayDate) return sendFutureDate(reply);
    const amount = BigInt(body.data.amount);
    const now = clock.now().getTime();
    const result = database.transaction(() => {
      const from = findEnvelope(database, fromEnvelopeId);
      const to = findEnvelope(database, toEnvelopeId);
      if (!from || !to) return 'not_found' as const;
      if (from.currency !== to.currency) return 'currency' as const;
      if (from.archived || to.archived) return 'archived' as const;
      const moveId = randomUUID();
      const sides = [
        {
          envelopeId: fromEnvelopeId,
          counterpartEnvelopeId: toEnvelopeId,
          amount: -amount,
        },
        {
          envelopeId: toEnvelopeId,
          counterpartEnvelopeId: fromEnvelopeId,
          amount,
        },
      ].map((side) =>
        insertAdjustment(database, {
          ...side,
          date,
          note: note ?? null,
          moveId,
          memberId,
          now,
        }),
      );
      return { moveId, adjustments: sides };
    })();
    if (result === 'not_found') return sendNotFound(reply);
    if (result === 'currency') {
      return sendValidation(
        reply,
        'Money moves only between envelopes of the same currency.',
        [
          {
            path: ['toEnvelopeId'],
            message: 'Choose an envelope in the same currency.',
          },
        ],
      );
    }
    if (result === 'archived') return sendArchived(reply);
    return reply.code(201).send(moveResponseSchema.parse(result));
  });

  app.delete('/api/envelope-adjustments/:id', async (request, reply) => {
    const params = adjustmentIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidation(reply, 'Check the adjustment.', [
        { path: ['id'], message: 'Choose an adjustment.' },
      ]);
    }
    const { id } = params.data;
    const count = database.transaction(() => {
      const row = database
        .prepare(
          'SELECT move_id AS moveId FROM envelope_adjustment WHERE id = ?',
        )
        .get(id) as { moveId: string | null } | undefined;
      if (!row) return 0;
      // The two sides of a move go together.
      return row.moveId === null
        ? database
            .prepare('DELETE FROM envelope_adjustment WHERE id = ?')
            .run(id).changes
        : database
            .prepare('DELETE FROM envelope_adjustment WHERE move_id = ?')
            .run(row.moveId).changes;
    })();
    if (count === 0) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'Adjustment not found.' },
      });
    }
    return deleteEnvelopeResponseSchema.parse({ deleted: true, count });
  });
};

type UpdateOutcome =
  | { kind: 'updated' }
  | { kind: 'not_found' }
  | { kind: 'name_taken' }
  | { kind: 'conflict'; message: string }
  | {
      kind: 'invalid';
      message: string;
      issues: { path: PropertyKey[]; message: string }[];
    };

type StoredEnvelope = {
  currency: string;
  archived: boolean;
};

/**
 * Applies a validated change inside the caller's transaction. A currency
 * change relabels the starting balance, the plans and the top-ups first, so
 * the amounts of the same request are read in the new currency (O6).
 */
function updateEnvelope(
  database: Database.Database,
  id: number,
  body: ReturnType<typeof updateEnvelopeRequestSchema.parse>,
  context: { memberId: number; month: string; now: number },
): UpdateOutcome {
  const { memberId, month, now } = context;
  const stored = findEnvelope(database, id);
  if (!stored) return { kind: 'not_found' };
  const invalid = (field: string, message: string): UpdateOutcome => ({
    kind: 'invalid',
    message,
    issues: [{ path: [field], message }],
  });

  if (body.name !== undefined && nameTaken(database, body.name, id)) {
    return { kind: 'name_taken' };
  }
  if (body.defaultCategoryId !== undefined) {
    const problem = checkDefaultCategory(database, body.defaultCategoryId);
    if (problem)
      return { kind: 'invalid', message: problem[0], issues: problem[1] };
  }

  if (body.currency !== undefined && body.currency !== stored.currency) {
    const target = lookupCurrency(database, body.currency);
    const source = lookupCurrency(database, stored.currency);
    if (!target) {
      return invalid(
        'currency',
        'Choose an ISO currency or a coin in Settings.',
      );
    }
    if (!source) throw new Error(`Unknown stored currency ${stored.currency}.`);
    if (isUsed(database, id)) {
      return {
        kind: 'conflict',
        message:
          'The currency is fixed once an envelope has expenses or adjustments.',
      };
    }
    if (body.confirm !== true) {
      return invalid(
        'confirm',
        'Changing the currency relabels the starting balance and the monthly ' +
          'amount without converting them. Confirm to continue.',
      );
    }
    try {
      relabel(database, id, source.decimals, target.decimals);
    } catch {
      return invalid(
        'currency',
        'The amount would be too large in that currency.',
      );
    }
    database
      .prepare('UPDATE envelope SET currency = ? WHERE id = ?')
      .run(target.code, id);
  }

  if (body.startingBalance !== undefined) {
    database
      .prepare('UPDATE envelope SET starting_balance = ? WHERE id = ?')
      .run(BigInt(body.startingBalance), id);
  }

  if (body.monthlyAmount !== undefined || body.mode !== undefined) {
    writeNextPlan(database, id, body, context);
  }

  if (body.archived === true && !stored.archived) {
    database
      .prepare('UPDATE envelope SET archived_at = ? WHERE id = ?')
      .run(now, id);
  } else if (body.archived === false && stored.archived) {
    // A restored envelope is topped up from the month after (3.1).
    database
      .prepare(
        'UPDATE envelope SET archived_at = NULL, topup_from_month = ? WHERE id = ?',
      )
      .run(addMonths(month, 1), id);
  }

  database
    .prepare(
      `UPDATE envelope SET name = COALESCE(?, name),
         default_category_id = CASE WHEN ? = 1 THEN ? ELSE default_category_id END,
         updated_by = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      body.name ?? null,
      body.defaultCategoryId === undefined ? 0 : 1,
      body.defaultCategoryId ?? null,
      memberId,
      now,
      id,
    );
  return { kind: 'updated' };
}

/**
 * Writes the plan of next month from the plan that now applies next month
 * (the pending one, else the one in force) with the changed fields (O4). A
 * change back to the plan in force removes the pending one.
 */
function writeNextPlan(
  database: Database.Database,
  id: number,
  body: {
    monthlyAmount?: string | undefined;
    mode?: EnvelopePlan['mode'] | undefined;
  },
  context: { memberId: number; month: string; now: number },
): void {
  const { memberId, month, now } = context;
  const next = addMonths(month, 1);
  const plans = database
    .prepare(
      `SELECT from_month AS fromMonth, monthly_amount AS monthlyAmount, mode
       FROM envelope_plan WHERE envelope_id = ? ORDER BY from_month`,
    )
    .all(id) as EnvelopePlan[];
  const inForce = planForMonth(plans, month);
  const base = planForMonth(plans, next) ?? inForce;
  if (!base) throw new Error('The envelope has no plan.');
  const monthlyAmount =
    body.monthlyAmount === undefined
      ? base.monthlyAmount
      : BigInt(body.monthlyAmount);
  const mode = body.mode ?? base.mode;
  if (
    inForce &&
    inForce.monthlyAmount === monthlyAmount &&
    inForce.mode === mode
  ) {
    database
      .prepare(
        'DELETE FROM envelope_plan WHERE envelope_id = ? AND from_month = ?',
      )
      .run(id, next);
    return;
  }
  savePlan(database, {
    envelopeId: id,
    fromMonth: next,
    monthlyAmount,
    mode,
    createdBy: memberId,
    now,
  });
}

/**
 * Relabels every stored amount of an unused envelope (O6, ACC-5). Every new
 * amount is computed before the first write, so a `RangeError` leaves the
 * envelope untouched.
 * @throws {RangeError} if an amount is too large in the new currency.
 */
function relabel(
  database: Database.Database,
  id: number,
  fromDecimals: number,
  toDecimals: number,
): void {
  const rescale = (amount: bigint) =>
    rescaleMinor(amount, fromDecimals, toDecimals);
  const envelope = database
    .prepare('SELECT starting_balance AS amount FROM envelope WHERE id = ?')
    .get(id) as { amount: bigint };
  const startingBalance = rescale(envelope.amount);
  const changes = (['envelope_plan', 'envelope_topup'] as const).map(
    (table) => {
      const column = table === 'envelope_plan' ? 'monthly_amount' : 'amount';
      const rows = database
        .prepare(
          `SELECT id, ${column} AS amount FROM ${table} WHERE envelope_id = ?`,
        )
        .all(id) as Array<{ id: bigint; amount: bigint }>;
      return {
        update: database.prepare(
          `UPDATE ${table} SET ${column} = ? WHERE id = ?`,
        ),
        rows: rows.map((row) => ({ id: row.id, amount: rescale(row.amount) })),
      };
    },
  );
  database
    .prepare('UPDATE envelope SET starting_balance = ? WHERE id = ?')
    .run(startingBalance, id);
  for (const { update, rows } of changes) {
    for (const row of rows) update.run(row.amount, row.id);
  }
}

/** Whether any expense part or adjustment names the envelope (ENV-7). */
function isUsed(database: Database.Database, id: number): boolean {
  return (
    database
      .prepare(
        `SELECT 1 AS found WHERE
           EXISTS (SELECT 1 FROM txn_part WHERE envelope_id = @id)
           OR EXISTS (SELECT 1 FROM envelope_adjustment WHERE envelope_id = @id)`,
      )
      .get({ id }) !== undefined
  );
}

function findEnvelope(
  database: Database.Database,
  id: number,
): (StoredEnvelope & { id: number }) | undefined {
  const row = database
    .prepare(
      'SELECT id, currency, archived_at AS archivedAt FROM envelope WHERE id = ?',
    )
    .get(id) as
    { id: bigint; currency: string; archivedAt: bigint | null } | undefined;
  return row
    ? {
        id: Number(row.id),
        currency: row.currency,
        archived: row.archivedAt !== null,
      }
    : undefined;
}

/** Whether another envelope has the name, ignoring case (ENV-1). */
function nameTaken(
  database: Database.Database,
  name: string,
  exceptId?: number,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 AS found FROM envelope
         WHERE unicode_casefold(name) = unicode_casefold(?) AND id <> ?`,
      )
      .get(name, exceptId ?? 0) !== undefined
  );
}

/** A default category must exist, be an expense category and be active. */
function checkDefaultCategory(
  database: Database.Database,
  categoryId: number | null | undefined,
): [string, { path: PropertyKey[]; message: string }[]] | undefined {
  if (categoryId === null || categoryId === undefined) return undefined;
  const row = database
    .prepare(
      'SELECT kind, archived_at AS archivedAt FROM category WHERE id = ?',
    )
    .get(categoryId) as { kind: string; archivedAt: bigint | null } | undefined;
  if (row && row.kind === 'expense' && row.archivedAt === null) {
    return undefined;
  }
  const message = 'Choose an expense category that is not archived.';
  return [message, [{ path: ['defaultCategoryId'], message }]];
}

function insertAdjustment(
  database: Database.Database,
  row: {
    envelopeId: number;
    date: string;
    amount: bigint;
    note: string | null;
    moveId: string | null;
    /** The other envelope of a move. */
    counterpartEnvelopeId: number | null;
    memberId: number;
    now: number;
  },
): EnvelopeAdjustment {
  const inserted = database
    .prepare(
      `INSERT INTO envelope_adjustment
         (envelope_id, date, amount, note, move_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.envelopeId,
      row.date,
      row.amount,
      row.note,
      row.moveId,
      row.memberId,
      row.now,
    );
  return {
    id: Number(inserted.lastInsertRowid),
    envelopeId: row.envelopeId,
    date: row.date,
    amount: toMinorString(row.amount),
    note: row.note,
    moveId: row.moveId,
    counterpartEnvelopeId: row.counterpartEnvelopeId,
    createdBy: row.memberId,
    createdAt: row.now,
  };
}

type EnvelopeRow = {
  id: bigint;
  defaultCategoryId: bigint | null;
  position: bigint;
  archivedAt: bigint | null;
  used: bigint;
  expenseCount: bigint;
  monthExpenseCount: bigint;
  createdBy: bigint;
  createdAt: bigint;
  updatedBy: bigint;
  updatedAt: bigint;
};

/** Reads every envelope, or only `id`, with this month's state. */
function loadEnvelopes(
  database: Database.Database,
  month: string,
  id?: number,
): Envelope[] {
  const states = listEnvelopeStates(database, month, id);
  const rows = new Map(
    (
      database
        .prepare(
          `SELECT id, default_category_id AS defaultCategoryId, position,
             archived_at AS archivedAt, created_by AS createdBy,
             created_at AS createdAt, updated_by AS updatedBy,
             updated_at AS updatedAt,
             EXISTS (SELECT 1 FROM txn_part WHERE envelope_id = envelope.id)
               OR EXISTS (SELECT 1 FROM envelope_adjustment
                          WHERE envelope_id = envelope.id) AS used,
             (SELECT COUNT(*) FROM txn_part p
                JOIN txn t ON t.id = p.txn_id
              WHERE p.envelope_id = envelope.id AND t.kind = 'expense'
                AND t.status = 'confirmed') AS expenseCount,
             (SELECT COUNT(*) FROM txn_part p
                JOIN txn t ON t.id = p.txn_id
              WHERE p.envelope_id = envelope.id AND t.kind = 'expense'
                AND t.status = 'confirmed'
                AND MAX(substr(t.date, 1, 7), envelope.starting_month)
                  = @month) AS monthExpenseCount
           FROM envelope WHERE @id IS NULL OR id = @id`,
        )
        .all({ id: id ?? null, month }) as EnvelopeRow[]
    ).map((row) => [Number(row.id), row]),
  );
  return states.flatMap((state) => {
    const row = rows.get(state.ledger.id);
    return row ? [toEnvelopeResponse(state, row)] : [];
  });
}

function toEnvelopeResponse(state: EnvelopeState, row: EnvelopeRow): Envelope {
  const { ledger, current, plan, pendingPlan } = state;
  return {
    id: ledger.id,
    name: ledger.name,
    currency: ledger.currency,
    startingBalance: toMinorString(ledger.startingBalance),
    startingMonth: ledger.startingMonth,
    defaultCategoryId:
      row.defaultCategoryId === null ? null : Number(row.defaultCategoryId),
    position: Number(row.position),
    archived: ledger.archived,
    archivedAt: row.archivedAt === null ? null : Number(row.archivedAt),
    plan: plan ? toPlanResponse(plan) : null,
    pendingPlan: pendingPlan ? toPlanResponse(pendingPlan) : null,
    current: current ? toMonthResponse(current) : null,
    overspent: current !== undefined && current.closing < 0n,
    used: row.used === 1n,
    expenseCount: Number(row.expenseCount),
    monthExpenseCount: Number(row.monthExpenseCount),
    createdBy: Number(row.createdBy),
    createdAt: Number(row.createdAt),
    updatedBy: Number(row.updatedBy),
    updatedAt: Number(row.updatedAt),
  };
}

function toPlanResponse(plan: EnvelopePlan) {
  return {
    fromMonth: plan.fromMonth,
    monthlyAmount: toMinorString(plan.monthlyAmount),
    mode: plan.mode,
  };
}

function toMonthResponse(month: EnvelopeMonth) {
  return {
    month: month.month,
    opening: toMinorString(month.opening),
    topUp: toMinorString(month.topUp),
    topUpMode: month.topUpMode,
    dropped: month.dropped === null ? null : toMinorString(month.dropped),
    adjustments: toMinorString(month.adjustments),
    spent: toMinorString(month.spent),
    available: toMinorString(month.available),
    closing: toMinorString(month.closing),
    result: toMinorString(month.result),
    closed: month.closed,
    withinBudget: month.withinBudget,
    incomplete: month.incomplete,
    closingIncomplete: month.closingIncomplete,
  };
}

/** The confirmed expenses charged to the envelope in a month (O3 included). */
function loadExpenses(
  database: Database.Database,
  state: EnvelopeState,
  month: string,
) {
  const rows = database
    .prepare(
      `SELECT t.id AS transactionId, t.date, t.merchant, t.note,
         p.amount, a.currency AS accountCurrency,
         p.envelope_amount AS envelopeAmount, t.member_id AS memberId
       FROM txn_part p
         JOIN txn t ON t.id = p.txn_id
         JOIN account a ON a.id = t.account_id
       WHERE p.envelope_id = @id AND t.kind = 'expense'
         AND t.status = 'confirmed'
         AND MAX(substr(t.date, 1, 7), @starting) = @month
       ORDER BY t.date DESC, t.id DESC, p.position`,
    )
    .all({
      id: state.ledger.id,
      starting: state.ledger.startingMonth,
      month,
    }) as Array<{
    transactionId: bigint;
    date: string;
    merchant: string | null;
    note: string | null;
    amount: bigint;
    accountCurrency: string;
    envelopeAmount: bigint | null;
    memberId: bigint;
  }>;
  return rows.map((row) => ({
    transactionId: Number(row.transactionId),
    date: row.date,
    merchant: row.merchant,
    note: row.note,
    amount: toMinorString(row.amount),
    accountCurrency: row.accountCurrency,
    envelopeAmount:
      row.envelopeAmount === null ? null : toMinorString(row.envelopeAmount),
    memberId: Number(row.memberId),
  }));
}

/** The adjustments and moves of the envelope in a month (O3 included). */
function loadAdjustments(
  database: Database.Database,
  state: EnvelopeState,
  month: string,
): EnvelopeAdjustment[] {
  const rows = database
    .prepare(
      `SELECT a.id, a.envelope_id AS envelopeId, a.date, a.amount, a.note,
         a.move_id AS moveId, a.created_by AS createdBy,
         a.created_at AS createdAt,
         (SELECT o.envelope_id FROM envelope_adjustment o
          WHERE o.move_id = a.move_id AND o.id <> a.id) AS counterpart
       FROM envelope_adjustment a
       WHERE a.envelope_id = @id
         AND MAX(substr(a.date, 1, 7), @starting) = @month
       ORDER BY a.date DESC, a.id DESC`,
    )
    .all({
      id: state.ledger.id,
      starting: state.ledger.startingMonth,
      month,
    }) as Array<{
    id: bigint;
    envelopeId: bigint;
    date: string;
    amount: bigint;
    note: string | null;
    moveId: string | null;
    createdBy: bigint;
    createdAt: bigint;
    counterpart: bigint | null;
  }>;
  return rows.map((row) => ({
    id: Number(row.id),
    envelopeId: Number(row.envelopeId),
    date: row.date,
    amount: toMinorString(row.amount),
    note: row.note,
    moveId: row.moveId,
    counterpartEnvelopeId:
      row.counterpart === null ? null : Number(row.counterpart),
    createdBy: Number(row.createdBy),
    createdAt: Number(row.createdAt),
  }));
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

function sendUnknownCurrency(reply: FastifyReply) {
  return sendValidation(reply, 'Choose a currency from the list.', [
    {
      path: ['currency'],
      message: 'Choose an ISO currency or a coin in Settings.',
    },
  ]);
}

function sendNameTaken(reply: FastifyReply) {
  const message = 'An envelope with that name already exists.';
  return reply.code(409).send({
    error: { code: 'conflict', message, fields: { name: message } },
  });
}

function sendFutureDate(reply: FastifyReply) {
  return sendValidation(reply, 'Choose today or an earlier date.', [
    { path: ['date'], message: 'A date cannot be in the future.' },
  ]);
}

function sendArchived(reply: FastifyReply) {
  return reply.code(409).send({
    error: {
      code: 'conflict',
      message: 'Restore the archived envelope first.',
    },
  });
}

function sendNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'Envelope not found.' },
  });
}

function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
