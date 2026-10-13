import { ref, watch } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';
import {
  deviceLockSchema,
  presenceIntervalMs,
  presencePath,
  reopenLockAfterMs,
} from '@budget-buddy/shared';
import { isAppPath } from '../push/payload.js';
import {
  authState,
  isLockedAnswer,
  refreshAuthState,
  setAuthState,
  signInReason,
} from '../stores/auth.js';

/**
 * The page's side of "sign in again when the app is re-opened" (MEM-7,
 * SEC-9). The rule itself is the server's: a session whose app has not said
 * it is in use for more than five minutes is refused. This module is how a
 * visible page says so, and how it finds out it was refused.
 */

/** Where the last screen is kept for a sign-in after a fresh load. */
const lastScreenKey = 'bb.lastScreen';

/**
 * True once this page has decided the device is locked and shows sign-in.
 * Route guards read it, because offline the server cannot be asked.
 */
export const lockedHere = ref(false);

let router: Router | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let lastAliveAt = Date.now();
/** True between leaving the foreground and coming back. */
let awayNow = false;

/** An in-app path that a sign-in may return to. */
function isReturnable(path: unknown): path is string {
  return isAppPath(path) && !/^\/(sign-in|setup|dev)(?:[/?#]|$)/u.test(path);
}

/**
 * Checks the `next` query of the sign-in screen and returns the path it
 * names, or `/` for anything that is not a path inside this app.
 */
export function returnPath(value: unknown): string {
  return isReturnable(value) ? value : '/';
}

/** Forgets the kept screen, as a sign-out does. */
export function forgetLastScreen(): void {
  try {
    localStorage.removeItem(lastScreenKey);
  } catch {
    // Nothing was kept.
  }
}

function readLastScreen(): string | null {
  try {
    const stored = localStorage.getItem(lastScreenKey);
    return isReturnable(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the screen the member is on, so a fresh load after a lock (a Home
 * Screen app starts at `/`, not where it was left) can return to it. Home is
 * the start screen and is not kept.
 */
function rememberScreen(): void {
  if (!router) return;
  const path = router.currentRoute.value.fullPath;
  try {
    if (path !== '/' && isReturnable(path)) {
      localStorage.setItem(lastScreenKey, path);
    } else {
      localStorage.removeItem(lastScreenKey);
    }
  } catch {
    // Without storage the app returns to Home, as a fresh sign-in does.
  }
}

/**
 * Where to send a device that has to sign in, so the sign-in can return it to
 * `from`. After a lock, a fresh load that landed on `/` returns to the screen
 * kept when the page was left.
 */
export function signInLocation(from: string): RouteLocationRaw {
  const next =
    isReturnable(from) && from !== '/'
      ? from
      : signInReason.value === 'locked'
        ? readLastScreen()
        : null;
  return next ? { path: '/sign-in', query: { next } } : { path: '/sign-in' };
}

/**
 * Sends the page to sign-in after a request answered 401, remembering where
 * it was. It asks the server why first, so a lock gets its own note.
 */
export async function goToSignIn(): Promise<void> {
  if (!router) return;
  const here = router.currentRoute.value.fullPath;
  await refreshAuthState().catch(() => null);
  setAuthState(null);
  await router.replace(signInLocation(here));
}

/** Whether this device asks to sign in again, as the server last said. */
function lockSetting(): boolean {
  return authState.value?.device.lockOnReopen !== false;
}

/** Ends this page's session on screen: it shows sign-in, not the data. */
async function lock(): Promise<void> {
  if (!router || lockedHere.value) return;
  const here = router.currentRoute.value.fullPath;
  stopTimer();
  rememberScreen();
  lockedHere.value = true;
  signInReason.value = 'locked';
  setAuthState(null);
  const location = signInLocation(here);
  await router.replace(location).catch(() => undefined);
  if (router.currentRoute.value.path !== '/sign-in') {
    // The sign-in screen could not be loaded (offline, and not kept by the
    // service worker); a full load shows the cached shell instead of
    // leaving the data on screen.
    window.location.assign(router.resolve(location).fullPath);
  }
}

type Sent = 'ok' | 'locked' | 'failed';

/**
 * Tells the server the app is in use; `awayMs` is how long it was not.
 * @param leaving True for the call made as the page leaves the foreground,
 *   which must not be cancelled with the page.
 */
async function sendPresence(awayMs: number, leaving = false): Promise<Sent> {
  try {
    const response = await fetch(presencePath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ awayMs }),
      keepalive: leaving,
    });
    if (await isLockedAnswer(response)) return 'locked';
    if (!response.ok) return 'failed';
    const setting = deviceLockSchema.safeParse(await response.json());
    const state = authState.value;
    if (
      setting.success &&
      state &&
      state.device.lockOnReopen !== setting.data.lockOnReopen
    ) {
      setAuthState({
        ...state,
        device: { ...state.device, lockOnReopen: setting.data.lockOnReopen },
      });
    }
    return 'ok';
  } catch {
    return 'failed';
  }
}

/**
 * How long the page was out of the foreground since it last looked, then
 * marks it alive now. Timers run while the page is visible, so a gap longer
 * than two beats is time spent hidden, frozen or asleep; a shorter one is
 * not counted.
 */
function takeAway(): number {
  const now = Date.now();
  const gap = now - lastAliveAt;
  lastAliveAt = now;
  return gap > presenceIntervalMs * 2 ? gap : 0;
}

/**
 * Reports being in use and acts on the answer. Offline, where the server
 * cannot refuse, a page that was away for more than five minutes locks
 * itself, so the screen does not stay readable for whoever holds the phone.
 */
async function report(awayMs: number): Promise<void> {
  const sent = await sendPresence(awayMs);
  if (
    sent === 'locked' ||
    (sent === 'failed' && awayMs > reopenLockAfterMs && lockSetting())
  ) {
    await lock();
  }
}

function signedIn(): boolean {
  return authState.value !== null && !lockedHere.value;
}

function tick(): void {
  // Nothing is reported for a page that is out of the foreground: the
  // absence is one call, made on the way back.
  if (awayNow || !signedIn()) return;
  void report(takeAway());
}

function startTimer(): void {
  stopTimer();
  timer = setInterval(tick, presenceIntervalMs);
}

function stopTimer(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

function onHidden(): void {
  // `pagehide` can follow `visibilitychange` once the page is already
  // hidden; the absence is counted from the first of them.
  if (awayNow || !signedIn()) return;
  awayNow = true;
  lastAliveAt = Date.now();
  stopTimer();
  rememberScreen();
  // The last word before the page is gone: the server counts the absence
  // from here, not from the last beat.
  void sendPresence(0, true);
}

function onVisible(): void {
  const returning = awayNow;
  awayNow = false;
  if (!signedIn()) return;
  // One call per return, carrying the whole absence; events that arrive with
  // it (`pageshow`, `online`) do not send another.
  if (returning) void report(takeAway());
  startTimer();
}

/**
 * Starts the presence calls of a signed-in page: every 30 s while visible,
 * on leaving and returning to the foreground, and when the connection comes
 * back. Call once, after the router exists.
 */
export function installSessionLock(appRouter: Router): void {
  router = appRouter;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onVisible();
  });
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) onVisible();
  });
  window.addEventListener('online', () => {
    if (document.visibilityState === 'visible') tick();
  });
  watch(
    authState,
    (state, previous) => {
      if (state === null) {
        stopTimer();
        return;
      }
      // Every navigation refreshes the state; only a page that was signed out
      // starts over. A running timer and the last-alive mark are left alone.
      if (previous !== null) return;
      // Sign-in must open without a connection when the app locks, so its
      // code is loaded while there is one.
      void import('../screens/sign-in/SignInScreen.vue').catch(() => undefined);
      lockedHere.value = false;
      awayNow = false;
      lastAliveAt = Date.now();
      if (document.visibilityState === 'visible') {
        // The server's mark is only as fresh as the last call: say now that
        // the app is open, not 30 s from now.
        void report(0);
        startTimer();
      }
    },
    { flush: 'sync' },
  );
}
