/** What a push notification shows and opens, as the server sends it. */
export type PushPayload = {
  title: string;
  body: string;
  /** In-app path opened by a tap, e.g. `/check-ins/12` (UI-NAV-6). */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
};

/**
 * Shown when a push arrives empty or damaged. iOS withdraws the permission of
 * a web app that receives a push and shows nothing, so something is always
 * shown, and it never claims to know what happened.
 */
export const fallbackPayload: PushPayload = {
  title: 'Budget Buddy',
  body: 'Open the app to see what’s new.',
  url: '/check-ins',
  tag: 'budget-buddy',
};

/**
 * True for a path inside this app; rejects other origins, `//host` and
 * `/\host`, which browsers read as the same thing.
 */
export function isAppPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  );
}

/**
 * Reads the text of a push event. Anything that is not the expected JSON
 * object falls back field by field to `fallbackPayload`.
 */
export function parsePushPayload(text: string | null | undefined): PushPayload {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text ?? '');
    if (typeof parsed === 'object' && parsed !== null) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: the fallback below applies.
  }
  const text_ = (value: unknown, fallback: string) =>
    typeof value === 'string' && value !== '' ? value : fallback;
  return {
    title: text_(data.title, fallbackPayload.title),
    body: text_(data.body, fallbackPayload.body),
    url: isAppPath(data.url) ? data.url : fallbackPayload.url,
    tag: text_(data.tag, fallbackPayload.tag),
  };
}
