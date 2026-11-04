import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFeedbackOutbox,
  postFeedback,
  type FeedbackItem,
} from '../src/offline/feedbackOutbox.js';
import { sendAtOutboxMoments } from '../src/offline/sendTriggers.js';
import {
  DB_VERSION,
  deviceStore,
  resetDeviceDatabase,
} from '../src/offline/db.js';
import { authState } from '../src/stores/auth.js';
import { FakeIndexedDb } from './support/fakeIndexedDb.js';

/**
 * The feedback outbox of spec 8 Design 4: stored first, sent after, which
 * answers keep a report, the moments it is tried, and the device database.
 */

function report(id: string, writtenAt = '2026-11-01T10:00:00Z'): FeedbackItem {
  return {
    clientId: `00000000-0000-4000-8000-00000000000${id}`,
    kind: 'problem',
    text: `Report ${id} about the list`,
    writtenAt,
    device: {
      type: 'iPhone',
      os: 'iOS 26.1',
      display: 'standalone',
      fromScreen: '/home',
      userAgent: 'TestAgent/1.0',
    },
    screenshot: null,
  };
}

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const errorBody = (code: string) => ({ error: { code, message: 'No.' } });

function memoryStore() {
  const map = new Map<string, FeedbackItem>();
  return {
    map,
    order: [] as string[],
    getAll: async () => [...map.values()],
    get: async (key: string) => map.get(key),
    put: async (value: FeedbackItem) => void map.set(value.clientId, value),
    delete: async (key: string) => void map.delete(key),
    clear: async () => map.clear(),
  };
}

function setup(answer: () => Promise<Response> | Response) {
  const store = memoryStore();
  const fetch = vi.fn(async (...args: [unknown, RequestInit?]) => {
    void args;
    return answer();
  });
  const outbox = createFeedbackOutbox({
    store,
    fetch: fetch as never,
    isOnline: () => true,
  });
  return { store, fetch, outbox };
}

describe('sending a report', () => {
  it.each([201, 200])(
    'returns sent after a %i and leaves nothing',
    async (s) => {
      const { store, fetch, outbox } = setup(() => json(s, { id: 'x' }));
      expect(await outbox.send(report('1'))).toBe('sent');
      expect(store.map.size).toBe(0);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe('/api/feedback');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body)).clientId).toBe(
        report('1').clientId,
      );
    },
  );

  it('stores the report before it is sent', async () => {
    const store = memoryStore();
    let storedAtSend = -1;
    const outbox = createFeedbackOutbox({
      store,
      isOnline: () => true,
      fetch: (async () => {
        storedAtSend = store.map.size;
        return json(201, {});
      }) as never,
    });
    await outbox.send(report('1'));
    expect(storedAtSend).toBe(1);
  });

  it('returns saved after a network failure and keeps the report', async () => {
    const { store, outbox } = setup(() => {
      throw new TypeError('offline');
    });
    expect(await outbox.send(report('1'))).toBe('saved');
    expect(store.map.size).toBe(1);
    expect(outbox.waiting.value).toBe(1);
  });

  it('returns saved after a 500 and keeps the report', async () => {
    const { store, outbox } = setup(() => json(503));
    expect(await outbox.send(report('1'))).toBe('saved');
    expect(store.map.size).toBe(1);
  });

  it('returns saved when the phone says it is offline, without a request', async () => {
    const store = memoryStore();
    const fetch = vi.fn();
    const outbox = createFeedbackOutbox({
      store,
      fetch: fetch as never,
      isOnline: () => false,
    });
    expect(await outbox.send(report('1'))).toBe('saved');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns saved after 10 s without an answer', async () => {
    vi.useFakeTimers();
    try {
      const { store, outbox } = setup(() => new Promise<Response>(() => {}));
      const result = outbox.send(report('1'));
      await vi.advanceTimersByTimeAsync(9_900);
      let done = false;
      void result.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await result).toBe('saved');
      expect(store.map.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the report cannot be stored', async () => {
    const store = memoryStore();
    store.put = async () => {
      throw new Error('no IndexedDB');
    };
    const outbox = createFeedbackOutbox({ store, isOnline: () => true });
    await expect(outbox.send(report('1'))).rejects.toThrow();
  });
});

describe('the answers to one try', () => {
  const run = (answer: () => Promise<Response> | Response) =>
    postFeedback(report('1'), {
      fetch: (async () => answer()) as never,
      isOnline: () => true,
    });

  it.each([200, 201])('%i is sent', async (s) => {
    expect(await run(() => json(s))).toBe('sent');
  });

  it.each([500, 502, 503])('%i waits', async (s) => {
    expect(await run(() => json(s))).toBe('waiting');
  });

  it('a network failure waits', async () => {
    expect(
      await run(() => {
        throw new TypeError('offline');
      }),
    ).toBe('waiting');
  });

  it('401 unauthenticated and session_locked wait', async () => {
    expect(await run(() => json(401, errorBody('unauthenticated')))).toBe(
      'waiting',
    );
    expect(await run(() => json(401, errorBody('session_locked')))).toBe(
      'waiting',
    );
  });

  it('403 profile_required waits, other 403 is refused', async () => {
    expect(await run(() => json(403, errorBody('profile_required')))).toBe(
      'waiting',
    );
    expect(await run(() => json(403, errorBody('forbidden_state')))).toBe(
      'refused',
    );
    expect(await run(() => new Response('', { status: 403 }))).toBe('refused');
  });

  it.each([408, 425, 429])('%i waits', async (s) => {
    expect(await run(() => json(s))).toBe('waiting');
  });

  it.each([400, 404, 413, 422])('%i is refused', async (s) => {
    expect(await run(() => json(s, errorBody('invalid_request')))).toBe(
      'refused',
    );
  });

  it('aborts after timeoutMs and waits', async () => {
    const outcome = await postFeedback(report('1'), {
      isOnline: () => true,
      timeoutMs: 10,
      fetch: ((_u: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        })) as never,
    });
    expect(outcome).toBe('waiting');
  });
});

describe('flushing the waiting reports', () => {
  it('sends oldest first and removes each that left', async () => {
    const store = memoryStore();
    const sent: string[] = [];
    const outbox = createFeedbackOutbox({
      store,
      isOnline: () => true,
      fetch: (async (_u: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)).text);
        return json(201);
      }) as never,
    });
    await store.put(report('2', '2026-11-02T10:00:00Z'));
    await store.put(report('3', '2026-11-03T10:00:00Z'));
    await store.put(report('1', '2026-11-01T10:00:00Z'));
    await outbox.flush();
    expect(sent).toEqual([
      'Report 1 about the list',
      'Report 2 about the list',
      'Report 3 about the list',
    ]);
    expect(store.map.size).toBe(0);
    expect(outbox.waiting.value).toBe(0);
  });

  it('removes a refused report and goes on to the next', async () => {
    const answers = [400, 201];
    const { store, fetch, outbox } = setup(() => json(answers.shift()!));
    await store.put(report('1', '2026-11-01T10:00:00Z'));
    await store.put(report('2', '2026-11-02T10:00:00Z'));
    await outbox.flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.map.size).toBe(0);
  });

  it('stops at the first waiting report and keeps all after it', async () => {
    const { store, fetch, outbox } = setup(() => json(500));
    await store.put(report('1', '2026-11-01T10:00:00Z'));
    await store.put(report('2', '2026-11-02T10:00:00Z'));
    await outbox.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.map.size).toBe(2);
    expect(outbox.waiting.value).toBe(2);
  });

  it('keeps reports on 401 and a locked session', async () => {
    for (const code of ['unauthenticated', 'session_locked']) {
      const { store, outbox } = setup(() => json(401, errorBody(code)));
      await store.put(report('1'));
      await outbox.flush();
      expect(store.map.size).toBe(1);
    }
  });

  it('load counts what waits, and clear deletes it', async () => {
    const { store, outbox } = setup(() => json(500));
    await store.put(report('1'));
    await store.put(report('2'));
    await outbox.load();
    expect(outbox.waiting.value).toBe(2);
    await outbox.clear();
    expect(store.map.size).toBe(0);
    expect(outbox.waiting.value).toBe(0);
  });

  it('two flushes at once do not send a report twice', async () => {
    const { store, fetch, outbox } = setup(() => json(201));
    await store.put(report('1'));
    await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
    expect(store.map.size).toBe(0);
  });
});

describe('the moments a flush is tried', () => {
  type Listener = () => void;
  const listeners = new Map<string, Listener[]>();
  const docListeners = new Map<string, Listener[]>();
  const add = (map: Map<string, Listener[]>) => (type: string, fn: Listener) =>
    map.set(type, [...(map.get(type) ?? []), fn]);
  const fire = (map: Map<string, Listener[]>, type: string) =>
    (map.get(type) ?? []).forEach((fn) => fn());
  const doc = {
    visibilityState: 'visible',
    addEventListener: add(docListeners),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    docListeners.clear();
    doc.visibilityState = 'visible';
    vi.stubGlobal('window', {
      addEventListener: add(listeners),
      setInterval: (fn: Listener, ms: number) => setInterval(fn, ms),
    });
    vi.stubGlobal('document', doc);
    authState.value = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    authState.value = null;
  });

  it('flushes at start, on online and on return to the foreground', () => {
    const flush = vi.fn();
    sendAtOutboxMoments(flush, () => true);
    expect(flush).toHaveBeenCalledTimes(1);
    fire(listeners, 'online');
    expect(flush).toHaveBeenCalledTimes(2);
    doc.visibilityState = 'hidden';
    fire(docListeners, 'visibilitychange');
    expect(flush).toHaveBeenCalledTimes(2);
    doc.visibilityState = 'visible';
    fire(docListeners, 'visibilitychange');
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it('flushes every 30 s while visible and something waits', () => {
    const flush = vi.fn();
    let waits = true;
    sendAtOutboxMoments(flush, () => waits);
    flush.mockClear();
    vi.advanceTimersByTime(29_999);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'hidden';
    vi.advanceTimersByTime(30_000);
    expect(flush).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    waits = false;
    vi.advanceTimersByTime(30_000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a window', () => {
    vi.unstubAllGlobals();
    const flush = vi.fn();
    sendAtOutboxMoments(flush, () => true);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('upgrading the device database', () => {
  afterEach(() => resetDeviceDatabase());

  it('is version 3', () => {
    expect(DB_VERSION).toBe(3);
  });

  it('from version 2 keeps the outbox and the options and adds feedback', async () => {
    const fake = new FakeIndexedDb();
    // A device that last opened the app at version 2, with data in it.
    await new Promise<void>((resolve) => {
      const request = fake.open('budget-buddy', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('outbox', { keyPath: 'clientId' });
        db.createObjectStore('addOptions', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.transaction('outbox').objectStore('outbox').put({ clientId: 'tx1' });
        db.transaction('addOptions')
          .objectStore('addOptions')
          .put({ key: 'current' });
        setTimeout(resolve, 20);
      };
    });
    expect(fake.records('budget-buddy', 'outbox')).toHaveLength(1);

    // The new app opens version 3.
    resetDeviceDatabase();
    const feedback = deviceStore<FeedbackItem>('feedback', () => fake as never);
    expect(await feedback.getAll()).toEqual([]);
    await feedback.put(report('1'));
    expect(await feedback.getAll()).toHaveLength(1);
    expect(fake.records('budget-buddy', 'outbox')).toEqual([
      { clientId: 'tx1' },
    ]);
    expect(fake.records('budget-buddy', 'addOptions')).toEqual([
      { key: 'current' },
    ]);
  });
});
