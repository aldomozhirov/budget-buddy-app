import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  recordWishRequestSchema,
  recordWishResponseSchema,
  todayInTimeZone,
  unrecordWishRequestSchema,
  wishIdParamsSchema,
  wishResponseSchema,
  type CreateTransactionRequest,
  type WishState,
} from '@budget-buddy/shared';
import type { Clock } from '../../clock.js';
import {
  deletedFields,
  readTransaction,
  toTransactionResponse,
  writeRevision,
} from '../../domain/transactions.js';
import {
  linkAmountFor,
  linkChanges,
  saveLink,
  type StoredLink,
} from '../../domain/wishLinks.js';
import { loadWish } from '../../domain/wishes.js';
import { createRateLookup } from '../../rates/lookup.js';
import type { BackfillRequester } from '../../rates/service.js';
import {
  checkDraft,
  createDraft,
  insertTransaction,
  wasDeleted,
} from '../transactions/index.js';
import {
  sendChanged,
  sendInvalid,
  sendNotFound,
  sendProfileRequired,
  type Issue,
} from './errors.js';

/** The settings the record routes need from `wishRoutes`. */
interface RecordOptions {
  database: Database.Database;
  clock: Clock;
  rates?: BackfillRequester | undefined;
}

type WishRow = {
  name: string;
  amount: bigint;
  currency: string;
  month: string;
  state: WishState;
  categoryId: bigint | null;
  deletedAt: bigint | null;
};

/** SHA-256 of the key-sorted body and the wish, to spot a changed retry. */
function hashRecord(wishId: number, body: Record<string, unknown>): string {
  const ordered = Object.fromEntries(
    Object.entries({ ...body, wishId }).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  );
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

/**
 * Registers `POST /api/wishes/:id/record` and `…/unrecord` (spec 3a,
 * Design 4, PLN-18): the expense, its link, its first history entry and
 * the wish's new state are saved in one database transaction.
 */
export function addRecordRoutes(
  app: FastifyInstance,
  options: RecordOptions,
): void {
  const { database, clock, rates } = options;

  app.post('/api/wishes/:id/record', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const parsed = recordWishRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the expense.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const id = params.data.id;
    const family = database
      .prepare('SELECT time_zone FROM family WHERE id = 1')
      .get() as { time_zone: string } | undefined;
    if (!family) throw new Error('The family has not been set up.');
    const today = todayInTimeZone(clock.now(), family.time_zone);
    const now = clock.now().getTime();
    const lookup = createRateLookup(database);
    const hash = hashRecord(id, body);

    const outcome = database.transaction(
      ():
        | { kind: 'created' | 'repeated'; txnId: number; previous: WishState }
        | { kind: 'not_found' }
        | { kind: 'not_open' }
        | { kind: 'conflict'; message: string }
        | { kind: 'invalid'; issues: Issue[] } => {
        const wish = database
          .prepare(
            `SELECT name, amount, currency, month, state,
             category_id AS categoryId, deleted_at AS deletedAt
           FROM wish WHERE id = ?`,
          )
          .get(id) as WishRow | undefined;
        if (!wish || wish.deletedAt !== null) return { kind: 'not_found' };

        const existing = database
          .prepare(
            'SELECT id, client_hash AS hash FROM txn WHERE client_id = ?',
          )
          .get(body.clientId) as
          { id: bigint; hash: string | null } | undefined;
        if (existing) {
          return existing.hash === hash
            ? {
                kind: 'repeated',
                txnId: Number(existing.id),
                // Not kept: a repeat can only say what it would have been.
                previous: body.keepOpen ? wish.state : 'open',
              }
            : {
                kind: 'conflict',
                message:
                  'Another transaction was already sent with this client id.',
              };
        }
        if (wasDeleted(database, body.clientId)) {
          return {
            kind: 'conflict',
            message: 'This expense was recorded and has been deleted since.',
          };
        }
        if (wish.state === 'dropped') return { kind: 'not_open' };

        const request: CreateTransactionRequest = {
          clientId: body.clientId,
          kind: 'expense',
          date: body.date ?? today,
          accountId: body.accountId,
          amount: body.amount,
          merchant: body.merchant === '' ? undefined : body.merchant,
          note: wish.name,
          categoryId:
            body.categoryId === undefined
              ? wish.categoryId === null
                ? null
                : Number(wish.categoryId)
              : body.categoryId,
          // The category's default envelope is not filled in (CAT-5).
          envelopeId: null,
        };
        const draft = createDraft(request, memberId, today, now);
        // The wish's own category is not checked again: it may be archived
        // (O7). One the member picked is.
        if (body.categoryId === undefined) {
          const checked = draft.changed;
          draft.changed = (field) => field !== 'categoryId' && checked(field);
        }
        const issues = checkDraft(database, draft, today, family.time_zone);
        // A link needs the expense's date in the wish's month (Design 2).
        if (draft.state.date.slice(0, 7) !== wish.month) {
          issues.push({
            path: ['date'],
            message: 'Choose a date in the wish’s month.',
          });
        }
        if (issues.length > 0) return { kind: 'invalid', issues };
        const state = draft.state;
        state.clientHash = hash;
        state.envelopeCurrency = null;
        state.envelopeAmount = null;
        const txnId = insertTransaction(database, state, hash);

        const link: StoredLink = {
          id: 0,
          wishId: id,
          wishName: wish.name,
          wishCurrency: wish.currency,
          wishMonth: wish.month,
          wishState: wish.state,
          month: state.date.slice(0, 7),
          amount: recordedLinkAmount(
            database,
            lookup,
            id,
            {
              amount: BigInt(body.amount),
              currency: state.currency,
              date: state.date,
            },
            wish,
          ),
          amountManual: false,
          madeHow: 'recorded',
          madeBy: memberId,
          madeAt: now,
        };
        saveLink(database, txnId, null, link);
        writeRevision(database, {
          txnId,
          action: 'update',
          changes: linkChanges(null, link, state.currency),
          changedBy: memberId,
          changedAt: now,
        });
        if (!body.keepOpen && wish.state !== 'done') {
          database
            .prepare(
              `UPDATE wish SET state = 'done', updated_by = ?, updated_at = ?
             WHERE id = ?`,
            )
            .run(memberId, now, id);
        }
        return { kind: 'created', txnId, previous: wish.state };
      },
    )();

    if (outcome.kind === 'not_found') return sendNotFound(reply);
    if (outcome.kind === 'not_open') {
      return reply.code(409).send({
        error: {
          code: 'wish_not_open',
          message: 'This wish is dropped or deleted.',
        },
      });
    }
    if (outcome.kind === 'conflict') {
      return reply
        .code(409)
        .send({ error: { code: 'conflict', message: outcome.message } });
    }
    if (outcome.kind === 'invalid') {
      return sendInvalid(reply, 'Check the expense.', outcome.issues);
    }
    if (outcome.kind === 'created') rates?.requestBackfill();
    const stored = readTransaction(database, outcome.txnId);
    const wish = loadWish(database, id);
    if (!stored || !wish) throw new Error('Recorded expense not found.');
    return reply.code(outcome.kind === 'created' ? 201 : 200).send(
      recordWishResponseSchema.parse({
        transaction: toTransactionResponse(stored, lookup),
        wish,
        previousState: outcome.previous,
      }),
    );
  });

  app.post('/api/wishes/:id/unrecord', async (request, reply) => {
    const params = wishIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendNotFound(reply);
    const parsed = unrecordWishRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalid(reply, 'Check the request.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const id = params.data.id;
    const { transactionId, state } = parsed.data;
    const now = clock.now().getTime();

    const outcome = database.transaction(() => {
      const wish = database
        .prepare('SELECT deleted_at AS deletedAt FROM wish WHERE id = ?')
        .get(id) as { deletedAt: bigint | null } | undefined;
      if (!wish || wish.deletedAt !== null) return 'not_found' as const;
      const stored = readTransaction(database, transactionId);
      if (
        !stored ||
        stored.link === null ||
        stored.link.wishId !== id ||
        stored.link.madeHow !== 'recorded'
      ) {
        return 'changed' as const;
      }
      writeRevision(database, {
        txnId: transactionId,
        action: 'delete',
        changes: deletedFields(stored),
        changedBy: memberId,
        changedAt: now,
      });
      // Its part and its link go with it (ON DELETE CASCADE).
      database.prepare('DELETE FROM txn WHERE id = ?').run(transactionId);
      database
        .prepare(
          `UPDATE wish SET state = ?, updated_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(state, memberId, now, id);
      return 'ok' as const;
    })();
    if (outcome === 'not_found') return sendNotFound(reply);
    if (outcome === 'changed') return sendChanged(reply);
    return wishResponseSchema.parse({ wish: loadWish(database, id) });
  });
}

/**
 * What the recorded expense counts for the wish, in the wish's currency
 * (Design 3): the wish's own figure the sheet showed (what is left, or the
 * amount) when the typed amount is that figure converted at the day's rate,
 * else the typed amount converted anew. Null when no rate exists yet.
 */
function recordedLinkAmount(
  database: Database.Database,
  lookup: ReturnType<typeof createRateLookup>,
  wishId: number,
  expense: { amount: bigint; currency: string; date: string },
  wish: WishRow,
): bigint | null {
  if (expense.currency === wish.currency) return expense.amount;
  const shown = sheetAmount(database, wishId, wish.amount);
  const shownInAccount = linkAmountFor(database, lookup, {
    amount: shown,
    currency: wish.currency,
    wishCurrency: expense.currency,
    date: expense.date,
  });
  if (shownInAccount !== null && shownInAccount === expense.amount) {
    return shown;
  }
  return linkAmountFor(database, lookup, {
    amount: expense.amount,
    currency: expense.currency,
    wishCurrency: wish.currency,
    date: expense.date,
  });
}

/**
 * The amount the record sheet starts with, in the wish's currency: what is
 * left when something is spent and some is left, else the wish's amount.
 */
function sheetAmount(
  database: Database.Database,
  wishId: number,
  amount: bigint,
): bigint {
  const wish = loadWish(database, wishId);
  if (!wish || wish.expenseCount === 0) return amount;
  const left = BigInt(wish.left);
  return left > 0n ? left : amount;
}
