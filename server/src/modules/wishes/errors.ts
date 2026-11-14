import type { FastifyReply } from 'fastify';

/** One validation problem: the field it belongs to and what to tell. */
export type Issue = { path: PropertyKey[]; message: string };

/** Answers 400 `invalid` with the first message of each field. */
export function sendInvalid(
  reply: FastifyReply,
  message: string,
  issues: readonly Issue[],
) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    fields[field] ??= issue.message;
  }
  return reply.code(400).send({ error: { code: 'invalid', message, fields } });
}

/** Answers 404 `not_found` for a wish. */
export function sendNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'not_found', message: 'Wish not found.' },
  });
}

/** Answers 409 `changed`: someone changed the wish meanwhile. */
export function sendChanged(reply: FastifyReply) {
  return reply.code(409).send({
    error: { code: 'changed', message: 'Someone changed it meanwhile.' },
  });
}

/** Answers 403 `profile_required`. */
export function sendProfileRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: 'profile_required', message: 'Choose a profile first.' },
  });
}
