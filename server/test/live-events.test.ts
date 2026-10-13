import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createCheckinEventBus, type CheckinEventBus } from '../src/events.js';
import { createLiveHub } from '../src/live/hub.js';
import { closeOnSignals, type ShutdownProcess } from '../src/shutdown.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';

/** A reader of a server-sent events response, with a deadline per wait. */
class EventReader {
  text = '';
  ended = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();

  constructor(response: Response) {
    this.reader = response.body!.getReader();
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.text += this.decoder.decode(value, { stream: true });
      }
    } catch {
      // A reset connection ends the stream like a clean close.
    }
    this.ended = true;
  }

  /** The `data:` payloads received so far, parsed. */
  get signals(): unknown[] {
    return this.text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as unknown);
  }

  async until(done: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!done()) {
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${what}; got ${this.text}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

describe('live events stream', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let cookies: string;
  let base: string;
  let events: CheckinEventBus;
  const readers: EventReader[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-live-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    events = createCheckinEventBus();
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      events,
      liveHeartbeatMs: 25,
    });
    await migrateDatabase(database, {
      backupDir: directory,
      migrationsFolder,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'LiveTest/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookies = cookieHeader(setup);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await Promise.all(readers.splice(0).map((reader) => reader.cancel()));
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function connect(headers: Record<string, string> = {}) {
    const response = await fetch(`${base}/api/events`, {
      headers: { cookie: cookies, ...headers },
    });
    const reader = response.ok ? new EventReader(response) : undefined;
    if (reader) readers.push(reader);
    return { response, reader: reader! };
  }

  async function api(
    method: string,
    url: string,
    payload: object = {},
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: method as 'POST',
      url,
      headers: { ...jsonHeaders, cookie: cookies },
      payload,
    });
  }

  async function openCheckinWith(accounts: number) {
    const ids: number[] = [];
    for (let index = 0; index < accounts; index += 1) {
      const created = await api('POST', '/api/accounts', {
        name: `Secret account ${index}`,
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '100',
      });
      expect(created.statusCode).toBe(201);
      ids.push(created.json().account.id as number);
    }
    const started = await api('POST', '/api/checkins', {});
    return { checkinId: started.json().checkin.id as number, accountIds: ids };
  }

  it('needs a session', async () => {
    const response = await fetch(`${base}/api/events`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'unauthenticated' },
    });
  });

  it('refuses a request from another origin', async () => {
    const foreign = await fetch(`${base}/api/events`, {
      headers: { cookie: cookies, origin: 'https://evil.test' },
    });
    expect(foreign.status).toBe(403);
    const crossSite = await fetch(`${base}/api/events`, {
      headers: { cookie: cookies, 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.status).toBe(403);
    const own = await connect({ origin });
    expect(own.response.status).toBe(200);
  });

  it('opens an event stream that names no data', async () => {
    const { response, reader } = await connect();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
  });

  it('signals a saved value and a close with the check-in id only', async () => {
    const { checkinId, accountIds } = await openCheckinWith(3);
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');

    const saved = await api(
      'PUT',
      `/api/checkins/${checkinId}/values/${accountIds[0]}`,
      { amount: '987654' },
    );
    expect(saved.statusCode).toBe(200);
    await reader.until(() => reader.signals.length === 1, 'changed signal');
    expect(reader.signals).toEqual([{ kind: 'changed', checkinId }]);

    const closed = await api('POST', `/api/checkins/${checkinId}/close`, {});
    expect(closed.statusCode).toBe(200);
    await reader.until(() => reader.signals.length === 2, 'closed signal');
    expect(reader.signals[1]).toEqual({ kind: 'closed', checkinId });

    // Nothing but ids and kinds: no amount, no account name.
    expect(reader.text).not.toContain('987654');
    expect(reader.text).not.toContain('Secret account');
    expect(reader.text).not.toContain('Alex');
  });

  it('signals a change, not a close, for the last value; Close now signals the close', async () => {
    const { checkinId, accountIds } = await openCheckinWith(1);
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
    await api('PUT', `/api/checkins/${checkinId}/values/${accountIds[0]}`, {
      same: true,
    });
    await reader.until(() => reader.signals.length === 1, 'change signal');
    expect(reader.signals).toEqual([{ kind: 'changed', checkinId }]);

    const closed = await api('POST', `/api/checkins/${checkinId}/close`, {});
    expect(closed.statusCode).toBe(200);
    await reader.until(() => reader.signals.length === 2, 'closed signal');
    expect(reader.signals).toEqual([
      { kind: 'changed', checkinId },
      { kind: 'closed', checkinId },
    ]);
  });

  it('sends nothing for a refused save, and answers with its own code', async () => {
    const { checkinId, accountIds } = await openCheckinWith(2);
    await api('POST', `/api/checkins/${checkinId}/close`, {});
    const before = {
      snapshots: database.prepare('SELECT COUNT(*) AS n FROM snapshot').get(),
      revisions: database
        .prepare('SELECT COUNT(*) AS n FROM snapshot_revision')
        .get(),
    };
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');

    const refused = await api(
      'PUT',
      `/api/checkins/${checkinId}/values/${accountIds[0]}`,
      { amount: '5' },
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      error: {
        code: 'checkin_closed',
        message: 'This check-in is already closed.',
      },
    });
    const closedAgain = await api(
      'POST',
      `/api/checkins/${checkinId}/close`,
      {},
    );
    expect(closedAgain.json().error.code).toBe('checkin_closed');
    expect({
      snapshots: database.prepare('SELECT COUNT(*) AS n FROM snapshot').get(),
      revisions: database
        .prepare('SELECT COUNT(*) AS n FROM snapshot_revision')
        .get(),
    }).toEqual(before);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reader.signals).toEqual([]);
  });

  it('signals a change to what the open check-in shows, with the id only', async () => {
    const { checkinId, accountIds } = await openCheckinWith(2);
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
    const [first, second] = accountIds;

    // Each change commits first, then sends exactly one signal.
    const changes: Array<[string, () => Promise<LightMyRequestResponse>]> = [
      [
        'an account is created',
        () =>
          api('POST', '/api/accounts', {
            name: 'Late account',
            ownerMemberId: 2,
            type: 'cash',
            currency: 'EUR',
          }),
      ],
      [
        'an account is deactivated',
        () => api('POST', `/api/accounts/${first}/deactivate`),
      ],
      [
        'an account is reactivated',
        () => api('POST', `/api/accounts/${first}/reactivate`),
      ],
      [
        'an account moves to another member',
        () => api('PATCH', `/api/accounts/${first}`, { ownerMemberId: 2 }),
      ],
      [
        'an account changes currency',
        () =>
          api('POST', `/api/accounts/${first}/currency`, {
            currency: 'USD',
            confirm: true,
          }),
      ],
      [
        'a member is created',
        () => api('POST', '/api/members', { name: 'Casey' }),
      ],
      [
        'a member is deactivated',
        () => api('PATCH', '/api/members/2', { active: false }),
      ],
      [
        'a balance is entered outside the check-in',
        () =>
          api('POST', `/api/accounts/${second}/snapshots`, {
            amount: '4242',
            date: '2020-01-01',
          }),
      ],
    ];
    let expected = 0;
    for (const [what, change] of changes) {
      const response = await change();
      expect(response.statusCode, what).toBeLessThan(300);
      expected += 1;
      await reader.until(
        () => reader.signals.length === expected,
        `a signal after ${what}`,
      );
    }
    expect(reader.signals).toEqual(
      changes.map(() => ({ kind: 'changed', checkinId })),
    );
    expect(reader.text).not.toContain('Late account');
    expect(reader.text).not.toContain('Casey');
    expect(reader.text).not.toContain('4242');
  });

  it('sends nothing for such a change when it fails or no check-in is open', async () => {
    const { checkinId, accountIds } = await openCheckinWith(1);
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');

    const missing = await api('POST', '/api/accounts/9999/deactivate');
    expect(missing.statusCode).toBe(404);
    const invalid = await api('POST', '/api/members', { name: '' });
    expect(invalid.statusCode).toBe(400);

    await api('POST', `/api/checkins/${checkinId}/close`, {});
    await reader.until(() => reader.signals.length === 1, 'the closed signal');
    const afterClose = await api(
      'POST',
      `/api/accounts/${accountIds[0]}/deactivate`,
    );
    expect(afterClose.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reader.signals).toEqual([{ kind: 'closed', checkinId }]);
  });

  it('keeps an idle stream open with comments', async () => {
    const { reader } = await connect();
    await reader.until(
      () => reader.text.includes(': keep-alive'),
      'a heartbeat',
    );
    expect(reader.ended).toBe(false);
  });

  it('ends when the session signs out', async () => {
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
    const out = await api('POST', '/api/auth/sign-out', {});
    expect(out.statusCode).toBe(200);
    await reader.until(() => reader.ended, 'the stream to end');
  });

  it('ends when the family password epoch changes', async () => {
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
    database
      .prepare('UPDATE family SET password_epoch = password_epoch + 1')
      .run();
    await reader.until(() => reader.ended, 'the stream to end');
  });

  it('ends open streams when the app closes, and does not hang', async () => {
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
    await app.close();
    await reader.until(() => reader.ended, 'the stream to end');
    // `afterEach` closes the app again, which Fastify allows.
  });

  it('ends open streams on SIGTERM through closeOnSignals', async () => {
    const { reader } = await connect();
    await reader.until(() => reader.text.includes(': connected'), 'preamble');
    const handlers = new Map<string, () => void>();
    const fakeProcess: ShutdownProcess = {
      once: (signal, listener) => handlers.set(signal, listener),
      exit: () => undefined,
    };
    let released = false;
    const shutdown = closeOnSignals({
      close: () => app.close(),
      release: () => {
        released = true;
      },
      logger: { error: () => undefined },
      process: fakeProcess,
      deadlineMs: 5000,
    });
    handlers.get('SIGTERM')?.();
    await shutdown();
    expect(released).toBe(true);
    await reader.until(() => reader.ended, 'the stream to end');
  });
});

describe('live hub', () => {
  it('delivers signals to every stream, survives a failing one, and closes', () => {
    const events = createCheckinEventBus();
    const hub = createLiveHub(events);
    const received: unknown[] = [];
    let ended = 0;
    const failing = {
      send() {
        throw new Error('socket gone');
      },
      end() {
        ended += 1;
      },
    };
    const working = {
      send: (signal: unknown) => received.push(signal),
      end() {
        ended += 1;
      },
    };
    hub.add(failing);
    hub.add(working);
    events.emit('checkin.valueSaved', {
      checkinId: 4,
      accountId: 9,
      savedBy: 1,
    });
    expect(received).toEqual([{ kind: 'changed', checkinId: 4 }]);
    hub.remove(working);
    expect(hub.size).toBe(1);
    hub.close();
    expect(hub.size).toBe(0);
    expect(ended).toBe(1);
    events.emit('checkin.closed', {
      checkinId: 4,
      closedAt: 1,
      closedBy: 1,
    });
    expect(received).toHaveLength(1);
    // A stream that arrives after the hub closed is ended at once.
    hub.add(working);
    expect(ended).toBe(2);
  });
});

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
