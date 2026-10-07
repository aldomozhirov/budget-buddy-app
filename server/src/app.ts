import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type Database from 'better-sqlite3';
import { healthRoutes } from './modules/health/index.js';

const webDistPath = fileURLToPath(new URL('../../web/dist', import.meta.url));

const redactedPaths = [
  'password',
  'currentPassword',
  'newPassword',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers.set-cookie',
  'p256dh',
  'auth',
  'publicKey',
  'credentialId',
  'privateKey',
  'req.body.publicKey',
  'req.body.credentialId',
  'req.body.attestationObject',
  'req.body.response',
  'subscription.keys.p256dh',
  'subscription.keys.auth',
];

export type AppOptions = {
  database: Database.Database;
  logger?: boolean;
  loggerStream?: { write(message: string): void };
  staticRoot?: string;
};

export async function createApp(options: AppOptions) {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            ...(options.loggerStream ? { stream: options.loggerStream } : {}),
            redact: { paths: redactedPaths, censor: '[Redacted]' },
          },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(healthRoutes, { database: options.database });

  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as Error & {
      statusCode?: number;
      validation?: unknown;
    };
    if (fastifyError.validation) {
      return reply
        .code(400)
        .send({ error: { code: 'validation', message: 'Invalid request' } });
    }
    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode >= 500) request.log.error(error);
    const code =
      statusCode === 400
        ? 'validation'
        : statusCode === 401
          ? 'unauthenticated'
          : statusCode === 403
            ? 'forbidden_state'
            : statusCode === 404
              ? 'not_found'
              : statusCode === 409
                ? 'conflict'
                : statusCode === 423
                  ? 'locked'
                  : 'internal';
    const message =
      statusCode >= 500 ? 'Internal server error' : fastifyError.message;
    return reply.code(statusCode).send({ error: { code, message } });
  });

  const staticRoot = options.staticRoot ?? webDistPath;
  let staticAssetsAvailable = false;
  try {
    await access(staticRoot);
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/' });
    staticAssetsAvailable = true;
  } catch {
    // During development the Vite server serves the web app.
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'Not found' } });
    }
    if (request.method === 'GET' && staticAssetsAvailable) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply
      .code(404)
      .send({ error: { code: 'not_found', message: 'Not found' } });
  });

  return app;
}

export function webAssetsPath(): string {
  return path.resolve(webDistPath);
}

export { redactedPaths };
