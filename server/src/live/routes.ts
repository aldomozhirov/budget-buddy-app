import type { OutgoingHttpHeaders } from 'node:http';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { liveEventsPath, type LiveSignal } from '@budget-buddy/shared';
import { systemClock, type Clock } from '../clock.js';
import { isSessionLive } from '../plugins/session.js';
import type { LiveHub, LiveStream } from './hub.js';

/** How often an idle stream gets a comment, so proxies keep it open. */
export const defaultHeartbeatMs = 15_000;

/**
 * Registers the server-sent events stream for signed-in members. It follows
 * the other `/api` routes (session, profile and device cookies) and, being a
 * GET, needs no CSRF token; a request that names another origin is refused.
 * The stream ends when the client leaves, when the session is signed out, has
 * expired or was opened under an older family password, and when the server
 * closes.
 */
export const liveRoutes: FastifyPluginAsync<{
  database: Database.Database;
  hub: LiveHub;
  appOrigins: readonly string[];
  clock?: Clock;
  heartbeatMs?: number;
}> = async (app, options) => {
  const { database, hub } = options;
  const clock = options.clock ?? systemClock;
  const heartbeatMs = options.heartbeatMs ?? defaultHeartbeatMs;
  const allowedOrigins = new Set(
    options.appOrigins.map((origin) => new URL(origin).origin),
  );

  app.get(liveEventsPath, async (request, reply) => {
    const origin = request.headers.origin;
    const crossSite = request.headers['sec-fetch-site'] === 'cross-site';
    if ((origin !== undefined && !allowedOrigins.has(origin)) || crossSite) {
      return reply.code(403).send({
        error: { code: 'forbidden_state', message: 'Request not allowed.' },
      });
    }
    const sessionId = request.authContext!.sessionId;
    const { raw } = reply;

    reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('Connection', 'keep-alive')
      // Tells nginx-style proxies not to buffer the stream.
      .header('X-Accel-Buffering', 'no');
    // Hijacking skips Fastify's own send, so the headers the session plugin
    // set (the refreshed cookies) are written here.
    reply.hijack();
    raw.writeHead(200, reply.getHeaders() as OutgoingHttpHeaders);
    // The opening comment makes headers reach the client at once.
    raw.write('retry: 3000\n: connected\n\n');

    const stream: LiveStream = {
      send(signal: LiveSignal) {
        raw.write(`data: ${JSON.stringify(signal)}\n\n`);
      },
      end: finish,
    };
    const timer = setInterval(() => {
      // A throw here would escape the timer and crash the process, so any
      // failure (a write to a socket that just ended, a database error)
      // ends this stream instead.
      try {
        if (!isSessionLive(database, sessionId, clock.now().getTime())) {
          finish();
          return;
        }
        raw.write(': keep-alive\n\n');
      } catch {
        finish();
      }
    }, heartbeatMs);
    // A stream never keeps the process (or a test run) alive by itself.
    timer.unref();

    function finish(): void {
      clearInterval(timer);
      hub.remove(stream);
      if (!raw.writableEnded) raw.end();
    }

    hub.add(stream);
    raw.on('close', finish);
    // A client that left while the request was still being authenticated has
    // already had its `close` event, which this listener missed.
    if (raw.destroyed) finish();
  });
};
