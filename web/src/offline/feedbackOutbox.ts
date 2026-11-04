import { readonly, ref } from 'vue';
import type { FeedbackRequest } from '@budget-buddy/shared';
import { deviceStore, type RecordStore } from './db.js';
import { sendAtOutboxMoments } from './sendTriggers.js';

/**
 * The feedback outbox (spec 8, Design 4; FBK-4): a report is written to the
 * phone first and leaves once the server has it, so a report written offline
 * sends itself later. The server's `clientId` check makes a repeat harmless.
 */

/** How long one try to send a report may take before it waits for later. */
export const FEEDBACK_SEND_MS = 10_000;

/**
 * A report on the phone: the body of `POST /api/feedback`, with the
 * screenshot as base64 text, since older Safari stores a `Blob` badly.
 */
export type FeedbackItem = FeedbackRequest;

/**
 * What one try came to: `sent` (the server has it), `waiting` (try again
 * later) or `refused` (the server will never take it).
 */
export type FeedbackOutcome = 'sent' | 'waiting' | 'refused';

/** Statuses that say "try again later" rather than "this is wrong". */
const TRANSIENT = new Set([408, 425, 429]);

/** The feedback outbox of one page, over a store that outlives it. */
export interface FeedbackOutbox {
  /** How many reports wait on the phone, as of the last read. */
  readonly waiting: Readonly<{ value: number }>;
  /** Reads the reports from the store. */
  load(): Promise<void>;
  /**
   * Sends the reports, oldest first, one at a time, and removes those the
   * server has or refused. Calls made while a flush runs share the next one.
   */
  flush(): Promise<void>;
  /**
   * Saves a report, then tries to send it, waiting at most `timeoutMs`.
   * @returns `sent` once it has left the phone, else `saved`.
   */
  send(item: FeedbackItem, timeoutMs?: number): Promise<'sent' | 'saved'>;
  /** Deletes every report (sign-out). */
  clear(): Promise<void>;
}

/** Builds a feedback outbox; the app uses `feedbackOutbox`, tests a fake. */
export function createFeedbackOutbox(options: {
  store: RecordStore<FeedbackItem>;
  fetch?: typeof fetch;
  /** Whether the browser says it has a connection. */
  isOnline?: () => boolean;
}): FeedbackOutbox {
  const { store } = options;
  const waiting = ref(0);

  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  }
  let nextFlush: Promise<void> | null = null;

  async function oldestFirst(): Promise<FeedbackItem[]> {
    const all = await store.getAll();
    waiting.value = all.length;
    return all.sort(
      (a, b) => Date.parse(a.writtenAt) - Date.parse(b.writtenAt),
    );
  }

  async function runFlush(): Promise<void> {
    for (const listed of await oldestFirst()) {
      // Another tab may have sent it since the list was read.
      const item = await store.get(listed.clientId);
      if (!item) continue;
      const outcome = await postFeedback(item, {
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.isOnline ? { isOnline: options.isOnline } : {}),
      });
      // No connection, no session or a busy server: the rest would wait too.
      if (outcome === 'waiting') break;
      // A refused report is dropped too: the design has no place for it (O7).
      await store.delete(item.clientId);
    }
    await oldestFirst();
  }

  function flush(): Promise<void> {
    nextFlush ??= serial(() => {
      nextFlush = null;
      return runFlush();
    });
    return nextFlush;
  }

  return {
    waiting: readonly(waiting),
    load: async () => {
      await oldestFirst();
    },
    flush,
    async send(item, timeoutMs = FEEDBACK_SEND_MS) {
      await store.put(item);
      waiting.value += 1;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        flush().catch(() => undefined),
        new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs))),
      ]);
      clearTimeout(timer);
      return (await store.get(item.clientId)) ? 'saved' : 'sent';
    },
    clear: () =>
      serial(async () => {
        await store.clear();
        waiting.value = 0;
      }),
  };
}

/**
 * One try to send a report, sorted by the rules of spec 8 Design 4: 200 or
 * 201 is sent; no connection, no answer within `timeoutMs`, a 5xx, a 401
 * (signed out or locked, O6), a session without a profile yet or a "try
 * later" status waits; any other 4xx is refused.
 */
export async function postFeedback(
  item: FeedbackItem,
  deps: {
    fetch?: typeof fetch;
    isOnline?: () => boolean;
    timeoutMs?: number;
  } = {},
): Promise<FeedbackOutcome> {
  const isOnline = deps.isOnline ?? (() => navigator.onLine);
  if (!isOnline()) return 'waiting';
  const send = deps.fetch ?? ((...args) => fetch(...args));
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? FEEDBACK_SEND_MS,
  );
  let response: Response;
  try {
    response = await send('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: controller.signal,
    });
  } catch {
    return 'waiting';
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 200 || response.status === 201) return 'sent';
  if (
    response.status === 401 ||
    response.status >= 500 ||
    TRANSIENT.has(response.status)
  ) {
    return 'waiting';
  }
  if (response.status === 403) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    if (payload?.error?.code === 'profile_required') return 'waiting';
  }
  return 'refused';
}

/** The app's feedback outbox, kept in IndexedDB. */
export const feedbackOutbox: FeedbackOutbox = createFeedbackOutbox({
  store: deviceStore<FeedbackItem>('feedback'),
});

/**
 * Saves a report on the phone and tries to send it at once, for at most
 * 10 s. @returns `sent` or `saved`, for the toast of the sheet.
 * @throws when the phone cannot store it (no IndexedDB).
 */
export function sendFeedback(item: FeedbackItem): Promise<'sent' | 'saved'> {
  return feedbackOutbox.send(item);
}

let started = false;

/** Starts sending waiting reports on their own, as the outbox does. */
export function startFeedbackOutbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  sendAtOutboxMoments(
    () => void feedbackOutbox.flush().catch(() => undefined),
    () => feedbackOutbox.waiting.value > 0,
  );
}
