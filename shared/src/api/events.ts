import { z } from 'zod';

/** Path of the server-sent events stream for signed-in members. */
export const liveEventsPath = '/api/events';

/**
 * One signal on the live stream: a check-in changed, or it closed. It names
 * the check-in and nothing else; amounts, names and balances are only ever
 * read through the normal API, so the API stays the one source of truth.
 */
export const liveSignalSchema = z
  .object({
    kind: z.enum(['changed', 'closed']),
    checkinId: z.number().int().positive(),
  })
  .strict();

/** A signal read from the live stream. */
export type LiveSignal = z.infer<typeof liveSignalSchema>;
