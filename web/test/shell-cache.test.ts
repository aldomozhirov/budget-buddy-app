import { describe, expect, it } from 'vitest';
import {
  installShellCache,
  navigationTimeoutMs,
  shellCacheName,
  type ShellEntry,
  type ShellScope,
} from '../src/shell/shellCache.js';

const origin = 'https://budget-buddy.test';
const entries: ShellEntry[] = [
  { url: 'index.html', revision: 'r1' },
  { url: 'assets/index-AAA.js', revision: null },
  { url: 'assets/Geist-400-AAA.woff2', revision: null },
];

type Listener = (event: never) => void;

/** A worker scope with in-memory caches and a network the test controls. */
function fakeScope(pages: Record<string, string>) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  const timers: Array<() => void> = [];
  let online = true;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (request: string, response: Response) => {
        store.set(request, response);
      },
      match: async (request: string) => store.get(request)?.clone(),
    };
  };
  const scope: ShellScope = {
    location: { origin },
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (request) => {
        for (const store of stores.values()) {
          const found = store.get(request);
          if (found) return found.clone();
        }
        return undefined;
      },
    },
    fetch: async (request) => {
      fetched.push(new URL(request, origin).pathname);
      if (!online) throw new TypeError('Load failed');
      const body = pages[new URL(request, origin).pathname];
      return body === undefined
        ? new Response('missing', { status: 404 })
        : new Response(body);
    },
    setTimeout: (handler) => timers.push(handler),
    clearTimeout: () => undefined,
    addEventListener: ((type: string, listener: Listener) => {
      listeners.set(type, listener);
    }) as ShellScope['addEventListener'],
  };
  const event = async (type: 'install' | 'activate') => {
    const waited: Promise<unknown>[] = [];
    listeners.get(type)!({
      waitUntil: (work: Promise<unknown>) => waited.push(work),
    } as never);
    await Promise.all(waited);
  };
  /** Returns the answer to a request, or null when the worker left it alone. */
  const request = async (
    path: string,
    init: { method?: string; mode?: string } = {},
  ): Promise<Response | null> => {
    let answer: Promise<Response> | null = null;
    listeners.get('fetch')!({
      request: {
        url: new URL(path, origin).href,
        method: init.method ?? 'GET',
        mode: init.mode ?? 'no-cors',
      },
      respondWith: (response: Promise<Response>) => {
        answer = response;
      },
    } as never);
    return answer;
  };
  return {
    scope,
    stores,
    fetched,
    timers,
    event,
    request,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

const pages = {
  '/index.html': '<html>shell</html>',
  '/assets/index-AAA.js': 'script',
  '/assets/Geist-400-AAA.woff2': 'font',
};

describe('shellCacheName', () => {
  it('changes with any file of the build and ignores their order', () => {
    const name = shellCacheName(entries);
    expect(name).toMatch(/^bb-shell-[0-9a-f]{8}$/u);
    expect(shellCacheName([...entries].reverse())).toBe(name);
    expect(
      shellCacheName([
        { url: 'index.html', revision: 'r2' },
        ...entries.slice(1),
      ]),
    ).not.toBe(name);
    expect(
      shellCacheName([...entries, { url: 'assets/new.js', revision: null }]),
    ).not.toBe(name);
  });
});

describe('installShellCache', () => {
  it('saves every file of the build on install, and nothing else', async () => {
    const worker = fakeScope(pages);
    installShellCache(worker.scope, entries);
    await worker.event('install');
    const [name] = [...worker.stores.keys()];
    expect(name).toBe(shellCacheName(entries));
    expect([...worker.stores.get(name!)!.keys()].sort()).toEqual([
      '/assets/Geist-400-AAA.woff2',
      '/assets/index-AAA.js',
      '/index.html',
    ]);
  });

  it('fails the install when a file cannot be saved, so it is retried', async () => {
    const worker = fakeScope({ '/index.html': 'page' });
    installShellCache(worker.scope, entries);
    await expect(worker.event('install')).rejects.toThrow(/Could not save/u);
  });

  it('deletes the caches of other builds on activation, and only ours', async () => {
    const worker = fakeScope(pages);
    installShellCache(worker.scope, entries);
    worker.stores.set('bb-shell-00000000', new Map());
    worker.stores.set('someone-elses-cache', new Map());
    await worker.event('install');
    await worker.event('activate');
    expect([...worker.stores.keys()].sort()).toEqual(
      [shellCacheName(entries), 'someone-elses-cache'].sort(),
    );
  });

  it('never answers /api, other origins or non-GET requests', async () => {
    const worker = fakeScope(pages);
    installShellCache(worker.scope, entries);
    await worker.event('install');
    expect(await worker.request('/api/home')).toBeNull();
    expect(
      await worker.request('/api/health', { mode: 'navigate' }),
    ).toBeNull();
    expect(await worker.request('/index.html', { method: 'POST' })).toBeNull();
    expect(
      await worker.request('https://elsewhere.test/index.html'),
    ).toBeNull();
    expect(await worker.request('/assets/not-in-the-build.js')).toBeNull();
    // Nothing from /api was ever stored.
    const saved = [...worker.stores.values()].flatMap((store) => [
      ...store.keys(),
    ]);
    expect(saved.some((url) => url.startsWith('/api'))).toBe(false);
  });

  it('reads built files from the cache without touching the network', async () => {
    const worker = fakeScope(pages);
    installShellCache(worker.scope, entries);
    await worker.event('install');
    worker.fetched.length = 0;
    worker.setOnline(false);
    const script = await worker.request('/assets/index-AAA.js');
    expect(await script!.text()).toBe('script');
    expect(worker.fetched).toEqual([]);
  });

  it('takes a page load from the network when it is there', async () => {
    const worker = fakeScope({ ...pages, '/check-ins': '<html>fresh</html>' });
    installShellCache(worker.scope, entries);
    await worker.event('install');
    const page = await worker.request('/check-ins', { mode: 'navigate' });
    expect(await page!.text()).toBe('<html>fresh</html>');
  });

  it('opens the saved page for any address when the network fails', async () => {
    const worker = fakeScope(pages);
    installShellCache(worker.scope, entries);
    await worker.event('install');
    worker.setOnline(false);
    const page = await worker.request('/check-ins/12', { mode: 'navigate' });
    expect(await page!.text()).toBe('<html>shell</html>');
  });

  it('opens the saved page when the network takes too long', async () => {
    const worker = fakeScope(pages);
    installShellCache(worker.scope, entries);
    await worker.event('install');
    // A network that never answers.
    worker.scope.fetch = () => new Promise<Response>(() => undefined);
    const pending = worker.request('/', { mode: 'navigate' });
    expect(worker.timers).toHaveLength(1);
    worker.timers[0]!();
    const page = await pending;
    expect(await page!.text()).toBe('<html>shell</html>');
    expect(navigationTimeoutMs).toBeGreaterThan(0);
  });
});
