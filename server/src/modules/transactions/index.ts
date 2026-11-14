import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  createTransactionRequestSchema,
  createTransactionResponseSchema,
  deleteTransactionResponseSchema,
  fillOnSave,
  merchantKey,
  monthOfDate,
  todayInTimeZone,
  transactionChangesSchema,
  transactionIdParamsSchema,
  transactionResponseSchema,
  updateTransactionRequestSchema,
  type CreateTransactionRequest,
  type Filled,
  type UpdateTransactionRequest,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import {
  changedFields,
  deletedFields,
  envelopeAmountFor,
  readTransaction,
  toTransactionResponse,
  writeRevision,
  type StoredTransaction,
} from '../../domain/transactions.js';
import { lookupCurrency } from '../../domain/currencies.js';
import {
  linkAmountFor,
  linkChanges,
  saveLink,
  type StoredLink,
} from '../../domain/wishLinks.js';
import { createRateLookup } from '../../rates/lookup.js';
import type { BackfillRequester } from '../../rates/service.js';

/** A validation problem of one field. */
export type Issue = { path: PropertyKey[]; message: string };

/**
 * What a create or an edit is checked with: the transaction as it would be
 * stored, and which of its fields the request sets, so a stored value that
 * has since become archived or inactive stays valid (history).
 */
export interface Draft {
  state: StoredTransaction;
  changed: (field: keyof StoredTransaction) => boolean;
  /** The request gives `amount`. */
  amountGiven: boolean;
  /** The amount arriving that the request gave for a transfer. */
  toAmountGiven: bigint | undefined;
  /** The account currencies before an edit; null for a new transaction. */
  before: { currency: string; toCurrency: string | null } | null;
}

/** Registers `POST`, `GET /:id`, `PATCH` and `DELETE` of transactions. */
export const transactionRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
  /** Asked to fetch the rates of a new date or currency (3.11). */
  rates?: BackfillRequester;
}> = async (app, options) => {
  const { database, rates } = options;
  const clock = options.clock ?? systemClock;

  function family(): { timeZone: string; today: string } {
    const row = database
      .prepare('SELECT time_zone FROM family WHERE id = 1')
      .get() as { time_zone: string } | undefined;
    if (!row) throw new Error('The family has not been set up.');
    return {
      timeZone: row.time_zone,
      today: todayInTimeZone(clock.now(), row.time_zone),
    };
  }

  // The one route a session locked by time away may call (spec 2 D2).
  const addWhileLocked = { config: { lockCheck: 'add' as const } };

  app.post('/api/transactions', addWhileLocked, async (request, reply) => {
    const parsed = createTransactionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the transaction.',
        parsed.error.issues,
      );
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const clientHash = hashBody(body);
    const { timeZone, today } = family();
    const now = clock.now().getTime();
    const lookup = createRateLookup(database);

    const outcome = database.transaction(
      ():
        | { kind: 'created' | 'repeated'; id: number; filled: Filled }
        | { kind: 'conflict'; message: string }
        | { kind: 'invalid'; issues: Issue[] } => {
        if (body.clientId !== undefined) {
          const existing = database
            .prepare(
              'SELECT id, client_hash AS hash FROM txn WHERE client_id = ?',
            )
            .get(body.clientId) as
            { id: bigint; hash: string | null } | undefined;
          if (existing) {
            return existing.hash === clientHash
              ? { kind: 'repeated', id: Number(existing.id), filled: {} }
              : {
                  kind: 'conflict',
                  message:
                    'Another transaction was already sent with this client id.',
                };
          }
          if (wasDeleted(database, body.clientId)) {
            return {
              kind: 'conflict',
              message: 'This transaction was saved and has been deleted since.',
            };
          }
        }
        const fill = fillOnSave(
          {
            kind: body.kind,
            categoryId: body.categoryId ?? null,
            envelopeId: body.envelopeId ?? null,
          },
          (id) => findCategory(database, id),
          (id) => findEnvelope(database, id),
        );
        const draft = createDraft(body, memberId, today, now);
        const issues = checkDraft(database, draft, today, timeZone);
        if (issues.length > 0) return { kind: 'invalid', issues };
        // Only what was sent is checked: a filled value is an active default.
        draft.state.categoryId = fill.categoryId;
        draft.state.envelopeId = fill.envelopeId;
        const state = settle(database, draft, lookup, true);
        const id = insertTransaction(database, state, clientHash);
        return { kind: 'created', id, filled: fill.filled };
      },
    )();

    if (outcome.kind === 'invalid') {
      return sendValidation(reply, 'Check the transaction.', outcome.issues);
    }
    if (outcome.kind === 'conflict') {
      return reply
        .code(409)
        .send({ error: { code: 'conflict', message: outcome.message } });
    }
    if (outcome.kind === 'created') rates?.requestBackfill();
    const status = outcome.kind === 'created' ? 201 : 200;
    // A locked session learns the new id and nothing else (D2).
    if (request.authContext?.locked) {
      return reply.code(status).send({ id: outcome.id });
    }
    const stored = readTransaction(database, outcome.id);
    if (!stored) throw new Error('Saved transaction could not be reloaded.');
    return reply.code(status).send(
      createTransactionResponseSchema.parse({
        transaction: toTransactionResponse(stored, lookup),
        filled: outcome.filled,
      }),
    );
  });

  app.get('/api/transactions/:id', async (request, reply) => {
    const params = transactionIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendBadId(reply);
    const stored = readTransaction(database, params.data.id);
    if (!stored) return sendNotFound(reply);
    return transactionResponse(database, stored);
  });

  app.patch('/api/transactions/:id', async (request, reply) => {
    const params = transactionIdParamsSchema.safeParse(request.params);
    const body = updateTransactionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendValidation(reply, 'Check the transaction.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose a transaction.' }]
          : []),
        ...(!body.success ? body.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { id } = params.data;
    // One choice (PLN-14): an envelope and a wish together make no sense.
    if (
      typeof body.data.wishId === 'number' &&
      typeof body.data.envelopeId === 'number'
    ) {
      return reply.code(400).send({
        error: {
          code: 'invalid',
          message: 'Choose an envelope or a wish, not both.',
          fields: { wishId: 'Choose an envelope or a wish, not both.' },
        },
      });
    }
    const { timeZone, today } = family();
    const now = clock.now().getTime();
    const lookup = createRateLookup(database);

    const outcome = database.transaction(
      ():
        | { kind: 'not_found' }
        | { kind: 'wish_not_open' }
        | { kind: 'invalid'; issues: Issue[] }
        | { kind: 'updated'; backfill: boolean } => {
        const stored = readTransaction(database, id);
        if (!stored) return { kind: 'not_found' };
        const draft = editDraft(stored, body.data);
        const issues = checkDraft(database, draft, today, timeZone);
        const linked = chooseLink(database, draft, body.data, memberId, now);
        if (linked === 'wish_not_open') return { kind: 'wish_not_open' };
        issues.push(...linked);
        // After the choice: a wish takes the expense out of its envelope.
        if (body.data.envelopeAmount !== undefined) {
          issues.push(...checkEnvelopeAmount(draft.state, body.data));
        }
        if (body.data.linkAmount !== undefined) {
          issues.push(...checkLinkAmount(draft.state, body.data));
        }
        if (issues.length > 0) return { kind: 'invalid', issues };
        // An edit never fills anything (3.5).
        const next = settle(
          database,
          draft,
          lookup,
          body.data.envelopeAmount === null,
        );
        // A typed envelope amount wins over the recomputation of the request.
        if (typeof body.data.envelopeAmount === 'string') {
          next.envelopeAmount = BigInt(body.data.envelopeAmount);
          next.envelopeAmountManual = true;
        }
        settleLink(database, draft, body.data, lookup);
        const changes = {
          ...changedFields(stored, next),
          ...linkChanges(stored.link, next.link, next.currency),
        };
        if (Object.keys(changes).length === 0) {
          return { kind: 'updated', backfill: false };
        }
        next.updatedBy = memberId;
        next.updatedAt = now;
        updateTransaction(database, next);
        saveLink(database, id, stored.link, next.link);
        writeRevision(database, {
          txnId: id,
          action: 'update',
          changes,
          changedBy: memberId,
          changedAt: now,
        });
        return {
          kind: 'updated',
          backfill: [
            'date',
            'accountId',
            'toAccountId',
            'envelopeId',
            'link',
          ].some((field) => field in changes),
        };
      },
    )();

    if (outcome.kind === 'not_found') return sendNotFound(reply);
    if (outcome.kind === 'wish_not_open') {
      return reply.code(409).send({
        error: {
          code: 'wish_not_open',
          message: 'This wish is dropped or deleted.',
        },
      });
    }
    if (outcome.kind === 'invalid') {
      return sendValidation(reply, 'Check the transaction.', outcome.issues);
    }
    if (outcome.backfill) rates?.requestBackfill();
    const stored = readTransaction(database, id);
    if (!stored) return sendNotFound(reply);
    return transactionResponse(database, stored);
  });

  app.delete('/api/transactions/:id', async (request, reply) => {
    const params = transactionIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendBadId(reply);
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { id } = params.data;
    const now = clock.now().getTime();
    const deleted = database.transaction(() => {
      const stored = readTransaction(database, id);
      if (!stored) return false;
      writeRevision(database, {
        txnId: id,
        action: 'delete',
        changes: deletedFields(stored),
        changedBy: memberId,
        changedAt: now,
      });
      // The part goes with it (ON DELETE CASCADE).
      database.prepare('DELETE FROM txn WHERE id = ?').run(id);
      return true;
    })();
    if (!deleted) return sendNotFound(reply);
    return deleteTransactionResponseSchema.parse({ deleted: true });
  });
};

/** The answer of `GET` and `PATCH`: the transaction and its record. */
function transactionResponse(
  database: Database.Database,
  stored: StoredTransaction,
) {
  const revisions = database
    .prepare(
      `SELECT id, action, changes, changed_by AS changedBy,
         changed_at AS changedAt
       FROM txn_revision WHERE txn_id = ? ORDER BY id`,
    )
    .all(stored.id) as Array<{
    id: bigint;
    action: 'update' | 'delete';
    changes: string;
    changedBy: bigint;
    changedAt: bigint;
  }>;
  return transactionResponseSchema.parse({
    transaction: toTransactionResponse(stored, createRateLookup(database)),
    revisions: revisions.map((revision) => ({
      id: Number(revision.id),
      action: revision.action,
      changes: transactionChangesSchema.parse(JSON.parse(revision.changes)),
      changedBy: Number(revision.changedBy),
      changedAt: Number(revision.changedAt),
    })),
  });
}

/**
 * SHA-256 of the validated create request with its keys in order, so a
 * retry of the same body matches whatever order the keys came in (TXN-7).
 */
function hashBody(body: CreateTransactionRequest): string {
  const ordered = Object.fromEntries(
    Object.entries(body).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

/** Whether a transaction sent with this client id was deleted since. */
export function wasDeleted(
  database: Database.Database,
  clientId: string,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 AS found FROM txn_revision WHERE action = 'delete'
           AND json_extract(changes, '$.clientId[0]') = ? LIMIT 1`,
      )
      .get(clientId) !== undefined
  );
}

/** A new transaction before the server's checks; every field is "set". */
export function createDraft(
  body: CreateTransactionRequest,
  memberId: number,
  today: string,
  now: number,
): Draft {
  const toAmount =
    body.toAmount === undefined || body.toAmount === null
      ? undefined
      : BigInt(body.toAmount);
  return {
    state: {
      id: 0,
      clientId: body.clientId ?? null,
      clientHash: null,
      kind: body.kind,
      status: 'confirmed',
      date: body.date ?? today,
      accountId: body.accountId,
      currency: '',
      amount: BigInt(body.amount),
      toAccountId: body.toAccountId ?? null,
      toCurrency: null,
      toAmount: toAmount ?? null,
      memberId: body.memberId ?? memberId,
      merchant: body.merchant ?? null,
      note: body.note ?? null,
      categoryId: body.categoryId ?? null,
      envelopeId: body.envelopeId ?? null,
      envelopeCurrency: null,
      envelopeAmount: null,
      envelopeAmountManual: false,
      envelopeName: null,
      link: null,
      source: 'typed',
      enteredAt: body.enteredAt ?? null,
      createdBy: memberId,
      createdAt: now,
      updatedBy: memberId,
      updatedAt: now,
    },
    changed: () => true,
    amountGiven: true,
    toAmountGiven: toAmount,
    before: null,
  };
}

/** A stored transaction with a change applied, before the checks. */
function editDraft(
  stored: StoredTransaction,
  body: UpdateTransactionRequest,
): Draft {
  // The link is copied: it is changed in place while the edit settles.
  const state: StoredTransaction = {
    ...stored,
    link: stored.link && { ...stored.link },
  };
  if (body.date !== undefined) state.date = body.date;
  if (body.accountId !== undefined) state.accountId = body.accountId;
  if (body.amount !== undefined) state.amount = BigInt(body.amount);
  if (body.toAccountId !== undefined) state.toAccountId = body.toAccountId;
  if (body.toAmount !== undefined) state.toAmount = BigInt(body.toAmount);
  if (body.memberId !== undefined) state.memberId = body.memberId;
  if (body.merchant !== undefined) state.merchant = body.merchant;
  if (body.note !== undefined) state.note = body.note;
  if (body.categoryId !== undefined) state.categoryId = body.categoryId;
  if (body.envelopeId !== undefined) state.envelopeId = body.envelopeId;
  return {
    state,
    changed: (field) => state[field] !== stored[field],
    amountGiven: body.amount !== undefined,
    before: { currency: stored.currency, toCurrency: stored.toCurrency },
    toAmountGiven:
      body.toAmount === undefined ? undefined : BigInt(body.toAmount),
  };
}

/**
 * The server's checks of Design 3.4 on a draft: kinds and signs, a date not
 * after today, accounts that exist and were not deactivated before the date,
 * and a payer, category and envelope that exist and fit. Archived categories
 * and envelopes and the deactivation are only checked where the request sets
 * the field (or, for accounts, the date). Fills in the account currencies.
 */
export function checkDraft(
  database: Database.Database,
  draft: Draft,
  today: string,
  timeZone: string,
): Issue[] {
  const { state, changed } = draft;
  const issues: Issue[] = [];
  const issue = (field: string, message: string) =>
    issues.push({ path: [field], message });

  if (changed('date') && state.date > today) {
    issue('date', 'A date cannot be in the future.');
  }
  if (state.kind === 'expense' && state.amount === 0n) {
    issue('amount', 'Enter an amount other than zero.');
  }
  if (state.kind !== 'expense' && state.amount <= 0n) {
    issue('amount', 'Enter an amount above zero.');
  }

  const datesMoved = changed('date');
  const account = findAccount(database, state.accountId);
  if (!account) issue('accountId', 'Choose an account.');
  else {
    state.currency = account.currency;
    // Minor units mean another value in a currency of other decimals.
    if (
      draft.before !== null &&
      !draft.amountGiven &&
      decimalsOf(database, account.currency) !==
        decimalsOf(database, draft.before.currency)
    ) {
      issue('amount', 'Enter the amount in the currency of the new account.');
    }
    if (
      (changed('accountId') || datesMoved) &&
      deactivatedBefore(account, state.date, timeZone)
    ) {
      issue('accountId', 'This account was closed before that date.');
    }
  }

  if (state.kind === 'transfer') {
    const to =
      state.toAccountId === null
        ? undefined
        : findAccount(database, state.toAccountId);
    if (state.toAccountId === null || !to) {
      issue('toAccountId', 'Choose the account the money goes to.');
    } else if (state.toAccountId === state.accountId) {
      issue('toAccountId', 'Choose two different accounts.');
    } else {
      state.toCurrency = to.currency;
      if (
        (changed('toAccountId') || datesMoved) &&
        deactivatedBefore(to, state.date, timeZone)
      ) {
        issue('toAccountId', 'This account was closed before that date.');
      }
      // A new pair of currencies needs the amount that arrives in it.
      const pairMoved =
        draft.before === null ||
        draft.before.currency !== account?.currency ||
        draft.before.toCurrency !== to.currency;
      if (account && account.currency === to.currency) {
        // One currency: the same amount arrives (TXN-4).
        if (
          draft.toAmountGiven !== undefined &&
          draft.toAmountGiven !== state.amount
        ) {
          issue(
            'toAmount',
            'Between accounts of one currency the same amount arrives.',
          );
        }
        // Only when the request touches it, so a pair that a relabel made
        // one currency keeps its stored amounts.
        if (
          pairMoved ||
          changed('amount') ||
          draft.toAmountGiven !== undefined
        ) {
          state.toAmount = state.amount;
        }
      } else if (pairMoved && draft.toAmountGiven === undefined) {
        issue('toAmount', 'Enter the amount that arrives.');
      } else if (state.toAmount === null) {
        issue('toAmount', 'Enter the amount that arrives.');
      } else if (state.toAmount <= 0n) {
        issue('toAmount', 'Enter an amount above zero.');
      }
    }
    if (state.categoryId !== null) {
      issue('categoryId', 'A transfer has no category.');
    }
  } else if (state.toAccountId !== null || state.toAmount !== null) {
    issue('toAccountId', 'Only a transfer goes to another account.');
  }

  if (state.kind !== 'expense') {
    if (state.envelopeId !== null) {
      issue('envelopeId', 'Only an expense goes to an envelope.');
    }
    if (state.merchant !== null) {
      issue('merchant', 'Only an expense has a merchant.');
    }
  }

  if (changed('memberId') && !memberExists(database, state.memberId)) {
    issue('memberId', 'Choose a profile of the family.');
  }

  if (state.categoryId !== null && changed('categoryId')) {
    const category = findCategory(database, state.categoryId);
    if (!category || category.kind !== state.kind || category.archived) {
      issue(
        'categoryId',
        state.kind === 'income'
          ? 'Choose an income category that is not archived.'
          : 'Choose an expense category that is not archived.',
      );
    }
  }
  if (state.envelopeId !== null) {
    const envelope = findEnvelope(database, state.envelopeId);
    if (!envelope || (changed('envelopeId') && envelope.archived)) {
      issue('envelopeId', 'Choose an envelope that is not archived.');
    } else {
      state.envelopeCurrency = envelope.currency;
    }
  }
  return issues;
}

type WishRow = {
  id: bigint;
  name: string;
  currency: string;
  month: string;
  state: 'open' | 'done' | 'dropped';
  deletedAt: bigint | null;
};

/**
 * Applies the request's choice of what the expense counts for (Design 2) to
 * the draft: a wish takes the expense out of its envelope; an envelope, a
 * null wish or a date in another month removes the link (O3). Only the link
 * is decided here; its amount is set by `settleLink`.
 * @returns Issues of the request, or `wish_not_open` for a dropped or
 *   deleted wish.
 */
function chooseLink(
  database: Database.Database,
  draft: Draft,
  body: UpdateTransactionRequest,
  memberId: number,
  now: number,
): Issue[] | 'wish_not_open' {
  const { state } = draft;
  const month = monthOfDate(state.date);
  let link: StoredLink | null = state.link;
  if (body.wishId === null || typeof body.envelopeId === 'number') link = null;
  if (link && link.month !== month) link = null;
  if (typeof body.wishId === 'number') {
    const unchanged =
      link !== null && link.wishId === body.wishId && link.month === month;
    if (!unchanged) {
      if (state.kind !== 'expense' || state.status !== 'confirmed') {
        return [
          {
            path: ['wishId'],
            message: 'Only a confirmed expense can count for a wish.',
          },
        ];
      }
      const wish = database
        .prepare(
          `SELECT id, name, currency, month, state, deleted_at AS deletedAt
           FROM wish WHERE id = ?`,
        )
        .get(body.wishId) as WishRow | undefined;
      if (!wish) {
        return [{ path: ['wishId'], message: 'Choose a wish.' }];
      }
      if (wish.deletedAt !== null || wish.state === 'dropped') {
        return 'wish_not_open';
      }
      if (wish.month !== month) {
        return [
          {
            path: ['wishId'],
            message: 'Choose a wish of the same month as the expense.',
          },
        ];
      }
      link = {
        id: 0,
        wishId: Number(wish.id),
        wishName: wish.name,
        wishCurrency: wish.currency,
        wishMonth: wish.month,
        wishState: wish.state,
        month,
        amount: null,
        amountManual: false,
        madeHow: 'member',
        madeBy: memberId,
        madeAt: now,
      };
    }
    // Choosing a wish takes the expense out of its envelope.
    state.envelopeId = null;
  }
  state.link = link;
  return [];
}

/**
 * Converts the link amount of a draft anew, which clears a typed one, when
 * the link is new or the amount, date, account or wish changed or the
 * request sends a null `linkAmount`; a typed `linkAmount` wins (Design 3).
 * The issues of a typed amount are returned by `checkLinkAmount` first.
 */
function settleLink(
  database: Database.Database,
  draft: Draft,
  body: UpdateTransactionRequest,
  lookup: ReturnType<typeof createRateLookup>,
): void {
  const { state, changed } = draft;
  const link = state.link;
  if (link === null) return;
  const before = link.id === 0 ? null : link;
  if (
    before === null ||
    changed('amount') ||
    changed('date') ||
    changed('accountId') ||
    body.linkAmount === null
  ) {
    link.amount = linkAmountFor(database, lookup, {
      amount: state.amount,
      currency: state.currency,
      wishCurrency: link.wishCurrency,
      date: state.date,
    });
    link.amountManual = false;
  }
  if (typeof body.linkAmount === 'string') {
    link.amount = BigInt(body.linkAmount);
    link.amountManual = true;
  }
}

/** A typed link amount needs a wish in another currency and the sign. */
function checkLinkAmount(
  state: StoredTransaction,
  body: UpdateTransactionRequest,
): Issue[] {
  if (body.linkAmount === null || body.linkAmount === undefined) return [];
  const issue = (message: string) => [{ path: ['linkAmount'], message }];
  if (state.link === null) return issue('Choose a wish first.');
  if (state.link.wishCurrency === state.currency) {
    return issue(
      'Only an expense in another currency than its wish can be typed by hand.',
    );
  }
  const amount = BigInt(body.linkAmount);
  return amount !== 0n && amount < 0n === state.amount < 0n
    ? []
    : issue('Enter an amount with the same sign as the expense.');
}

/** A typed envelope amount needs an envelope and the expense's sign. */
function checkEnvelopeAmount(
  state: StoredTransaction,
  body: UpdateTransactionRequest,
): Issue[] {
  if (body.envelopeAmount === null || body.envelopeAmount === undefined) {
    return [];
  }
  const issue = (message: string) => [{ path: ['envelopeAmount'], message }];
  if (state.envelopeId === null) return issue('Choose an envelope first.');
  // The same currency counts the expense itself (3.3, UI-TXN-5).
  if (state.envelopeCurrency === state.currency) {
    return issue(
      'Only an expense in another currency than its envelope can be ' +
        'typed by hand.',
    );
  }
  const amount = BigInt(body.envelopeAmount);
  return amount !== 0n && amount < 0n === state.amount < 0n
    ? []
    : issue('Enter an amount with the same sign as the expense.');
}

/**
 * Completes a checked draft: the envelope amount is converted again, which
 * clears a typed one, when `convert` is set or the amount, date, account or
 * envelope changed (3.3).
 */
function settle(
  database: Database.Database,
  draft: Draft,
  lookup: ReturnType<typeof createRateLookup>,
  convert: boolean,
): StoredTransaction {
  const { state, changed } = draft;
  if (
    convert ||
    changed('amount') ||
    changed('date') ||
    changed('accountId') ||
    changed('envelopeId')
  ) {
    settleEnvelope(database, state, lookup);
  }
  return state;
}

/** Converts the envelope amount of a state anew (3.3). */
export function settleEnvelope(
  database: Database.Database,
  state: StoredTransaction,
  lookup: ReturnType<typeof createRateLookup>,
): void {
  state.envelopeAmountManual = false;
  if (state.envelopeId === null) {
    state.envelopeCurrency = null;
    state.envelopeAmount = null;
    return;
  }
  const envelope = findEnvelope(database, state.envelopeId);
  if (!envelope) throw new Error('The envelope disappeared.');
  state.envelopeCurrency = envelope.currency;
  state.envelopeAmount = envelopeAmountFor(database, lookup, {
    amount: state.amount,
    currency: state.currency,
    envelopeCurrency: envelope.currency,
    date: state.date,
  });
}

export function insertTransaction(
  database: Database.Database,
  state: StoredTransaction,
  clientHash: string,
): number {
  const inserted = database
    .prepare(
      `INSERT INTO txn (client_id, client_hash, kind, status, date, account_id,
         amount, to_account_id, to_amount, member_id, merchant, merchant_key,
         note, source, entered_at, created_by, created_at, updated_by,
         updated_at)
       VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'typed', ?, ?,
         ?, ?, ?)`,
    )
    .run(
      state.clientId,
      state.clientId === null ? null : clientHash,
      state.kind,
      state.date,
      state.accountId,
      state.amount,
      state.toAccountId,
      state.toAmount,
      state.memberId,
      state.merchant,
      state.merchant === null ? null : merchantKey(state.merchant),
      state.note,
      state.enteredAt,
      state.createdBy,
      state.createdAt,
      state.updatedBy,
      state.updatedAt,
    );
  const id = Number(inserted.lastInsertRowid);
  if (state.kind !== 'transfer') writePart(database, { ...state, id });
  return id;
}

/** Stores an edited state and its one part; the caller writes the revision. */
export function updateTransaction(
  database: Database.Database,
  state: StoredTransaction,
): void {
  database
    .prepare(
      `UPDATE txn SET date = ?, account_id = ?, amount = ?, to_account_id = ?,
         to_amount = ?, member_id = ?, merchant = ?, merchant_key = ?,
         note = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      state.date,
      state.accountId,
      state.amount,
      state.toAccountId,
      state.toAmount,
      state.memberId,
      state.merchant,
      state.merchant === null ? null : merchantKey(state.merchant),
      state.note,
      state.updatedBy,
      state.updatedAt,
      state.id,
    );
  if (state.kind !== 'transfer') writePart(database, state);
}

/** Writes the one part of an expense or income (D5), equal to its amount. */
function writePart(database: Database.Database, state: StoredTransaction) {
  database
    .prepare(
      `INSERT INTO txn_part (txn_id, position, amount, category_id,
         envelope_id, envelope_amount, envelope_amount_manual)
       VALUES (?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT (txn_id, position) DO UPDATE SET amount = excluded.amount,
         category_id = excluded.category_id,
         envelope_id = excluded.envelope_id,
         envelope_amount = excluded.envelope_amount,
         envelope_amount_manual = excluded.envelope_amount_manual`,
    )
    .run(
      state.id,
      state.amount,
      state.categoryId,
      state.envelopeId,
      state.envelopeAmount,
      state.envelopeAmountManual ? 1 : 0,
    );
}

type AccountRow = {
  currency: string;
  active: boolean;
  deactivatedAt: number | null;
};

function findAccount(
  database: Database.Database,
  id: number,
): AccountRow | undefined {
  const row = database
    .prepare(
      `SELECT currency, active, deactivated_at AS deactivatedAt
       FROM account WHERE id = ?`,
    )
    .get(id) as
    | { currency: string; active: bigint; deactivatedAt: bigint | null }
    | undefined;
  return row
    ? {
        currency: row.currency,
        active: row.active === 1n,
        deactivatedAt:
          row.deactivatedAt === null ? null : Number(row.deactivatedAt),
      }
    : undefined;
}

/**
 * Whether an inactive account was deactivated on a day before `date` in the
 * family time zone (3.4). A transaction on the day it closed is allowed, so
 * the last withdrawal can still be recorded.
 */
function deactivatedBefore(
  account: AccountRow,
  date: string,
  timeZone: string,
): boolean {
  if (account.active) return false;
  if (account.deactivatedAt === null) return true;
  return todayInTimeZone(new Date(account.deactivatedAt), timeZone) < date;
}

/**
 * The decimals of a stored currency code.
 * @throws {Error} if the code is unknown, which stored data never is.
 */
function decimalsOf(database: Database.Database, code: string): number {
  const currency = lookupCurrency(database, code);
  if (!currency) throw new Error(`Unknown stored currency ${code}.`);
  return currency.decimals;
}

function memberExists(database: Database.Database, id: number): boolean {
  return (
    database.prepare('SELECT 1 AS found FROM member WHERE id = ?').get(id) !==
    undefined
  );
}

/** Reads a category for the checks and the on-save fill. */
export function findCategory(database: Database.Database, id: number) {
  const row = database
    .prepare(
      `SELECT kind, default_envelope_id AS defaultEnvelopeId,
         archived_at AS archivedAt FROM category WHERE id = ?`,
    )
    .get(id) as
    | {
        kind: 'expense' | 'income';
        defaultEnvelopeId: bigint | null;
        archivedAt: bigint | null;
      }
    | undefined;
  return row
    ? {
        kind: row.kind,
        defaultEnvelopeId:
          row.defaultEnvelopeId === null ? null : Number(row.defaultEnvelopeId),
        archived: row.archivedAt !== null,
      }
    : undefined;
}

/** Reads an envelope for the checks and the on-save fill. */
export function findEnvelope(database: Database.Database, id: number) {
  const row = database
    .prepare(
      `SELECT currency, default_category_id AS defaultCategoryId,
         archived_at AS archivedAt FROM envelope WHERE id = ?`,
    )
    .get(id) as
    | {
        currency: string;
        defaultCategoryId: bigint | null;
        archivedAt: bigint | null;
      }
    | undefined;
  return row
    ? {
        currency: row.currency,
        defaultCategoryId:
          row.defaultCategoryId === null ? null : Number(row.defaultCategoryId),
        archived: row.archivedAt !== null,
      }
    : undefined;
}

function sendValidation(
  reply: FastifyReply,
  message: string,
  issues: readonly Issue[],
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

function sendBadId(reply: FastifyReply) {
  return sendValidation(reply, 'Check the transaction.', [
    { path: ['id'], message: 'Choose a transaction.' },
  ]);
}

function sendNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'Transaction not found.' },
  });
}

function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
