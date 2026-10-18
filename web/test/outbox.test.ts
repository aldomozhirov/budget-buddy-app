import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceStore, resetDeviceDatabase } from '../src/offline/db.js';
import {
  createOutbox,
  type OutboxChannel,
  type OutboxItem,
} from '../src/offline/outbox.js';
import { FakeIndexedDb } from './support/fakeIndexedDb.js';

/**
 * The outbox of spec 2 Design 4 over a fake IndexedDB: what keeps an item,
 * what marks it failed, what sends it, and two tabs sending at once.
 */

function item(clientId: string, enteredAt = 1): OutboxItem {
  return {
    clientId,
    body: {
      clientId,
      enteredAt,
      kind: 'expense',
      date: '2026-10-18',
      accountId: 1,
      amount: '1250',
      merchant: 'REWE',
    },
    profileId: 1,
    profileName: 'Alena',
    enteredAt,
    names: {
      account: 'ING Visa',
      currency: 'EUR',
      toAccount: null,
      toCurrency: null,
      category: 'Groceries',
      envelope: null,
      member: 'Alena',
    },
    state: 'waiting',
    error: null,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A server that keeps one row per client id, like the real one (TXN-7). */
function fakeServer() {
  const rows = new Map<string, number>();
  let posts = 0;
  const fetch = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      posts += 1;
      const body = JSON.parse(String(init?.body)) as { clientId: string };
      // Both tabs' requests are in flight before either is answered.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const existing = rows.get(body.clientId);
      if (existing !== undefined) {
        return json(200, { transaction: { id: existing } });
      }
      const id = rows.size + 1;
      rows.set(body.clientId, id);
      return json(201, { transaction: { id }, filled: {} });
    },
  );
  return { rows, fetch, posts: () => posts };
}

function setup(
  options: {
    idb?: FakeIndexedDb;
    fetch?: typeof fetch;
    online?: () => boolean;
    channel?: OutboxChannel;
  } = {},
) {
  const idb = options.idb ?? new FakeIndexedDb();
  resetDeviceDatabase();
  const store = deviceStore<OutboxItem>(
    'outbox',
    () => idb as unknown as IDBFactory,
  );
  const outbox = createOutbox({
    store,
    fetch: options.fetch ?? fakeServer().fetch,
    isOnline: options.online ?? (() => true),
    channel: options.channel ?? null,
  });
  return { idb, outbox };
}

afterEach(() => resetDeviceDatabase());

describe('outbox', () => {
  it('keeps an item across a reload', async () => {
    const offline = setup({ online: () => false });
    await offline.outbox.add(item('a'));
    expect((await offline.outbox.flush()).get('a')).toEqual({
      kind: 'waiting',
      reason: 'offline',
    });

    // A new page: a new connection to the same device database.
    const reloaded = setup({ idb: offline.idb });
    await reloaded.outbox.load();
    expect(reloaded.outbox.items.value).toEqual([item('a')]);
  });

  it('keeps an item when the network fails', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Load failed')));
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    const outcomes = await outbox.flush();
    expect(outcomes.get('a')).toEqual({ kind: 'waiting', reason: 'network' });
    expect(outbox.items.value).toEqual([item('a')]);
    expect(outbox.sentCount.value).toBe(0);
  });

  it('keeps an item on a server error', async () => {
    const fetch = vi.fn(async () => json(503, { error: { message: 'Busy' } }));
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    await outbox.add(item('b', 2));
    const outcomes = await outbox.flush();
    // A 5xx may be about that one item, so the next one is tried.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcomes.get('b')).toEqual({ kind: 'waiting', reason: 'server' });
    expect(outbox.items.value.map((entry) => entry.state)).toEqual([
      'waiting',
      'waiting',
    ]);
  });

  it('keeps an item on 401 unauthenticated until a sign-in', async () => {
    let signedIn = false;
    const server = fakeServer();
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) =>
        signedIn
          ? server.fetch(url, init)
          : json(401, {
              error: {
                code: 'unauthenticated',
                message: 'Sign in to continue.',
              },
            }),
    );
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    await outbox.add(item('b', 2));
    expect((await outbox.flush()).get('a')).toEqual({
      kind: 'waiting',
      reason: 'auth',
    });
    // The second is not tried: it would be refused the same way.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outbox.items.value).toHaveLength(2);

    signedIn = true;
    await outbox.flush();
    expect(outbox.items.value).toEqual([]);
    expect(server.rows.size).toBe(2);
  });

  it('keeps an item while the session has no profile yet', async () => {
    let profile = false;
    const server = fakeServer();
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) =>
        profile
          ? server.fetch(url, init)
          : json(403, {
              error: {
                code: 'profile_required',
                message: 'Choose a profile first.',
              },
            }),
    );
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    expect((await outbox.flush()).get('a')).toEqual({
      kind: 'waiting',
      reason: 'auth',
    });
    expect(outbox.items.value).toEqual([item('a')]);

    profile = true;
    await outbox.flush();
    expect(outbox.items.value).toEqual([]);
    expect(server.rows.size).toBe(1);
  });

  it('marks any other 403 failed', async () => {
    const fetch = vi.fn(async () =>
      json(403, { error: { code: 'forbidden', message: 'Not allowed.' } }),
    );
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    expect((await outbox.flush()).get('a')).toEqual({
      kind: 'failed',
      message: 'Not allowed.',
    });
  });

  it('marks an item failed on a 4xx refusal and never sends it again', async () => {
    const fetch = vi.fn(async () =>
      json(400, {
        error: {
          code: 'validation',
          message: 'Check the transaction.',
          fields: { envelopeId: 'Choose an envelope that is not archived.' },
        },
      }),
    );
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    expect((await outbox.flush()).get('a')).toEqual({
      kind: 'failed',
      message: 'Choose an envelope that is not archived.',
    });
    expect(outbox.items.value).toEqual([
      {
        ...item('a'),
        state: 'failed',
        error: 'Choose an envelope that is not archived.',
      },
    ]);
    await outbox.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the message when the refusal names no field', async () => {
    const fetch = vi.fn(async () =>
      json(409, {
        error: {
          code: 'conflict',
          message: 'This transaction was saved and has been deleted since.',
        },
      }),
    );
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    await outbox.flush();
    expect(outbox.items.value[0]?.error).toBe(
      'This transaction was saved and has been deleted since.',
    );
  });

  it('removes an item the server has, and counts it as sent', async () => {
    const server = fakeServer();
    const { outbox } = setup({ fetch: server.fetch });
    await outbox.add(item('a'));
    const outcome = (await outbox.flush()).get('a');
    expect(outcome).toMatchObject({ kind: 'sent', id: 1 });
    expect(outbox.items.value).toEqual([]);
    expect(outbox.sentCount.value).toBe(1);
  });

  it('reads the id from the answer a locked session gets', async () => {
    const fetch = vi.fn(async () => json(201, { id: 7 }));
    const { outbox } = setup({ fetch });
    await outbox.add(item('a'));
    expect((await outbox.flush()).get('a')).toEqual({
      kind: 'sent',
      id: 7,
      payload: { id: 7 },
    });
  });

  it('creates one transaction when two tabs send at once', async () => {
    const server = fakeServer();
    const idb = new FakeIndexedDb();
    const first = setup({ idb, fetch: server.fetch });
    await first.outbox.add(item('a'));
    const second = createOutbox({
      store: deviceStore<OutboxItem>(
        'outbox',
        () => idb as unknown as IDBFactory,
      ),
      fetch: server.fetch,
      isOnline: () => true,
    });
    await Promise.all([first.outbox.flush(), second.flush()]);
    expect(server.posts()).toBe(2);
    expect(server.rows.size).toBe(1);
    expect(idb.records('budget-buddy', 'outbox')).toEqual([]);
  });

  it('sends a new item added while a flush runs', async () => {
    const server = fakeServer();
    const { outbox } = setup({ fetch: server.fetch });
    await outbox.add(item('a'));
    const running = outbox.flush();
    await outbox.add(item('b', 2));
    const next = await outbox.flush();
    await running;
    expect(next.get('b')).toMatchObject({ kind: 'sent' });
    expect(server.rows.size).toBe(2);
  });

  it('deletes an item only after a send of it has finished', async () => {
    const server = fakeServer();
    const { outbox } = setup({ fetch: server.fetch });
    await outbox.add(item('a'));
    const sending = outbox.flush();
    const removed = await outbox.remove('a');
    await sending;
    expect(removed).toEqual({ removed: false, sentId: 1 });

    await outbox.add(item('b', 2));
    expect(await outbox.remove('b')).toEqual({ removed: true });
    expect(outbox.items.value).toEqual([]);
  });

  it('tells the other tabs when it changes', async () => {
    const posted: { sent: boolean }[] = [];
    let listener: ((message: { sent: boolean }) => void) | undefined;
    const channel: OutboxChannel = {
      post: (message) => posted.push(message),
      listen: (callback) => (listener = callback),
    };
    const { outbox } = setup({ channel });
    await outbox.add(item('a'));
    await outbox.flush();
    expect(posted).toEqual([{ sent: false }, { sent: true }]);
    listener?.({ sent: true });
    expect(outbox.sentCount.value).toBe(2);
  });

  it('clears every item', async () => {
    const { outbox, idb } = setup({ online: () => false });
    await outbox.add(item('a'));
    await outbox.add(item('b', 2));
    await outbox.clear();
    expect(outbox.items.value).toEqual([]);
    expect(idb.records('budget-buddy', 'outbox')).toEqual([]);
  });
});
