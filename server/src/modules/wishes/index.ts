import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  addMonths,
  createWishRequestSchema,
  linkWishExpenseRequestSchema,
  monthOfDate,
  moveWishRequestSchema,
  restoreWishResponseSchema,
  todayInTimeZone,
  updateWishRequestSchema,
  wishCandidatesQuerySchema,
  wishCandidatesResponseSchema,
  wishIdParamsSchema,
  wishResponseSchema,
  wishesQuerySchema,
  wishesResponseSchema,
  type WishState,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { lookupCurrency } from '../../domain/currencies.js';
import {
  detachWishLinks,
  reattachWishLinks,
  recomputeWishLinks,
} from '../../domain/wishLinkChanges.js';
import { createRateLookup } from '../../rates/lookup.js';
import type { BackfillRequester } from '../../rates/service.js';
import { createValuation } from '../../domain/valuation.js';
import {
  listWishCandidates,
  unplannedExpense,
} from '../../domain/wishCandidates.js';
import { writeRevision } from '../../domain/transactions.js';
import {
  linkAmountFor,
  linkChanges,
  saveLink,
  type StoredLink,
} from '../../domain/wishLinks.js';
import { listWishes, loadWish, wishesSummary } from '../../domain/wishes.js';
import {
  sendChanged,
  sendInvalid,
  sendNotFound,
  sendProfileRequired,
  type Issue,
} from './errors.js';
import { addRecordRoutes } from './record.js';

/** The first month a wish can be for (O8). */
const firstMonth = '2000-01';

type WishState3 = {
  state: WishState;
  month: string;
  deleted: boolean;
  deletedAt: number | null;
};

/**
 * Registers the wish routes (spec 3a, Design 4): a month's wishes, one wish,
 * add and change, move to the next month, delete and restore. Every member
 * can use them (MEM-4); they need a connection and a signed-in profile.
 */
export const wishRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
  /** Asked to fetch the rates a wish currency or a link date needs. */
  rates?: BackfillRequester;
}> = async (app, options) => {
  const { database, rates } = options;
  const clock = options.clock ?? systemClock;

  /** The current month in the family time zone. */
  const currentMonth = () => {
    const family = database
      .prepare('SELECT time_zone FROM family WHERE id = 1')
      .get() as { time_zone: string } | undefined;
    if (!family) throw new Error('The family has not been set up.');
    return monthOfDate(todayInTimeZone(clock.now(), family.time_zone));
  };

  /** The month is one a wish can be for: 2000-01 to 12 months ahead (O8). */
  const monthProblem = (month: string, field = 'month'): Issue[] | undefined =>
    month < firstMonth || month > addMonths(currentMonth(), 12)
      ? [
          {
            path: [field],
            message: 'Choose a month from 2000-01 to a year ahead.',
          },
        ]
      : undefined;

  app.get('/api/wishes', async (request, reply) => {
    const parsed = wishesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the month.', parsed.error.issues);
    }
    const current = currentMonth();
    const month = parsed.data.month ?? current;
    const problem = monthProblem(month);
    if (problem) return sendInvalid(reply, problem[0]!.message, problem);
    const wishes = listWishes(database, month);
    return wishesResponseSchema.parse({
      month,
      wishes,
      ...wishesSummary(wishes, month, current, createValuation(database)),
    });
  });

  app.get('/api/wishes/:id', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    const wish = params.success
      ? loadWish(database, params.data.id)
      : undefined;
    if (!wish) return sendNotFound(reply);
    return wishResponseSchema.parse({ wish });
  });

  app.get('/api/wishes/:id/candidates', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    const query = wishCandidatesQuerySchema.safeParse(request.query);
    const wish = params.success
      ? loadWish(database, params.data.id)
      : undefined;
    if (!wish) return sendNotFound(reply);
    if (!query.success) {
      return sendInvalid(reply, 'Check the search.', query.error.issues);
    }
    return wishCandidatesResponseSchema.parse({
      month: wish.month,
      candidates: listWishCandidates(database, wish, query.data.q),
    });
  });

  app.post('/api/wishes/:id/links', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const parsed = linkWishExpenseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the expense.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const id = params.data.id;
    const txnId = parsed.data.transactionId;
    const now = clock.now().getTime();
    const lookup = createRateLookup(database);

    const outcome = database.transaction(() => {
      const wish = database
        .prepare(
          `SELECT name, currency, month, state, deleted_at AS deletedAt
           FROM wish WHERE id = ?`,
        )
        .get(id) as
        | {
            name: string;
            currency: string;
            month: string;
            state: WishState;
            deletedAt: bigint | null;
          }
        | undefined;
      if (!wish) return 'not_found' as const;
      if (wish.deletedAt !== null || wish.state === 'dropped') {
        return 'wish_not_open' as const;
      }
      const expense = database
        .prepare(
          `SELECT t.amount, t.date, a.currency
           FROM txn t JOIN account a ON a.id = t.account_id
           WHERE t.id = ? AND ${unplannedExpense}`,
        )
        .get(txnId) as
        { amount: bigint; date: string; currency: string } | undefined;
      // Gone, planned meanwhile or of another month: it changed.
      if (!expense || expense.date.slice(0, 7) !== wish.month) {
        return 'changed' as const;
      }
      const link: StoredLink = {
        id: 0,
        wishId: id,
        wishName: wish.name,
        wishCurrency: wish.currency,
        wishMonth: wish.month,
        wishState: wish.state,
        month: wish.month,
        amount: linkAmountFor(database, lookup, {
          amount: expense.amount,
          currency: expense.currency,
          wishCurrency: wish.currency,
          date: expense.date,
        }),
        amountManual: false,
        madeHow: 'member',
        madeBy: memberId,
        madeAt: now,
      };
      saveLink(database, txnId, null, link);
      database
        .prepare('UPDATE txn SET updated_by = ?, updated_at = ? WHERE id = ?')
        .run(memberId, now, txnId);
      writeRevision(database, {
        txnId,
        action: 'update',
        changes: linkChanges(null, link, expense.currency),
        changedBy: memberId,
        changedAt: now,
      });
      return 'ok' as const;
    })();
    if (outcome === 'not_found') return sendNotFound(reply);
    if (outcome === 'changed') return sendChanged(reply);
    if (outcome === 'wish_not_open') {
      return reply.code(409).send({
        error: {
          code: 'wish_not_open',
          message: 'This wish is dropped or deleted.',
        },
      });
    }
    rates?.requestBackfill();
    return reply
      .code(201)
      .send(wishResponseSchema.parse({ wish: loadWish(database, id) }));
  });

  addRecordRoutes(app, { database, clock, rates });

  app.post('/api/wishes', async (request, reply) => {
    const parsed = createWishRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the wish.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const problems = [
      ...(monthProblem(body.month) ?? []),
      ...(currencyProblem(database, body.currency) ?? []),
      ...(categoryProblem(database, body.categoryId ?? null, null) ?? []),
    ];
    if (problems.length > 0) {
      return sendInvalid(reply, 'Check the wish.', problems);
    }
    const now = clock.now().getTime();
    const inserted = database
      .prepare(
        `INSERT INTO wish
           (month, name, amount, expression, currency, category_id, note,
            state, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(
        body.month,
        body.name,
        BigInt(body.amount),
        body.expression ?? null,
        body.currency,
        body.categoryId ?? null,
        body.note ?? null,
        memberId,
        now,
        memberId,
        now,
      );
    const wish = loadWish(database, Number(inserted.lastInsertRowid));
    return reply.code(201).send(wishResponseSchema.parse({ wish }));
  });

  app.patch('/api/wishes/:id', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const parsed = updateWishRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the wish.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const id = params.data.id;
    const now = clock.now().getTime();
    let currencyChanged = false;

    const outcome = database.transaction(() => {
      const stored = readState(database, id);
      if (!stored || stored.deleted) return 'not_found' as const;
      if (
        (body.expect?.state && body.expect.state !== stored.state) ||
        (body.expect?.month && body.expect.month !== stored.month)
      ) {
        return 'changed' as const;
      }
      const problems = [
        ...(body.currency === undefined
          ? []
          : (currencyProblem(database, body.currency) ?? [])),
        ...(body.categoryId === undefined
          ? []
          : (categoryProblem(database, body.categoryId, id) ?? [])),
      ];
      if (problems.length > 0) return problems;
      const sets: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      if (body.name !== undefined) set('name', body.name);
      if (body.amount !== undefined) set('amount', BigInt(body.amount));
      if (body.expression !== undefined) set('expression', body.expression);
      if (body.currency !== undefined) set('currency', body.currency);
      if (body.categoryId !== undefined) set('category_id', body.categoryId);
      if (body.note !== undefined) set('note', body.note);
      if (body.state !== undefined) set('state', body.state);
      const oldCurrency = (
        database.prepare('SELECT currency FROM wish WHERE id = ?').get(id) as {
          currency: string;
        }
      ).currency;
      database
        .prepare(
          `UPDATE wish SET ${sets.join(', ')}, updated_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(...values, memberId, now, id);
      // The amounts counted for the wish follow its currency (O5).
      if (body.currency !== undefined && body.currency !== oldCurrency) {
        recomputeWishLinks(
          database,
          id,
          oldCurrency,
          createRateLookup(database),
          memberId,
          now,
        );
        currencyChanged = true;
      }
      return 'ok' as const;
    })();
    if (outcome === 'not_found') return sendNotFound(reply);
    if (outcome === 'changed') return sendChanged(reply);
    if (outcome !== 'ok') {
      return sendInvalid(reply, 'Check the wish.', outcome);
    }
    if (currencyChanged) rates?.requestBackfill();
    return wishResponseSchema.parse({ wish: loadWish(database, id) });
  });

  app.post('/api/wishes/:id/move', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const parsed = moveWishRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the month.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { month: target, expect } = parsed.data;
    const id = params.data.id;
    const current = currentMonth();
    const now = clock.now().getTime();

    const outcome = database.transaction(() => {
      const stored = readState(database, id);
      if (!stored || stored.deleted) return 'not_found' as const;
      if (
        (expect?.state && expect.state !== stored.state) ||
        (expect?.month && expect.month !== stored.month)
      ) {
        return 'changed' as const;
      }
      // Forward: an open wish of this month to the next. Back (Undo): a
      // wish of the next month to this one. Nothing else moves (PLN-11).
      const forward =
        stored.month === current && target === addMonths(current, 1);
      const back = stored.month === addMonths(current, 1) && target === current;
      if (stored.state !== 'open' || !(forward || back)) {
        return 'invalid' as const;
      }
      database
        .prepare(
          `UPDATE wish SET month = ?, updated_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(target, memberId, now, id);
      return 'ok' as const;
    })();
    if (outcome === 'not_found') return sendNotFound(reply);
    if (outcome === 'changed') return sendChanged(reply);
    if (outcome === 'invalid') {
      return sendInvalid(reply, 'Only an open wish of this month moves on.', [
        { path: ['month'], message: 'This wish cannot move to that month.' },
      ]);
    }
    return wishResponseSchema.parse({ wish: loadWish(database, id) });
  });

  app.delete('/api/wishes/:id', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const id = params.data.id;
    const now = clock.now().getTime();
    const found = database.transaction(() => {
      const stored = readState(database, id);
      if (!stored || stored.deleted) return false;
      // A soft delete, so that Undo can bring it back (UI-WSH-3, O6).
      database
        .prepare(`UPDATE wish SET deleted_at = ?, deleted_by = ? WHERE id = ?`)
        .run(now, memberId, id);
      detachWishLinks(database, id, memberId, now);
      return true;
    })();
    if (!found) return sendNotFound(reply);
    return reply.code(204).send();
  });

  app.post('/api/wishes/:id/restore', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const id = params.data.id;
    const now = clock.now().getTime();
    const outcome = database.transaction(() => {
      const stored = readState(database, id);
      if (!stored) return 'not_found' as const;
      if (!stored.deleted) return 'changed' as const;
      database
        .prepare(
          `UPDATE wish SET deleted_at = NULL, deleted_by = NULL WHERE id = ?`,
        )
        .run(id);
      return reattachWishLinks(
        database,
        id,
        stored.deletedAt ?? 0,
        memberId,
        now,
        createRateLookup(database),
      );
    })();
    if (outcome === 'not_found') return sendNotFound(reply);
    if (outcome === 'changed') return sendChanged(reply);
    return restoreWishResponseSchema.parse({
      wish: loadWish(database, id),
      notRestored: outcome,
    });
  });
};

/** The state, month and deleted flag of a wish, or undefined. */
function readState(
  database: Database.Database,
  id: number,
): WishState3 | undefined {
  const row = database
    .prepare(
      'SELECT state, month, deleted_at AS deletedAt FROM wish WHERE id = ?',
    )
    .get(id) as
    { state: WishState; month: string; deletedAt: bigint | null } | undefined;
  return row
    ? {
        state: row.state,
        month: row.month,
        deleted: row.deletedAt !== null,
        deletedAt: row.deletedAt === null ? null : Number(row.deletedAt),
      }
    : undefined;
}

function currencyProblem(
  database: Database.Database,
  code: string,
): Issue[] | undefined {
  return lookupCurrency(database, code)
    ? undefined
    : [
        {
          path: ['currency'],
          message: 'Choose an ISO currency or a coin in Settings.',
        },
      ];
}

/**
 * A wish's category is an active expense category; one that was archived
 * stays on a wish that already has it (O7).
 */
function categoryProblem(
  database: Database.Database,
  categoryId: number | null,
  wishId: number | null,
): Issue[] | undefined {
  if (categoryId === null) return undefined;
  const row = database
    .prepare(
      'SELECT kind, archived_at AS archivedAt FROM category WHERE id = ?',
    )
    .get(categoryId) as { kind: string; archivedAt: bigint | null } | undefined;
  if (row && row.kind === 'expense') {
    if (row.archivedAt === null) return undefined;
    const kept =
      wishId !== null &&
      database
        .prepare('SELECT 1 FROM wish WHERE id = ? AND category_id = ?')
        .get(wishId, categoryId) !== undefined;
    if (kept) return undefined;
  }
  return [
    {
      path: ['categoryId'],
      message: 'Choose an expense category that is not archived.',
    },
  ];
}
