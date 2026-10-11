import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/push/registerServiceWorker.js';

/** Stands in for `navigator.serviceWorker`, recording what the app does. */
function fakeContainer(
  register: () => Promise<unknown> = async () => ({ update: async () => {} }),
) {
  const listeners: Array<(event: { data: unknown }) => void> = [];
  const registered: unknown[][] = [];
  const container = {
    register: (...args: unknown[]) => {
      registered.push(args);
      return register();
    },
    addEventListener: (
      type: string,
      listener: (event: { data: unknown }) => void,
    ) => {
      if (type === 'message') listeners.push(listener);
    },
  };
  vi.stubGlobal('navigator', { serviceWorker: container });
  return { listeners, registered };
}

describe('registerServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('registers /sw.js in the production build', async () => {
    vi.stubEnv('PROD', true);
    const { registered } = fakeContainer();
    await registerServiceWorker(() => undefined);
    expect(registered).toEqual([['/sw.js', { scope: '/' }]]);
  });

  it('asks for a new build each time the app comes back to the front', async () => {
    vi.stubEnv('PROD', true);
    let updates = 0;
    fakeContainer(async () => ({
      update: async () => {
        updates += 1;
      },
    }));
    const document = {
      visibilityState: 'hidden',
      listener: undefined as (() => void) | undefined,
      addEventListener(type: string, listener: () => void) {
        if (type === 'visibilitychange') this.listener = listener;
      },
    };
    vi.stubGlobal('document', document);
    await registerServiceWorker(() => undefined);
    document.listener?.();
    expect(updates).toBe(0);
    document.visibilityState = 'visible';
    document.listener?.();
    expect(updates).toBe(1);
  });

  it('registers nothing in development, so a worker cannot serve old code', async () => {
    vi.stubEnv('PROD', false);
    const { registered, listeners } = fakeContainer();
    await registerServiceWorker(() => undefined);
    expect(registered).toEqual([]);
    expect(listeners).toEqual([]);
  });

  it('does nothing in a browser without service workers', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('navigator', {});
    await expect(
      registerServiceWorker(() => undefined),
    ).resolves.toBeUndefined();
  });

  it('carries on when registration fails', async () => {
    vi.stubEnv('PROD', true);
    fakeContainer(async () => {
      throw new Error('blocked');
    });
    await expect(
      registerServiceWorker(() => undefined),
    ).resolves.toBeUndefined();
  });

  it('moves the router when a tapped notification names an app path', async () => {
    vi.stubEnv('PROD', true);
    const { listeners } = fakeContainer();
    const visited: string[] = [];
    await registerServiceWorker((path) => visited.push(path));
    const [listener] = listeners;
    listener!({ data: { type: 'navigate', url: '/check-ins/12' } });
    listener!({ data: { type: 'navigate', url: 'https://evil.test/' } });
    listener!({ data: { type: 'navigate', url: '//evil.test' } });
    listener!({ data: { type: 'other', url: '/accounts' } });
    listener!({ data: null });
    expect(visited).toEqual(['/check-ins/12']);
  });
});
