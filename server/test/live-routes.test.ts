import { get, type ClientRequest } from 'node:http';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCheckinEventBus } from '../src/events.js';
import { createLiveHub, type LiveHub } from '../src/live/hub.js';
import { liveRoutes } from '../src/live/routes.js';

/**
 * The stream route on a bare app, with the session plugin replaced by a hook
 * that sets the one context the route reads, so that a test can break the
 * socket or the database at an exact point.
 */
describe('live stream route, lifecycle edge cases', () => {
  let database: Database.Database;
  let hub: LiveHub;
  let app: FastifyInstance;
  let port: number;
  const requests: ClientRequest[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);

  async function start(options: {
    beforeHandler?: (raw: import('node:http').IncomingMessage) => Promise<void>;
    onRequest?: (reply: import('fastify').FastifyReply) => void;
  }) {
    app = Fastify();
    app.decorateRequest('authContext', null);
    app.addHook('preHandler', async (request) => {
      request.authContext = {
        sessionId: 1,
        deviceId: 'device',
        memberId: 1,
        memberName: 'Alex',
        defaultMemberId: null,
        hasPasskey: false,
        lockOnReopen: true,
      };
      await options.beforeHandler?.(request.raw);
    });
    app.addHook('onRequest', async (_request, reply) => {
      options.onRequest?.(reply);
    });
    await app.register(liveRoutes, {
      database,
      hub,
      appOrigins: ['https://budget-buddy.test'],
      heartbeatMs: 20,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    port = address.port;
  }

  function connect(): void {
    const request = get({ host: '127.0.0.1', port, path: '/api/events' });
    request.on('error', () => undefined);
    request.on('response', (response) => response.resume());
    requests.push(request);
  }

  async function until(done: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!done()) {
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  beforeEach(() => {
    database = new Database(':memory:');
    hub = createLiveHub(createCheckinEventBus());
    process.on('uncaughtException', onUnhandled);
  });

  afterEach(async () => {
    process.off('uncaughtException', onUnhandled);
    unhandled.length = 0;
    for (const request of requests.splice(0)) request.destroy();
    hub.close();
    await app.close();
    database.close();
  });

  function createSessionTables(): void {
    database.exec(`
      CREATE TABLE family (id INTEGER PRIMARY KEY, password_epoch INTEGER);
      CREATE TABLE member (id INTEGER PRIMARY KEY, active INTEGER);
      CREATE TABLE device (id TEXT PRIMARY KEY, lock_on_reopen INTEGER);
      CREATE TABLE session (
        id INTEGER PRIMARY KEY, expires_at INTEGER, password_epoch INTEGER,
        member_id INTEGER, device_id TEXT, foreground_at INTEGER
      );
      INSERT INTO family VALUES (1, 1);
      INSERT INTO member VALUES (1, 1);
      INSERT INTO device VALUES ('device', 1);
      INSERT INTO session VALUES
        (1, ${Date.now() + 3_600_000}, 1, 1, 'device', ${Date.now()});
    `);
  }

  it('does not keep a stream whose client left before the handler ran', async () => {
    createSessionTables();
    await start({
      // The client is gone, and its `close` event has fired, before the route
      // attaches a listener to it.
      beforeHandler: async (raw) => {
        raw.socket.destroy();
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    connect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hub.size).toBe(0);
  });

  it('ends and forgets a stream whose heartbeat write fails', async () => {
    createSessionTables();
    let ended = false;
    await start({
      onRequest: (reply) => {
        const write = reply.raw.write.bind(reply.raw);
        reply.raw.on('finish', () => {
          ended = true;
        });
        reply.raw.write = ((chunk: unknown, ...rest: unknown[]) => {
          if (String(chunk).includes('keep-alive'))
            throw new Error('write after end');
          return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
        }) as typeof reply.raw.write;
      },
    });
    connect();
    await until(() => hub.size === 1, 'the stream to register');
    await until(() => hub.size === 0, 'the failed stream to be removed');
    await until(() => ended, 'the response to end');
    expect(unhandled).toEqual([]);
  });

  it('ends and forgets a stream when the session check throws', async () => {
    // No session table: the liveness query throws inside the timer.
    await start({});
    connect();
    await until(() => hub.size === 1, 'the stream to register');
    await until(() => hub.size === 0, 'the failed stream to be removed');
    expect(unhandled).toEqual([]);
  });
});
