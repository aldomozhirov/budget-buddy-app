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
import { systemClock, type Clock } from './clock.js';
import { installCsrfPlugin } from './plugins/csrf.js';
import { installSessionPlugin } from './plugins/session.js';
import { authRoutes } from './modules/auth/index.js';
import { healthRoutes } from './modules/health/index.js';
import { setupRoutes } from './modules/setup/index.js';
import { memberRoutes } from './modules/members/index.js';
import { familyRoutes } from './modules/family/index.js';
import { currenciesRoutes } from './modules/currencies/index.js';
import { settingsRoutes } from './modules/settings/index.js';
import { accountRoutes } from './modules/accounts/index.js';
import { snapshotRoutes } from './modules/snapshots/index.js';
import { checkinRoutes } from './modules/checkins/index.js';
import { createCheckinEventBus, type CheckinEventBus } from './events.js';

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
  /** Database opened with WAL, foreign keys and migrations by `openDatabase`. */
  database: Database.Database;
  /** Disable request logging in tests; production logging is redacted by default. */
  logger?: boolean;
  /** Optional Pino-compatible sink used to inspect redaction in tests. */
  loggerStream?: { write(message: string): void };
  /** Override the production `web/dist` root, primarily for isolated tests. */
  staticRoot?: string;
  /** Whether authentication cookies should carry the Secure attribute. */
  secureCookies?: boolean;
  /** Web origins allowed to make state-changing requests. */
  appOrigins?: string[];
  /** Clock supplied to time-sensitive routes so timestamps can be tested. */
  clock?: Clock;
  /** Event bus shared with background consumers of check-in lifecycle events. */
  events?: CheckinEventBus;
};

/**
 * Creates the Fastify API and static shell. The database is opened and migrated
 * by startup code; `staticRoot`, logging and the log stream are injectable for tests.
 */
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
  const events =
    options.events ??
    createCheckinEventBus((error) =>
      app.log.error(error, 'Check-in event failed'),
    );

  const appOrigins = options.appOrigins ?? ['http://127.0.0.1:5173'];
  const secureCookies = options.secureCookies ?? true;
  const clock = options.clock ?? systemClock;
  await installCsrfPlugin(app, { appOrigins });
  await installSessionPlugin(app, {
    database: options.database,
    secureCookies,
    clock,
  });

  await app.register(healthRoutes, { database: options.database });
  await app.register(setupRoutes, {
    database: options.database,
    secureCookies,
    clock,
  });
  await app.register(authRoutes, {
    database: options.database,
    secureCookies,
    clock,
  });
  await app.register(memberRoutes, {
    database: options.database,
    clock,
  });
  await app.register(familyRoutes, { database: options.database });
  await app.register(currenciesRoutes, {
    database: options.database,
    clock,
  });
  await app.register(settingsRoutes, { database: options.database });
  await app.register(accountRoutes, { database: options.database, clock });
  await app.register(snapshotRoutes, { database: options.database, clock });
  await app.register(checkinRoutes, {
    database: options.database,
    clock,
    events,
  });

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

/** Returns the resolved static asset directory used by the production server. */
export function webAssetsPath(): string {
  return path.resolve(webDistPath);
}

export { redactedPaths };
