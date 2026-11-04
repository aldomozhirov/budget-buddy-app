/** Kind of device this browser runs on, from its user agent. */
export type DeviceType = 'iPhone' | 'iPad' | 'other';

/**
 * The kind of this device. An iPad that asks for desktop sites says
 * "Macintosh", and is told apart from a Mac by its touch points.
 */
export function deviceType(
  nav:
    | Pick<Navigator, 'userAgent' | 'maxTouchPoints'>
    | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): DeviceType {
  if (!nav) return 'other';
  const userAgent = nav.userAgent;
  if (/iPhone|iPod/i.test(userAgent)) return 'iPhone';
  if (
    /iPad/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && nav.maxTouchPoints > 1)
  ) {
    return 'iPad';
  }
  return 'other';
}

/** Names this browser's device for profile and remembered-login copy. */
export function deviceName(): 'this iPhone' | 'this iPad' | 'this device' {
  const type = deviceType();
  return type === 'other' ? 'this device' : `this ${type}`;
}
