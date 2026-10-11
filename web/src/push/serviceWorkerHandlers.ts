import { isAppPath, parsePushPayload } from './payload.js';

/** A service worker event that can keep the worker alive for a promise. */
interface WaitableEvent {
  waitUntil(work: Promise<unknown>): void;
}

/** A page controlled by, or open next to, the service worker. */
export interface WorkerClient {
  url: string;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

/**
 * The part of `ServiceWorkerGlobalScope` that the handlers use. Declared here
 * so they can run, and be tested, without the worker typings.
 */
export interface WorkerScope {
  location: { origin: string };
  registration: {
    showNotification(
      title: string,
      options: { body: string; tag: string; data: { url: string } },
    ): Promise<void>;
  };
  clients: {
    claim(): Promise<void>;
    matchAll(options: {
      type: 'window';
      includeUncontrolled: true;
    }): Promise<readonly WorkerClient[]>;
    openWindow(url: string): Promise<unknown>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: WaitableEvent) => void,
  ): void;
  addEventListener(
    type: 'push',
    listener: (
      event: WaitableEvent & { data: { text(): string } | null },
    ) => void,
  ): void;
  addEventListener(
    type: 'notificationclick',
    listener: (
      event: WaitableEvent & {
        notification: { close(): void; data?: { url?: unknown } | null };
      },
    ) => void,
  ): void;
}

/** Message the worker posts to a page that is already open. */
export type NavigateMessage = { type: 'navigate'; url: string };

/**
 * Installs the Web Push behaviour (NTF-2, UI-NAV-6) and nothing else: a push
 * always shows a notification, and a tap opens the check-in it names in the
 * open window, or in a new one. There is no `fetch` handler, so the worker
 * never answers a request and cannot serve old app code; precaching, when
 * the installable app adds it (task 27), is the only thing that may.
 */
export function installPushHandlers(scope: WorkerScope): void {
  // A new worker takes over at once rather than after every tab is closed.
  scope.addEventListener('install', (event) => {
    event.waitUntil(scope.skipWaiting());
  });
  scope.addEventListener('activate', (event) => {
    event.waitUntil(scope.clients.claim());
  });

  scope.addEventListener('push', (event) => {
    const payload = parsePushPayload(event.data?.text());
    event.waitUntil(
      scope.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        data: { url: payload.url },
      }),
    );
  });

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const requested = event.notification.data?.url;
    const url = isAppPath(requested) ? requested : '/check-ins';
    event.waitUntil(openCheckin(scope, url));
  });
}

async function openCheckin(scope: WorkerScope, url: string): Promise<void> {
  const windows = await scope.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const open = windows.find((client) =>
    client.url.startsWith(scope.location.origin),
  );
  if (!open) {
    await scope.clients.openWindow(url);
    return;
  }
  // The app's router moves itself: navigating the window would reload it.
  const message: NavigateMessage = { type: 'navigate', url };
  open.postMessage(message);
  await open.focus();
}
