import type { FeedbackDevice } from '@budget-buddy/shared';
import { deviceType } from '../../device.js';

/**
 * The device details sent with a report (FBK-2, spec 8 Design 5). They come
 * from the browser only, never from the app's stores, so a report holds
 * no amount and no name from the family's data.
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

/** The `device` of a report. */
export function feedbackDetails(
  browser: BrowserFacts = currentBrowser(),
): FeedbackDevice {
  const type = deviceType(browser);
  return {
    type,
    os: type === 'other' ? null : iosVersion(browser.userAgent),
    display: browser.standalone ? 'standalone' : 'browser',
    userAgent: browser.userAgent.slice(0, MAX_USER_AGENT),
  };
}
