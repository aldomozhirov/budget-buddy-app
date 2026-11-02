/**
 * Whether this browser can read the clipboard after a double tap on an amount
 * (UI-AMT-5). iOS shows its own Paste bubble before it gives the text; a
 * browser without the API leaves the amount as it was.
 */
export function canReadClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.readText === 'function'
  );
}

/** Two taps at most this far apart are a double tap (UI-AMT-5). */
export const DOUBLE_TAP_MS = 350;

/**
 * Returns a function to call on each tap: it says whether this tap completes
 * a double tap on the same `target` as the tap before. The clipboard is read
 * on that second tap, which iOS still counts as a tap for its Paste bubble.
 */
export function createDoubleTap(): (target?: string) => boolean {
  let last = Number.NEGATIVE_INFINITY;
  let lastTarget: string | undefined;
  return (target) => {
    const now = performance.now();
    const double = target === lastTarget && now - last <= DOUBLE_TAP_MS;
    // A third quick tap starts a new pair rather than pasting again.
    last = double ? Number.NEGATIVE_INFINITY : now;
    lastTarget = target;
    return double;
  };
}
