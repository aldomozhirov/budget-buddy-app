/**
 * Whether this browser can read the clipboard after a tap, which a Paste
 * button needs (UI-AMT-5). iOS shows its own Paste bubble before it gives
 * the text; a browser without the API shows no Paste button.
 */
export function canReadClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.readText === 'function'
  );
}
