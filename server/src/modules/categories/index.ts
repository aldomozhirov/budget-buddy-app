import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  categoriesQuerySchema,
  categoriesResponseSchema,
  categoryIdParamsSchema,
  categoryResponseSchema,
  createCategoryRequestSchema,
  deleteCategoryResponseSchema,
  todayInTimeZone,
  updateCategoryRequestSchema,
  type Category,
  type UpdateCategoryRequest,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { closeRuleGaps } from '../../domain/rules.js';

/** Registers the category routes (CAT-1 to CAT-3; O13). */
export const categoryRoutes: FastifyPluginAsync<{
  database: Database.Database;
  clock?: Clock;
}> = async (app, options) => {
  const { database } = options;
  const clock = options.clock ?? systemClock;

  /** This calendar year in the family time zone. */
  const thisYear = (): string => {
    const family = database
      .prepare('SELECT time_zone FROM family WHERE id = 1')
      .get() as { time_zone: string } | undefined;
    if (!family) throw new Error('The family has not been set up.');
    return todayInTimeZone(clock.now(), family.time_zone).slice(0, 4);
  };

  app.get('/api/categories', async (request, reply) => {
    const parsed = categoriesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the category filters.',
        parsed.error.issues,
      );
    }
    const categories = loadCategories(database, thisYear(), {
      kind: parsed.data.kind,
    });
    return categoriesResponseSchema.parse({ categories });
  });

  app.post('/api/categories', async (request, reply) => {
    const parsed = createCategoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidation(
        reply,
        'Check the category details.',
        parsed.error.issues,
      );
    }
    const memberId = request.authContext?.memberId;
    if (memberId === null || memberId === undefined) {
      return sendProfileRequired(reply);
    }
    const body = parsed.data;
    const envelopeId = body.defaultEnvelopeId ?? null;
    const problem = checkDefaultEnvelope(database, body.kind, envelopeId);
    if (problem) return sendValidation(reply, ...problem);
    const now = clock.now().getTime();

    const outcome = database.transaction(() => {
      const clash = nameClash(database, body.kind, body.name);
      if (clash) return clash;
      // Positions run across both kinds (task 1), so the next one is last.
      const position = database
        .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM category')
        .get() as { next: bigint };
      const inserted = database
        .prepare(
          `INSERT INTO category
             (name, kind, default_envelope_id, position, created_by,
              created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          body.name,
          body.kind,
          envelopeId,
          position.next,
          memberId,
          now,
          memberId,
          now,
        );
      return Number(inserted.lastInsertRowid);
    })();
    if (typeof outcome !== 'number') return sendNameTaken(reply, outcome);
    const category = loadCategories(database, thisYear(), { id: outcome })[0];
    if (!category) throw new Error('Created category could not be reloaded.');
    return reply.code(201).send(categoryResponseSchema.parse({ category }));
  });

  app.patch('/api/categories/:id', async (request, reply) => {
    const params = categoryIdParamsSchema.safeParse(request.params);
    const body = updateCategoryRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendValidation(reply, 'Check the category details.', [
        ...(!params.success
          ? [{ path: ['id'], message: 'Choose a category.' }]
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
      updateCategory(database, id, body.data, { memberId, now }),
    )();
    if (outcome.kind === 'not_found') return sendNotFound(reply);
    if (outcome.kind === 'name_taken') {
      return sendNameTaken(reply, outcome);
    }
    if (outcome.kind === 'invalid') {
      return sendValidation(reply, outcome.message, outcome.issues);
    }
    const category = loadCategories(database, thisYear(), { id })[0];
    if (!category) return sendNotFound(reply);
    return categoryResponseSchema.parse({ category });
  });

  app.delete('/api/categories/:id', async (request, reply) => {
    const params = categoryIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidation(reply, 'Check the category.', [
        { path: ['id'], message: 'Choose a category.' },
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
        .prepare('SELECT 1 AS found FROM category WHERE id = ?')
        .get(id);
      if (!exists) return 'not_found' as const;
      const used = database
        .prepare('SELECT 1 AS found FROM txn_part WHERE category_id = ?')
        .get(id);
      if (used) return 'used' as const;
      // An envelope that only names it as its default stops naming it.
      database
        .prepare(
          `UPDATE envelope SET default_category_id = NULL, updated_by = ?,
             updated_at = ? WHERE default_category_id = ?`,
        )
        .run(memberId, now, id);
      const rules = database
        .prepare('DELETE FROM rule WHERE category_id = ?')
        .run(id);
      database.prepare('DELETE FROM category WHERE id = ?').run(id);
      closeRuleGaps(database);
      return Number(rules.changes);
    })();
    if (result === 'not_found') return sendNotFound(reply);
    if (result === 'used') {
      return reply.code(409).send({
        error: {
          code: 'conflict',
          message:
            'A category with transactions cannot be deleted. Archive it ' +
            'instead.',
        },
      });
    }
    return deleteCategoryResponseSchema.parse({
      deleted: true,
      deletedRules: result,
    });
  });
};

interface CategoryRow {
  id: bigint;
  name: string;
  kind: 'expense' | 'income';
  defaultEnvelopeId: bigint | null;
  position: bigint;
  archivedAt: bigint | null;
  usedThisYear: bigint;
  used: bigint;
  ruleCount: bigint;
  createdBy: bigint | null;
  createdAt: bigint;
  updatedBy: bigint | null;
  updatedAt: bigint;
}

/** Categories in list order, with their use; one when `id` is given. */
function loadCategories(
  database: Database.Database,
  year: string,
  filter: { kind?: 'expense' | 'income' | undefined; id?: number },
): Category[] {
  const rows = database
    .prepare(
      `SELECT c.id, c.name, c.kind, c.default_envelope_id AS defaultEnvelopeId,
              c.position, c.archived_at AS archivedAt,
              (SELECT COUNT(*) FROM txn_part p JOIN txn t ON t.id = p.txn_id
                WHERE p.category_id = c.id AND t.status = 'confirmed'
                  AND t.date >= ? AND t.date <= ?) AS usedThisYear,
              EXISTS (SELECT 1 FROM txn_part p
                       WHERE p.category_id = c.id) AS used,
              (SELECT COUNT(*) FROM rule r
                WHERE r.category_id = c.id) AS ruleCount,
              c.created_by AS createdBy, c.created_at AS createdAt,
              c.updated_by AS updatedBy, c.updated_at AS updatedAt
         FROM category c
        WHERE (? IS NULL OR c.kind = ?) AND (? IS NULL OR c.id = ?)
        ORDER BY c.position, c.id`,
    )
    .all(
      `${year}-01-01`,
      `${year}-12-31`,
      filter.kind ?? null,
      filter.kind ?? null,
      filter.id ?? null,
      filter.id ?? null,
    ) as CategoryRow[];
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    kind: row.kind,
    defaultEnvelopeId:
      row.defaultEnvelopeId === null ? null : Number(row.defaultEnvelopeId),
    position: Number(row.position),
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt === null ? null : Number(row.archivedAt),
    usedThisYear: Number(row.usedThisYear),
    used: row.used !== 0n,
    ruleCount: Number(row.ruleCount),
    createdBy: row.createdBy === null ? null : Number(row.createdBy),
    createdAt: Number(row.createdAt),
    updatedBy: row.updatedBy === null ? null : Number(row.updatedBy),
    updatedAt: Number(row.updatedAt),
  }));
}

type UpdateOutcome =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'name_taken'; archived: boolean }
  | {
      kind: 'invalid';
      message: string;
      issues: { path: PropertyKey[]; message: string }[];
    };

/** Applies a validated change inside the caller's transaction. */
function updateCategory(
  database: Database.Database,
  id: number,
  body: UpdateCategoryRequest,
  context: { memberId: number; now: number },
): UpdateOutcome {
  const { memberId, now } = context;
  const stored = database
    .prepare(
      `SELECT kind, name, default_envelope_id AS defaultEnvelopeId,
              archived_at AS archivedAt
         FROM category WHERE id = ?`,
    )
    .get(id) as
    | {
        kind: 'expense' | 'income';
        name: string;
        defaultEnvelopeId: bigint | null;
        archivedAt: bigint | null;
      }
    | undefined;
  if (!stored) return { kind: 'not_found' };

  if (body.name !== undefined) {
    const clash = nameClash(database, stored.kind, body.name, id);
    if (clash) return { kind: 'name_taken', archived: clash.archived };
  }
  if (body.defaultEnvelopeId !== undefined) {
    const problem = checkDefaultEnvelope(
      database,
      stored.kind,
      body.defaultEnvelopeId,
    );
    if (problem) {
      return { kind: 'invalid', message: problem[0], issues: problem[1] };
    }
  }

  const archivedAt =
    body.archived === undefined
      ? stored.archivedAt
      : body.archived
        ? (stored.archivedAt ?? BigInt(now))
        : null;
  database
    .prepare(
      `UPDATE category SET name = ?, default_envelope_id = ?, archived_at = ?,
         updated_by = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      body.name ?? stored.name,
      body.defaultEnvelopeId === undefined
        ? stored.defaultEnvelopeId
        : body.defaultEnvelopeId,
      archivedAt,
      memberId,
      now,
      id,
    );
  return { kind: 'ok' };
}

/**
 * Another category of the kind with the name, ignoring case, archived ones
 * included (CAT-1); `exceptId` leaves out the category being renamed.
 */
function nameClash(
  database: Database.Database,
  kind: 'expense' | 'income',
  name: string,
  exceptId?: number,
): { archived: boolean } | undefined {
  const row = database
    .prepare(
      `SELECT archived_at AS archivedAt FROM category
        WHERE kind = ? AND unicode_casefold(name) = unicode_casefold(?)
          AND id <> ?`,
    )
    .get(kind, name, exceptId ?? 0) as
    { archivedAt: bigint | null } | undefined;
  return row ? { archived: row.archivedAt !== null } : undefined;
}

/** A default envelope is for expenses only, and must exist and be active. */
function checkDefaultEnvelope(
  database: Database.Database,
  kind: 'expense' | 'income',
  envelopeId: number | null,
): [string, { path: PropertyKey[]; message: string }[]] | undefined {
  if (envelopeId === null) return undefined;
  let message: string | undefined;
  if (kind !== 'expense') {
    message = 'Only an expense category can have a default envelope.';
  } else {
    const row = database
      .prepare('SELECT archived_at AS archivedAt FROM envelope WHERE id = ?')
      .get(envelopeId) as { archivedAt: bigint | null } | undefined;
    if (!row || row.archivedAt !== null) {
      message = 'Choose an envelope that is not archived.';
    }
  }
  if (message === undefined) return undefined;
  return [message, [{ path: ['defaultEnvelopeId'], message }]];
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

function sendNameTaken(reply: FastifyReply, clash: { archived: boolean }) {
  const message = clash.archived
    ? 'An archived category has this name. Restore it instead.'
    : 'A category with that name already exists.';
  return reply.code(409).send({
    error: { code: 'conflict', message, fields: { name: message } },
  });
}

function sendNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'Category not found.' },
  });
}

function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
