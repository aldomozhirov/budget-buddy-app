import { forgetLastScreen } from '../session/lock.js';
import { setAuthState } from '../stores/auth.js';
import { outbox } from './outbox.js';

/**
 * Sign-out with items on the phone (spec 2 Design 4, UI-HOME-8), shared by
 * the profile sheet and Settings: send what waits first, ask about the rest,
 * then sign out and delete the outbox.
 */

/** How long sign-out waits for the outbox to send before it asks. */
export const SIGN_OUT_SEND_MS = 10_000;

/**
 * Sends what waits, giving up after `SIGN_OUT_SEND_MS` on a stalled
 * connection. @returns How many items are still on the phone.
 */
export async function sendBeforeSignOut(): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    outbox.flush().catch(() => undefined),
    new Promise((resolve) => (timer = setTimeout(resolve, SIGN_OUT_SEND_MS))),
  ]);
  clearTimeout(timer);
  return outbox.items.value.length;
}

/**
 * Ends the session on the server, then deletes the outbox, since nothing
 * stays on the phone after a sign-out (D3), and forgets the session here.
 * @throws when the server cannot be reached or refuses.
 */
export async function signOutDevice(): Promise<void> {
  const response = await fetch('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error('Sign-out failed.');
  await outbox.clear().catch(() => undefined);
  setAuthState(null);
  forgetLastScreen();
}
