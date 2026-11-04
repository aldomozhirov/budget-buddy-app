import { watch } from 'vue';
import { authState } from '../stores/auth.js';

/** How often items that wait are tried again while the page is visible. */
export const RETRY_INTERVAL_MS = 30_000;

/**
 * Calls `flush` at the moments an outbox sends (spec 2, Design 4): now, when
 * the connection returns, when the page comes back to the foreground, after
 * a sign-in, and every 30 s while `waits()` and the page is visible. Safari
 * has no background sync, so nothing is sent while the app is closed.
 */
export function sendAtOutboxMoments(
  flush: () => void,
  waits: () => boolean,
): void {
  if (typeof window === 'undefined') return;
  flush();
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
    if (waits() && document.visibilityState === 'visible') flush();
  }, RETRY_INTERVAL_MS);
}
