import type { FeedbackDevice } from '@budget-buddy/shared';
import { deviceType } from '../../device.js';

/**
 * The device details sent with a report (FBK-2, spec 8 Design 5). They come
 * from the browser and the router's history only, never from the app's
 * stores, so a report holds no amount and no name from the family's data.
 */

/** What the browser tells about itself, injectable for tests. */
export interface BrowserFacts {
  userAgent: string;
  maxTouchPoints: number;
  /** Whether the page runs as a Home Screen app. */
  standalone: boolean;
}

/** Longest values the server accepts (shared/src/api/feedback.ts). */
const MAX_OS = 40;
const MAX_SCREEN = 200;
const MAX_USER_AGENT = 400;

function currentBrowser(): BrowserFacts {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      nav.standalone === true,
  };
}

/**
 * The path of the screen open before Settings: Vue Router keeps it in
 * `history.state.back` (O5). The query and hash are dropped, since a search
 * could hold a name; what is left holds ids at most.
 * @returns A path starting with "/", or null when Settings was opened first.
 * @example screenBeforeSettings({ back: '/transactions/412?q=x' }) // '/transactions/412'
 */
export function screenBeforeSettings(
  state: unknown = typeof history === 'undefined' ? null : history.state,
): string | null {
  const back = (state as { back?: unknown } | null)?.back;
  if (typeof back !== 'string') return null;
  const path = back.split(/[?#]/u, 1)[0] ?? '';
  return path.startsWith('/') ? path.slice(0, MAX_SCREEN) : null;
}

/**
 * The iOS version in a user agent, as "iOS 26.1".
 * @returns null when the user agent names none, as an iPad asking for
 * desktop sites does.
 * @example iosVersion('… iPhone OS 26_1 like Mac OS X …') // 'iOS 26.1'
 */
export function iosVersion(userAgent: string): string | null {
  const match = /\bOS (\d+)[_.](\d+)(?:[_.](\d+))?\b/u.exec(userAgent);
  if (!match) return null;
  const parts = match.slice(1).filter((part) => part !== undefined);
  return `iOS ${parts.join('.')}`.slice(0, MAX_OS);
}

/**
 * The `device` of a report.
 * @param fromScreen The screen before Settings, read when Settings opened.
 */
export function feedbackDetails(
  fromScreen: string | null,
  browser: BrowserFacts = currentBrowser(),
): FeedbackDevice {
  const type = deviceType(browser);
  return {
    type,
    os: type === 'other' ? null : iosVersion(browser.userAgent),
    display: browser.standalone ? 'standalone' : 'browser',
    fromScreen,
    userAgent: browser.userAgent.slice(0, MAX_USER_AGENT),
  };
}
