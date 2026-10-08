import type { FastifyInstance } from 'fastify';

/** Adds a same-origin check to every state-changing API request. */
export async function installCsrfPlugin(
  app: FastifyInstance,
  options: { appOrigins: string[] },
): Promise<void> {
  const allowedOrigins = new Set(
    options.appOrigins.map((origin) => new URL(origin).origin),
  );

  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.url.startsWith('/api/') ||
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      return;
    }

    const contentType = request.headers['content-type']
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const origin = request.headers.origin;
    const validOrigin =
      origin !== undefined
        ? isAllowedOrigin(origin, allowedOrigins)
        : request.headers['sec-fetch-site'] === 'same-origin';

    if (contentType === 'application/json' && validOrigin) return;

    return reply.code(403).send({
      error: {
        code: 'forbidden_state',
        message: 'Request not allowed.',
      },
    });
  });
}

function isAllowedOrigin(origin: string, allowedOrigins: Set<string>): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}
