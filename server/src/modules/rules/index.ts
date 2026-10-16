import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  createRuleRequestSchema,
  deleteRuleResponseSchema,
  reorderRulesRequestSchema,
  ruleIdParamsSchema,
  ruleResponseSchema,
  rulesResponseSchema,
  updateRuleRequestSchema,
  type UpdateRuleRequest,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import {
  closeRuleGaps,
  loadRules,
  writeRuleOrder,
} from '../../domain/rules.js';

/** Registers the merchant rule routes (CAT-6; O9). */
export const ruleRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  app.get('/api/rules', async () =>
    rulesResponseSchema.parse({ rules: loadRules(database) }),
  );

  app.post('/api/rules', async (request, reply) => {
    const parsed = createRuleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(reply, 'Check the rule.', parsed.error.issues);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const problem = checkReferences(database, {
      categoryId: body.categoryId,
      envelopeId: body.envelopeId ?? null,
      accountId: body.accountId ?? null,
    });
    if (problem) return sendValidation(reply, ...problem);
    const now = clock.now().getTime();

    const id = database.transaction(() => {
      const ids = (
        database.prepare('SELECT id FROM rule ORDER BY position').all() as {
          id: bigint;
        }[]
      ).map((row) => Number(row.id));
      // Inserted past the end, then moved: the order is written in one go.
      const inserted = database
        .prepare(
          `INSERT INTO rule
             (position, pattern, category_id, envelope_id, account_id,
              created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ids.length + 1,
          body.pattern,
          body.categoryId,
          body.envelopeId ?? null,
          body.accountId ?? null,
          memberId,
          now,
          memberId,
          now,
        );
      const ruleId = Number(inserted.lastInsertRowid);
      if (body.placement === 'first')
        writeRuleOrder(database, [ruleId, ...ids]);
      return ruleId;
    })();
    const rule = loadRules(database, id)[0];
    if (!rule) throw new Error('Created rule could not be reloaded.');
    return reply.code(201).send(ruleResponseSchema.parse({ rule }));
  });

  app.patch('/api/rules/:id', async (request, reply) => {
    const params = ruleIdParamsSchema.safeParse(request.params);
    const body = updateRuleRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendValidation(reply, 'Check the rule.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose a rule.' }]
          : []),
        ...(!body.success ? body.error.issues : []),
      ]);
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const { id } = params.data;
    const now = clock.now().getTime();
    const outcome = database.transaction(() =>
      updateRule(database, id, body.data, { memberId, now }),
    )();
    if (outcome === 'not_found') return sendNotFound(reply);
    if (outcome !== 'ok') return sendValidation(reply, ...outcome);
    const rule = loadRules(database, id)[0];
    if (!rule) return sendNotFound(reply);
    return ruleResponseSchema.parse({ rule });
  });

  app.put('/api/rules/order', async (request, reply) => {
    const parsed = reorderRulesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the order of the rules.',
        parsed.error.issues,
      );
    }
    const { ids } = parsed.data;
    const stale = database.transaction(() => {
      const stored = new Set(
        (database.prepare('SELECT id FROM rule').all() as { id: bigint }[]).map(
          (row) => Number(row.id),
        ),
      );
      if (stored.size !== ids.length || !ids.every((id) => stored.has(id))) {
        return true;
      }
      writeRuleOrder(database, ids);
      return false;
    })();
    if (stale) {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message: 'The rules have changed. Reload the list and try again.',
        },
      });
    }
    return rulesResponseSchema.parse({ rules: loadRules(database) });
  });

  app.delete('/api/rules/:id', async (request, reply) => {
    const params = ruleIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidation(reply, 'Check the rule.', [
        { path: ['id'], message: 'Choose a rule.' },
      ]);
    }
    const { id } = params.data;
    const deleted = database.transaction(() => {
      const result = database.prepare('DELETE FROM rule WHERE id = ?').run(id);
      if (result.changes === 0) return false;
      closeRuleGaps(database);
      return true;
    })();
    if (!deleted) return sendNotFound(reply);
    return deleteRuleResponseSchema.parse({ deleted: true });
  });
};

/** A nullable database integer as a number. */
function toNumber(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

type Problem = [string, { path: PropertyKey[]; message: string }[]];

/**
 * Applies a validated change inside the caller's transaction. A reference
 * is checked only when the request changes it, so a rule whose category was
 * archived later can still be edited.
 */
function updateRule(
  database: Database.Database,
  id: number,
  body: UpdateRuleRequest,
  context: { memberId: number; now: number },
): 'ok' | 'not_found' | Problem {
  const stored = database
    .prepare(
      `SELECT pattern, category_id AS categoryId, envelope_id AS envelopeId,
              account_id AS accountId FROM rule WHERE id = ?`,
    )
    .get(id) as
    | {
        pattern: string;
        categoryId: bigint;
        envelopeId: bigint | null;
        accountId: bigint | null;
      }
    | undefined;
  if (!stored) return 'not_found';

  const categoryId = body.categoryId ?? Number(stored.categoryId);
  const envelopeId =
    body.envelopeId === undefined
      ? toNumber(stored.envelopeId)
      : body.envelopeId;
  const accountId =
    body.accountId === undefined ? toNumber(stored.accountId) : body.accountId;
  const problem = checkReferences(database, {
    ...(categoryId === Number(stored.categoryId) ? {} : { categoryId }),
    ...(envelopeId === toNumber(stored.envelopeId) ? {} : { envelopeId }),
    ...(accountId === toNumber(stored.accountId) ? {} : { accountId }),
  });
  if (problem) return problem;

  database
    .prepare(
      `UPDATE rule SET pattern = ?, category_id = ?, envelope_id = ?,
         account_id = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      body.pattern ?? stored.pattern,
      categoryId,
      envelopeId,
      accountId,
      context.memberId,
      context.now,
      id,
    );
  return 'ok';
}

/**
 * Checks the references a request names: an expense category and an
 * envelope that are not archived, and an account that exists (O9).
 */
function checkReferences(
  database: Database.Database,
  refs: {
    categoryId?: number;
    envelopeId?: number | null;
    accountId?: number | null;
  },
): Problem | undefined {
  const issues: { path: PropertyKey[]; message: string }[] = [];
  if (refs.categoryId !== undefined) {
    const row = database
      .prepare(
        'SELECT kind, archived_at AS archivedAt FROM category WHERE id = ?',
      )
      .get(refs.categoryId) as
      { kind: string; archivedAt: bigint | null } | undefined;
    if (!row || row.kind !== 'expense' || row.archivedAt !== null) {
      issues.push({
        path: ['categoryId'],
        message: 'Choose an expense category that is not archived.',
      });
    }
  }
  if (refs.envelopeId !== undefined && refs.envelopeId !== null) {
    const row = database
      .prepare('SELECT archived_at AS archivedAt FROM envelope WHERE id = ?')
      .get(refs.envelopeId) as { archivedAt: bigint | null } | undefined;
    if (!row || row.archivedAt !== null) {
      issues.push({
        path: ['envelopeId'],
        message: 'Choose an envelope that is not archived.',
      });
    }
  }
  if (refs.accountId !== undefined && refs.accountId !== null) {
    const row = database
      .prepare('SELECT 1 AS found FROM account WHERE id = ?')
      .get(refs.accountId);
    if (!row) {
      issues.push({ path: ['accountId'], message: 'Choose an account.' });
    }
  }
  const first = issues[0];
  return first ? [first.message, issues] : undefined;
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

function sendNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'Rule not found.' },
  });
}

function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
