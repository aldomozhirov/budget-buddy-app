import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  fillOnSave,
  labelTransactionsRequestSchema,
  labelTransactionsResponseSchema,
  needsCategoryQuerySchema,
  needsCategoryResponseSchema,
  toMinorString,
  todayInTimeZone,
  type NeedsCategoryRow,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { createRowSuggester } from '../../domain/suggestions.js';
import {
  changedFields,
  readTransaction,
  writeRevision,
  type StoredTransaction,
} from '../../domain/transactions.js';
import { createRateLookup } from '../../rates/lookup.js';
import type { BackfillRequester } from '../../rates/service.js';
import {
  findCategory,
  findEnvelope,
  settleEnvelope,
  updateTransaction,
} from './index.js';

/** Rows in a page of "Needs a category" (Design 5). */
const pageSize = 50;

/**
 * What waits: confirmed expenses (refunds included) and incomes whose part
 * has no category; a transfer never does (O7).
 */
const waiting = `t.status = 'confirmed' AND t.kind <> 'transfer'
  AND p.category_id IS NULL`;

/**
 * How many transactions wait for a category: the tab's count and Home's
 * "Needs a category" row.
 */
export function needsCategoryCount(database: Database.Database): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS n FROM txn t
         JOIN txn_part p ON p.txn_id = t.id WHERE ${waiting}`,
    )
    .get() as { n: bigint };
  return Number(row.n);
}

/**
 * Registers `GET /api/transactions/needs-category` and
 * `POST /api/transactions/label` (CAT-7, UI-TXN-3; O7, O8): the
 * transactions without a category with a suggestion each, and labelling
 * several at once or taking it back. Labelling writes revisions like an
 * edit does (MEM-5).
 */
export const needsCategoryRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
  /** Asked to fetch the rates a newly filled envelope may need (3.11). */
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

  app.get('/api/transactions/needs-category', async (request, reply) => {
    const parsed = needsCategoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidation(reply, 'Check the page asked for.', {
        cursor: parsed.error.issues[0]?.message ?? 'Use the cursor given.',
      });
    }
    const { timeZone, today } = family();
    const params: (string | number)[] = [];
    let after = '';
    if (parsed.data.cursor !== undefined) {
      const [date = '', id = ''] = parsed.data.cursor.split(':');
      after = 'AND (t.date < ? OR (t.date = ? AND t.id < ?))';
      params.push(date, date, Number(id));
    }
    const rows = database
      .prepare(
        `SELECT t.id, t.kind, t.date, t.account_id AS accountId,
                a.name AS accountName, a.currency, t.amount,
                t.member_id AS memberId, m.name AS memberName, t.merchant,
                p.envelope_id AS envelopeId
           FROM txn t
           JOIN txn_part p ON p.txn_id = t.id
           JOIN account a ON a.id = t.account_id
           JOIN member m ON m.id = t.member_id
          WHERE ${waiting} ${after}
          ORDER BY t.date DESC, t.id DESC LIMIT ?`,
      )
      .all(...params, pageSize + 1) as Array<{
      id: bigint;
      kind: 'expense' | 'income';
      date: string;
      accountId: bigint;
      accountName: string;
      currency: string;
      amount: bigint;
      memberId: bigint;
      memberName: string;
      merchant: string | null;
      envelopeId: bigint | null;
    }>;
    const page = rows.slice(0, pageSize);
    const suggest = createRowSuggester(database, { today, timeZone });
    const names = new Map(
      (
        database.prepare('SELECT id, name FROM category').all() as Array<{
          id: bigint;
          name: string;
        }>
      ).map((row) => [Number(row.id), row.name]),
    );
    const last = page.at(-1);
    return needsCategoryResponseSchema.parse({
      transactions: page.map((row): NeedsCategoryRow => {
        const categoryId = suggest({
          kind: row.kind,
          merchant: row.merchant,
          accountId: Number(row.accountId),
          memberId: Number(row.memberId),
          envelopeId: row.envelopeId === null ? null : Number(row.envelopeId),
        });
        return {
          id: Number(row.id),
          kind: row.kind,
          date: row.date,
          accountId: Number(row.accountId),
          accountName: row.accountName,
          currency: row.currency,
          amount: toMinorString(row.amount),
          memberId: Number(row.memberId),
          memberName: row.memberName,
          merchant: row.merchant,
          suggestion:
            categoryId === null
              ? null
              : {
                  categoryId,
                  categoryName: names.get(categoryId) ?? '',
                },
        };
      }),
      nextCursor:
        rows.length > pageSize && last ? `${last.date}:${last.id}` : null,
      count: needsCategoryCount(database),
    });
  });

  app.post('/api/transactions/label', async (request, reply) => {
    const parsed = labelTransactionsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(reply, 'Check what to label.', {
        [String(parsed.error.issues[0]?.path[0] ?? 'items')]:
          parsed.error.issues[0]?.message ?? 'Check what to label.',
      });
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return reply.code(403).send({
        error: { code: 'profile_required', message: 'Choose a profile first.' },
      });
    }
    const now = clock.now().getTime();
    const lookup = createRateLookup(database);

    const outcome = database.transaction(
      ():
        | { kind: 'invalid'; message: string }
        | {
            kind: 'done';
            labelled: Array<{
              id: number;
              categoryId: number | null;
              filledEnvelopeId: number | null;
              filledEnvelopeName: string | null;
            }>;
            skipped: number[];
            envelopeFilled: boolean;
          } => {
        // Check everything first, so a refusal leaves nothing half done.
        const plan: Array<{
          stored: StoredTransaction;
          categoryId: number | null;
          takeBack: number | undefined;
        }> = [];
        const skipped: number[] = [];
        for (const item of parsed.data.items) {
          const stored = readTransaction(database, item.id);
          if (!stored || stored.status !== 'confirmed') {
            skipped.push(item.id);
            continue;
          }
          if (stored.kind === 'transfer') {
            return { kind: 'invalid', message: 'A transfer has no category.' };
          }
          // Labelling needs a row that still waits, taking it back one that
          // was labelled; anything else changed since the list was read.
          if ((item.categoryId === null) !== (stored.categoryId !== null)) {
            skipped.push(item.id);
            continue;
          }
          if (item.categoryId !== null) {
            const category = findCategory(database, item.categoryId);
            if (
              !category ||
              category.archived ||
              category.kind !== stored.kind
            ) {
              return {
                kind: 'invalid',
                message:
                  stored.kind === 'income'
                    ? 'Choose an income category that is not archived.'
                    : 'Choose an expense category that is not archived.',
              };
            }
          }
          plan.push({
            stored,
            categoryId: item.categoryId,
            takeBack: item.takeBackEnvelopeId,
          });
        }

        const labelled = [];
        let envelopeFilled = false;
        for (const { stored, categoryId, takeBack } of plan) {
          const next: StoredTransaction = { ...stored };
          let filledEnvelopeId: number | null = null;
          if (categoryId !== null) {
            // The one place an envelope is filled after saving (O7).
            const fill = fillOnSave(
              {
                kind: stored.kind,
                categoryId,
                envelopeId: stored.envelopeId,
              },
              (id) => findCategory(database, id),
              (id) => findEnvelope(database, id),
            );
            next.categoryId = categoryId;
            if (fill.filled.envelope === 'category') {
              next.envelopeId = fill.envelopeId;
              filledEnvelopeId = fill.envelopeId;
              settleEnvelope(database, next, lookup);
              envelopeFilled = true;
            }
          } else {
            next.categoryId = null;
            if (takeBack !== undefined && stored.envelopeId === takeBack) {
              next.envelopeId = null;
              settleEnvelope(database, next, lookup);
            }
          }
          next.updatedBy = memberId;
          next.updatedAt = now;
          updateTransaction(database, next);
          writeRevision(database, {
            txnId: stored.id,
            action: 'update',
            changes: changedFields(stored, next),
            changedBy: memberId,
            changedAt: now,
          });
          labelled.push({
            id: stored.id,
            categoryId,
            filledEnvelopeId,
            filledEnvelopeName:
              filledEnvelopeId === null
                ? null
                : (
                    database
                      .prepare('SELECT name FROM envelope WHERE id = ?')
                      .get(filledEnvelopeId) as { name: string }
                  ).name,
          });
        }
        return { kind: 'done', labelled, skipped, envelopeFilled };
      },
    )();

    if (outcome.kind === 'invalid') {
      return sendValidation(reply, outcome.message, {
        items: outcome.message,
      });
    }
    if (outcome.envelopeFilled) rates?.requestBackfill();
    return labelTransactionsResponseSchema.parse({
      labelled: outcome.labelled,
      skipped: outcome.skipped,
      count: needsCategoryCount(database),
    });
  });
};

function sendValidation(
  reply: FastifyReply,
  message: string,
  fields: Record<string, string>,
) {
  return reply
    .code(400)
    .send({ error: { code: 'validation', message, fields } });
}
