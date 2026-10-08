/** Names this browser's device for profile and remembered-login copy. */
export function deviceName(): 'this iPhone' | 'this iPad' | 'this device' {
  if (typeof navigator === 'undefined') return 'this device';
  const userAgent = navigator.userAgent;
  if (/iPhone|iPod/i.test(userAgent)) return 'this iPhone';
  if (
    /iPad/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  ) {
    return 'this iPad';
  }
  return 'this device';
}
