/** One file of the built app, as listed by the build (`self.__WB_MANIFEST`). */
export interface ShellEntry {
  /** Path from the site root, e.g. `assets/index-AbC123.js`. */
  url: string;
  /** Hash of the content, or null when the file name already carries one. */
  revision: string | null;
}

/** The request handed to a `fetch` event listener. */
interface ShellRequest {
  url: string;
  method: string;
  mode: string;
}

/** A `fetch` event: the worker may answer it with `respondWith`. */
interface ShellFetchEvent {
  request: ShellRequest;
  respondWith(response: Promise<Response>): void;
}

/** A service worker event that can keep the worker alive for a promise. */
interface ShellWaitableEvent {
  waitUntil(work: Promise<unknown>): void;
}

/** The Cache Storage the shell uses, so tests can pass a fake. */
export interface ShellCaches {
  open(name: string): Promise<{
    put(request: string, response: Response): Promise<void>;
    match(request: string): Promise<Response | undefined>;
  }>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  match(request: string): Promise<Response | undefined>;
}

/** What the shell cache needs from the worker's global scope. */
export interface ShellScope {
  location: { origin: string };
  caches: ShellCaches;
  fetch(request: string, init?: { cache: 'reload' }): Promise<Response>;
  setTimeout(handler: () => void, milliseconds: number): number;
  clearTimeout(timer: number): void;
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ShellWaitableEvent) => void,
  ): void;
  addEventListener(
    type: 'fetch',
    listener: (event: ShellFetchEvent) => void,
  ): void;
}

/** Prefix of every cache this worker owns; the rest of the name is a hash. */
export const shellCachePrefix = 'bb-shell-';

/**
 * How long a page load waits for the network before the saved app opens
 * instead. A phone on a weak connection should not stare at a blank page.
 */
export const navigationTimeoutMs = 4000;

/** The page every navigation gets when the network cannot be reached. */
export const shellDocument = '/index.html';

/**
 * Name of the cache for one build: it changes whenever any file in the list
 * does, so a new build never reuses the files of an old one.
 */
export function shellCacheName(entries: readonly ShellEntry[]): string {
  const text = entries
    .map((entry) => `${entry.url}@${entry.revision ?? ''}`)
    .sort()
    .join('\n');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${shellCachePrefix}${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Keeps the app shell (page, scripts, styles, fonts, manifest and icons) so
 * the installed app opens without a connection (IOS-6), and nothing else:
 * `/api` is never read from or written to a cache, so data always comes from
 * the server or fails. Updates (see the spec, task 27):
 *
 * - A page load goes to the network first, so an online device always gets
 *   the current `index.html` and, through it, the current scripts. The saved
 *   page is used only when the network fails or takes longer than
 *   {@link navigationTimeoutMs}.
 * - Scripts, styles and fonts are named by their content, so a saved copy is
 *   always the right one for the page that asks for it; they are read from
 *   the cache first and fetched when missing.
 * - A new build has a new cache name. The new worker fills its cache on
 *   install, which fails (and is retried) if any file is missing, then
 *   deletes the caches of other builds on activation.
 * @param entries The files of this build to keep.
 */
export function installShellCache(
  scope: ShellScope,
  entries: readonly ShellEntry[],
): void {
  const cacheName = shellCacheName(entries);
  const urls = new Set(entries.map((entry) => `/${entry.url}`));
  const origin = scope.location.origin;

  scope.addEventListener('install', (event) => {
    event.waitUntil(fillCache(scope, cacheName, [...urls]));
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil(deleteOtherCaches(scope.caches, cacheName));
  });

  scope.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return;
    if (request.mode === 'navigate') {
      event.respondWith(openPage(scope, cacheName, request));
      return;
    }
    if (urls.has(url.pathname)) {
      event.respondWith(readFirst(scope, cacheName, request));
    }
  });
}

async function fillCache(
  scope: ShellScope,
  cacheName: string,
  urls: readonly string[],
): Promise<void> {
  const cache = await scope.caches.open(cacheName);
  await Promise.all(
    urls.map(async (url) => {
      // `reload` skips the HTTP cache so a file is never an older copy.
      const response = await scope.fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`Could not save ${url}.`);
      await cache.put(url, response);
    }),
  );
}

async function deleteOtherCaches(
  caches: ShellCaches,
  keep: string,
): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(shellCachePrefix) && name !== keep)
      .map((name) => caches.delete(name)),
  );
}

/** Network first for a page load, with the saved page as the way out. */
async function openPage(
  scope: ShellScope,
  cacheName: string,
  request: ShellRequest,
): Promise<Response> {
  const saved = async (): Promise<Response> => {
    const cache = await scope.caches.open(cacheName);
    const page = await cache.match(shellDocument);
    if (!page) throw new Error('The app page is not saved.');
    return page;
  };
  let timer = 0;
  const timeout = new Promise<Response>((resolve, reject) => {
    timer = scope.setTimeout(() => {
      saved().then(resolve, reject);
    }, navigationTimeoutMs);
  });
  const network = scope.fetch(request.url).finally(() => {
    scope.clearTimeout(timer);
  });
  try {
    return await Promise.race([network, timeout]);
  } catch {
    return saved();
  }
}

/** Cache first for a file named by its content; the network if it is gone. */
async function readFirst(
  scope: ShellScope,
  cacheName: string,
  request: ShellRequest,
): Promise<Response> {
  const cache = await scope.caches.open(cacheName);
  const url = new URL(request.url);
  return (await cache.match(url.pathname)) ?? scope.fetch(request.url);
}
