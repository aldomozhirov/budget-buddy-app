import type { FastifyInstance } from 'fastify';

/** API routes that answer without a session (`auth: 'open'`). */
export const openRoutes = new Set([
  'GET /api/health',
  'HEAD /api/health',
  'GET /api/setup',
  'HEAD /api/setup',
  'POST /api/setup',
  'GET /api/auth/device',
  'HEAD /api/auth/device',
  'POST /api/auth/sign-in',
  'POST /api/auth/passkey/authenticate/options',
  'POST /api/auth/passkey/authenticate/verify',
]);

/**
 * Every `/api/` route the app has registered, one entry per method, with
 * path parameters left as written (`/api/envelopes/:id`).
 */
export function apiRouteTable(
  app: FastifyInstance,
): Array<{ method: string; url: string }> {
  return app
    .printRoutes({ commonPrefix: false })
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^[├└]── (\/api\/\S+) \(([^)]+)\)$/u);
      if (!match) return [];
      const [, url, methods] = match;
      return methods!.split(', ').map((method) => ({ url: url!, method }));
    });
}
