import { readonly, ref, shallowRef, watch } from 'vue';
import type { CreateTransactionRequest } from '@budget-buddy/shared';
import { authState } from '../stores/auth.js';
import { deviceStore, type RecordStore } from './db.js';

/**
 * The outbox (spec 2, Design 4; TXN-7, UI-ADD-14): every transaction saved
 * on the Add form is written here first and leaves once the server has it.
 * The `client_id` makes a repeat harmless, so two tabs may send one item.
 */

/** How often items that wait are tried again while the page is visible. */
export const RETRY_INTERVAL_MS = 30_000;

/** The body of `POST /api/transactions` as the outbox keeps it. */
export type OutboxBody = CreateTransactionRequest & {
  clientId: string;
  enteredAt: number;
  date: string;
};

/** The names an item is shown with, as the Add form had them on save. */
export interface OutboxNames {
  account: string;
  /** Currency code of `account`, for the amount. */
  currency: string;
  toAccount: string | null;
  toCurrency: string | null;
  category: string | null;
  envelope: string | null;
  /** Paid by, received by or done by. */
  member: string;
}

/** One transaction kept on the phone until the server has it. */
export interface OutboxItem {
  clientId: string;
  body: OutboxBody;
  /** The profile it was entered as. */
  profileId: number;
  profileName: string;
  /** When it was typed, UTC epoch milliseconds. */
  enteredAt: number;
  names: OutboxNames;
  /** `failed` was refused by the server and is never sent by itself. */
  state: 'waiting' | 'failed';
  /** The server's message for a refused item. */
  error: string | null;
}

/** What one try to send an item came to. */
export type SendOutcome =
  | {
      kind: 'sent';
      /** The id on the server; null when the answer did not say. */
      id: number | null;
      /** The answer's body, which a locked session gets as `{id}` only. */
      payload: unknown;
    }
  | { kind: 'waiting'; reason: 'offline' | 'network' | 'server' | 'auth' }
  | { kind: 'failed'; message: string };

/** What removing an item found. */
export type RemoveResult =
  | { removed: true }
  /** It had been sent meanwhile: its server id, when this tab sent it. */
  | { removed: false; sentId: number | null };

/** The outbox of one page, over a store that outlives it. */
export interface Outbox {
  /** The items on the phone, oldest first. */
  readonly items: Readonly<{ value: readonly OutboxItem[] }>;
  /** Goes up each time items reach the server, in this tab or another. */
  readonly sentCount: Readonly<{ value: number }>;
  /** Reads the items from the store. */
  load(): Promise<void>;
  /** Writes a new item; it is not sent until the next `flush`. */
  add(item: OutboxItem): Promise<void>;
  /**
   * Sends the waiting items, oldest first, one at a time. Calls made while a
   * flush runs share the next one, so a new item is never left out.
   * @returns The latest outcome of each item tried so far, by client id,
   * including tries of an earlier flush that picked a new item up first.
   */
  flush(): Promise<ReadonlyMap<string, SendOutcome>>;
  /** Deletes an item, after any send of it that is under way. */
  remove(clientId: string): Promise<RemoveResult>;
  /** Deletes every item (sign-out). */
  clear(): Promise<void>;
}

/** Tells the other tabs of this app that the outbox changed. */
export interface OutboxChannel {
  post(message: { sent: boolean }): void;
  listen(listener: (message: { sent: boolean }) => void): void;
}

/** Statuses that say "try again later" rather than "this is wrong". */
const TRANSIENT = new Set([408, 425, 429]);

/** Builds an outbox; the app uses `outbox`, tests pass a fake store. */
export function createOutbox(options: {
  store: RecordStore<OutboxItem>;
  fetch?: typeof fetch;
  /** Whether the browser says it has a connection. */
  isOnline?: () => boolean;
  channel?: OutboxChannel | null;
}): Outbox {
  const { store } = options;
  const send = options.fetch ?? ((...args) => fetch(...args));
  const isOnline = options.isOnline ?? (() => navigator.onLine);
  const channel = options.channel ?? null;
  const items = shallowRef<readonly OutboxItem[]>([]);
  const sentCount = ref(0);
  /** Ids of the items this tab has sent, for an Undo that comes late. */
  const sentIds = new Map<string, number | null>();
  const latest = new Map<string, SendOutcome>();

  // Flushes and removals run one after another, so a removal never races
  // a send of the same item in this tab.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  }
  let nextFlush: Promise<ReadonlyMap<string, SendOutcome>> | null = null;

  async function load(): Promise<void> {
    const all = await store.getAll();
    items.value = all.sort((a, b) => a.enteredAt - b.enteredAt);
  }

  async function changed(sent: boolean): Promise<void> {
    await load();
    if (sent) sentCount.value += 1;
    channel?.post({ sent });
  }

  async function runFlush(): Promise<ReadonlyMap<string, SendOutcome>> {
    let tried = false;
    const waiting = (await store.getAll())
      .filter((item) => item.state === 'waiting')
      .sort((a, b) => a.enteredAt - b.enteredAt);
    let sent = false;
    for (const listed of waiting) {
      // Another tab may have sent or deleted it since the list was read.
      const item = await store.get(listed.clientId);
      if (!item || item.state !== 'waiting') continue;
      const outcome = await postTransaction(item.body, {
        fetch: send,
        isOnline,
      });
      latest.set(item.clientId, outcome);
      tried = true;
      if (outcome.kind === 'sent') {
        sentIds.set(item.clientId, outcome.id);
        await store.delete(item.clientId);
        sent = true;
      } else if (outcome.kind === 'failed') {
        await store.put({ ...item, state: 'failed', error: outcome.message });
      } else if (outcome.reason !== 'server') {
        // No connection or no session: the rest would fail the same way.
        break;
      }
    }
    if (tried) await changed(sent);
    return new Map(latest);
  }

  channel?.listen((message) => {
    void load();
    if (message.sent) sentCount.value += 1;
  });

  return {
    items: readonly(items),
    sentCount: readonly(sentCount),
    load,
    async add(item) {
      await store.put(item);
      await changed(false);
    },
    flush() {
      nextFlush ??= serial(() => {
        nextFlush = null;
        return runFlush();
      });
      return nextFlush;
    },
    remove(clientId) {
      return serial(async (): Promise<RemoveResult> => {
        const item = await store.get(clientId);
        if (!item) {
          return { removed: false, sentId: sentIds.get(clientId) ?? null };
        }
        await store.delete(clientId);
        await changed(false);
        return { removed: true };
      });
    },
    clear() {
      return serial(async () => {
        await store.clear();
        await changed(false);
      });
    },
  };
}

/**
 * One try to send a transaction, sorted by the outbox's rules: 200 or 201
 * is sent; no connection, a 5xx, a 401 (locked or signed out) or a "try
 * later" status waits; any other 4xx is a refusal with the server's reason.
 */
export async function postTransaction(
  body: OutboxBody,
  deps: { fetch?: typeof fetch; isOnline?: () => boolean } = {},
): Promise<SendOutcome> {
  const isOnline = deps.isOnline ?? (() => navigator.onLine);
  if (!isOnline()) return { kind: 'waiting', reason: 'offline' };
  const send = deps.fetch ?? ((...args) => fetch(...args));
  let response: Response;
  try {
    response = await send('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'waiting', reason: 'network' };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 200 || response.status === 201) {
    return { kind: 'sent', id: idOf(payload), payload };
  }
  // Locked or signed out: it waits for a sign-in (D2). A session that has
  // no profile yet waits for one to be chosen; the item is not at fault.
  if (response.status === 401 || isProfileRequired(response, payload)) {
    return { kind: 'waiting', reason: 'auth' };
  }
  if (response.status >= 500 || TRANSIENT.has(response.status)) {
    return { kind: 'waiting', reason: 'server' };
  }
  return { kind: 'failed', message: refusalMessage(payload) };
}

function isProfileRequired(response: Response, payload: unknown): boolean {
  const code = (payload as { error?: { code?: string } } | null)?.error?.code;
  return response.status === 403 && code === 'profile_required';
}

function idOf(payload: unknown): number | null {
  const body = payload as {
    id?: unknown;
    transaction?: { id?: unknown };
  } | null;
  const id = body?.id ?? body?.transaction?.id;
  return typeof id === 'number' ? id : null;
}

/**
 * The server's reason for a refusal: the first field message when it names
 * one (the more exact), else its message.
 */
function refusalMessage(payload: unknown): string {
  const error = (
    payload as {
      error?: { message?: string; fields?: Record<string, string> };
    } | null
  )?.error;
  const field = Object.values(error?.fields ?? {})[0];
  return field ?? error?.message ?? 'The server refused it.';
}

function broadcastChannel(): OutboxChannel | null {
  // Only in a page: Node has the class too, and an open channel there
  // would keep a test run alive.
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined')
    return null;
  const channel = new BroadcastChannel('bb-outbox');
  return {
    post: (message) => channel.postMessage(message),
    listen: (listener) => {
      channel.onmessage = (event: MessageEvent<{ sent: boolean }>) =>
        listener(event.data);
    },
  };
}

/** The app's outbox, kept in IndexedDB. */
export const outbox: Outbox = createOutbox({
  store: deviceStore<OutboxItem>('outbox'),
  channel: broadcastChannel(),
});

let started = false;

/**
 * Starts sending on its own: now, when the connection returns, when the
 * page comes back to the foreground, after a sign-in, and every 30 s while
 * items wait and the page is visible. Safari has no background sync, so
 * nothing is sent while the app is closed.
 */
export function startOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const flush = () => void outbox.flush().catch(() => undefined);
  void outbox
    .load()
    .then(flush)
    .catch(() => undefined);
  void navigator.storage?.persist?.().catch(() => false);
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  watch(
    () => authState.value?.member?.id ?? null,
    (member) => {
      if (member !== null) flush();
    },
  );
  window.setInterval(() => {
    const waits = outbox.items.value.some((item) => item.state === 'waiting');
    if (waits && document.visibilityState === 'visible') flush();
  }, RETRY_INTERVAL_MS);
}
