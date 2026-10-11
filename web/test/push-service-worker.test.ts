import { describe, expect, it } from 'vitest';
import {
  fallbackPayload,
  isAppPath,
  parsePushPayload,
} from '../src/push/payload.js';
import {
  installPushHandlers,
  type WorkerClient,
  type WorkerScope,
} from '../src/push/serviceWorkerHandlers.js';
import { base64UrlToBytes } from '../src/push/pushClient.js';

type Handler = (event: never) => void;

/** A worker scope that records its listeners, shown notifications and windows. */
function fakeScope(windows: WorkerClient[] = []) {
  const listeners = new Map<string, Handler>();
  const shown: Array<{ title: string; options: unknown }> = [];
  const opened: string[] = [];
  const waited: Array<Promise<unknown>> = [];
  const calls: string[] = [];
  const scope = {
    location: { origin: 'https://budget-buddy.test' },
    registration: {
      showNotification: async (title: string, options: unknown) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => {
        calls.push('claim');
      },
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    skipWaiting: async () => {
      calls.push('skipWaiting');
    },
    addEventListener: (type: string, listener: Handler) => {
      listeners.set(type, listener);
    },
  } as unknown as WorkerScope;
  installPushHandlers(scope);
  const fire = async (type: string, event: object) => {
    listeners.get(type)!({
      ...event,
      waitUntil: (work: Promise<unknown>) => waited.push(work),
    } as never);
    await Promise.all(waited.splice(0));
  };
  return { listeners, shown, opened, calls, fire };
}

describe('push payload', () => {
  it('reads the payload the server sends', () => {
    expect(
      parsePushPayload(
        JSON.stringify({
          title: 'Max started a check-in',
          body: 'Add your balances when you have a minute.',
          url: '/check-ins/12',
          tag: 'checkin-12-opened',
        }),
      ),
    ).toEqual({
      title: 'Max started a check-in',
      body: 'Add your balances when you have a minute.',
      url: '/check-ins/12',
      tag: 'checkin-12-opened',
    });
  });

  it.each([undefined, null, '', 'not json', '[]', '42', '{}'])(
    'falls back for %j, so something is always shown',
    (text) => {
      expect(parsePushPayload(text)).toEqual(fallbackPayload);
    },
  );

  it('falls back field by field, and never opens another site', () => {
    expect(
      parsePushPayload(
        JSON.stringify({ title: 'Hi', body: 7, url: 'https://evil.test/x' }),
      ),
    ).toEqual({ ...fallbackPayload, title: 'Hi' });
    expect(isAppPath('//evil.test')).toBe(false);
    expect(isAppPath('/\\evil.test')).toBe(false);
    expect(isAppPath('check-ins/1')).toBe(false);
    expect(isAppPath('/check-ins/1')).toBe(true);
  });

  it('shows no amounts when it falls back', () => {
    expect(JSON.stringify(fallbackPayload)).not.toMatch(/[€$£¥₽]|\d[.,]\d/u);
  });
});

describe('service worker handlers', () => {
  it('handles install, activate, push and notificationclick, and never fetch', () => {
    const { listeners } = fakeScope();
    // No fetch handler: the worker cannot answer from a cache, so it cannot
    // serve old app code.
    expect([...listeners.keys()].sort()).toEqual([
      'activate',
      'install',
      'notificationclick',
      'push',
    ]);
  });

  it('takes over at once when a new version installs', async () => {
    const { fire, calls } = fakeScope();
    await fire('install', {});
    await fire('activate', {});
    expect(calls).toEqual(['skipWaiting', 'claim']);
  });

  it('shows the pushed notification with the check-in to open', async () => {
    const { fire, shown } = fakeScope();
    await fire('push', {
      data: {
        text: () =>
          JSON.stringify({
            title: 'Check-in complete',
            body: 'The summary is ready.',
            url: '/check-ins/3',
            tag: 'checkin-3-closed',
          }),
      },
    });
    expect(shown).toEqual([
      {
        title: 'Check-in complete',
        options: {
          body: 'The summary is ready.',
          tag: 'checkin-3-closed',
          data: { url: '/check-ins/3' },
        },
      },
    ]);
  });

  it('still shows a notification for a push with no data', async () => {
    const { fire, shown } = fakeScope();
    await fire('push', { data: null });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe(fallbackPayload.title);
  });

  it('opens a new window on the check-in when the app is not open', async () => {
    const { fire, opened } = fakeScope([]);
    const closed: boolean[] = [];
    await fire('notificationclick', {
      notification: {
        close: () => closed.push(true),
        data: { url: '/check-ins/12' },
      },
    });
    expect(closed).toEqual([true]);
    expect(opened).toEqual(['/check-ins/12']);
  });

  it('moves the open app to the check-in instead of reloading it', async () => {
    const messages: unknown[] = [];
    const focused: boolean[] = [];
    const client: WorkerClient = {
      url: 'https://budget-buddy.test/accounts',
      postMessage: (message) => messages.push(message),
      focus: async () => focused.push(true),
    };
    const { fire, opened } = fakeScope([client]);
    await fire('notificationclick', {
      notification: { close: () => undefined, data: { url: '/check-ins/12' } },
    });
    expect(messages).toEqual([{ type: 'navigate', url: '/check-ins/12' }]);
    expect(focused).toEqual([true]);
    expect(opened).toEqual([]);
  });

  it('opens the check-ins list when the notification names no valid path', async () => {
    const { fire, opened } = fakeScope([]);
    await fire('notificationclick', {
      notification: { close: () => undefined, data: { url: 'https://x.test' } },
    });
    expect(opened).toEqual(['/check-ins']);
  });
});

describe('VAPID key decoding', () => {
  it('turns URL-safe base64 into bytes', () => {
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3]);
    // `-` and `_` stand for `+` and `/`; padding is optional.
    expect([...base64UrlToBytes('-_8')]).toEqual([251, 255]);
  });
});
