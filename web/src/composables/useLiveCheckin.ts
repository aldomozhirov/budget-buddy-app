import { computed, onScopeDispose, ref, watch } from 'vue';
import { liveEventsPath, liveSignalSchema } from '@budget-buddy/shared';
import { isOnline } from './useOnline.js';

/** How often an open check-in is re-read as a safety net for the stream. */
export const livePollIntervalMs = 30_000;

/** How long to wait before opening a stream the browser gave up on. */
const reopenDelayMs = 10_000;

/**
 * Keeps a screen in step with the family's open check-in. While the check-in
 * is open and the page is visible and online, it holds one server-sent events
 * stream (`/api/events`) and polls slowly; both only ask `onRead` to re-read
 * the check-in through the normal API, so the API stays the source of truth.
 * The stream and the poll are off while hidden or offline (IOS-6) and once the
 * check-in is closed or the screen is left.
 * @param options.isOpen Whether the screen shows an open check-in.
 * @param options.checkinId The check-in the screen shows.
 * @param options.onRead Re-reads the check-in. `signal` is true when the
 *   server said something changed; a read that is already running may then
 *   miss it, so the caller reads again.
 */
export function useLiveCheckin(options: {
  isOpen: () => boolean;
  checkinId: () => number | null;
  onRead: (signal: boolean) => void;
}): void {
  const visible = ref(document.visibilityState === 'visible');
  const running = computed(
    () => options.isOpen() && visible.value && isOnline.value,
  );
  let source: EventSource | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let reopen: ReturnType<typeof setTimeout> | undefined;

  function onVisibility(): void {
    visible.value = document.visibilityState === 'visible';
    // iOS drops the connections of a backgrounded Home Screen app, so a
    // return to the foreground re-reads whatever the stream missed.
    if (visible.value && options.isOpen()) options.onRead(false);
  }

  function connect(): void {
    reopen = undefined;
    const stream = new EventSource(liveEventsPath);
    source = stream;
    // Every (re)connect re-reads: a signal sent while the stream was down
    // is not replayed.
    stream.onopen = () => options.onRead(false);
    stream.onmessage = (event: MessageEvent<string>) => {
      let signal: ReturnType<typeof liveSignalSchema.safeParse>;
      try {
        signal = liveSignalSchema.safeParse(JSON.parse(event.data));
      } catch {
        return;
      }
      if (signal.success && signal.data.checkinId === options.checkinId())
        options.onRead(true);
    };
    stream.onerror = () => {
      // The browser retries a dropped connection by itself; it gives up
      // (CLOSED) on an HTTP error, which is then retried here.
      if (stream.readyState !== EventSource.CLOSED) return;
      stream.close();
      if (source === stream) source = undefined;
      reopen = setTimeout(connect, reopenDelayMs);
    };
  }

  function start(): void {
    stop();
    connect();
    poll = setInterval(() => options.onRead(false), livePollIntervalMs);
  }

  function stop(): void {
    source?.close();
    source = undefined;
    if (poll !== undefined) clearInterval(poll);
    poll = undefined;
    if (reopen !== undefined) clearTimeout(reopen);
    reopen = undefined;
  }

  document.addEventListener('visibilitychange', onVisibility);
  watch(running, (run) => (run ? start() : stop()), { immediate: true });
  onScopeDispose(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  });
}
