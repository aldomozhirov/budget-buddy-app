/**
 * Whether this browser can read the clipboard after a tap on an amount
 * (UI-AMT-5). iOS shows its own Paste bubble before it gives the text; a
 * browser without the API leaves the amount as it was.
 */
export function canReadClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.readText === 'function'
  );
}
