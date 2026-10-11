import {
  pushKeyResponseSchema,
  pushSubscriptionResponseSchema,
  type PushSubscriptionRequest,
} from '@budget-buddy/shared';

/**
 * What this device can do about notifications: `unsupported` (no push in this
 * browser, or not in the installed app), `denied` (blocked in the system
 * settings), `off`, or `on`.
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

/** Why turning notifications on did not work. */
export type EnablePushFailure = 'denied' | 'dismissed' | 'failed';

const jsonHeaders = { 'content-type': 'application/json' };

/** The service worker registration, or null when the page has none. */
async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return null;
  }
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/**
 * Reads this device's state without asking for anything. A subscription the
 * browser holds counts as `on` only while the server holds this device's row:
 * after a family password change dropped it (D9) the state is `off` until the
 * member opts in again. With `sync`, a subscription both sides hold is sent
 * again, which moves it to the profile now in use. When the server cannot be
 * reached the browser's word is taken.
 */
export async function readPushState(sync = false): Promise<PushState> {
  const registration = await currentRegistration();
  if (!registration) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription || Notification.permission !== 'granted') return 'off';
  try {
    if (!(await serverHoldsSubscription())) return 'off';
    if (sync) await sendSubscription(subscription);
  } catch {
    // Offline: the device is still subscribed; the next visit checks again.
  }
  return 'on';
}

/**
 * Asks for permission and subscribes this device. Call it straight from the
 * tap on "Continue": iOS only shows its question after a tap, and the
 * permission request is the first thing awaited so that it stays one.
 */
export async function enablePush(): Promise<
  { ok: true } | { ok: false; reason: EnablePushFailure }
> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };
  try {
    if (!(await currentRegistration())) return { ok: false, reason: 'failed' };
    // Subscribing needs an active worker, which a fresh registration lacks.
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await fetch('/api/push/key');
    if (!keyResponse.ok) return { ok: false, reason: 'failed' };
    const { publicKey } = pushKeyResponseSchema.parse(await keyResponse.json());
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
    try {
      await sendSubscription(subscription);
    } catch (error) {
      // Not known to the server, so it would never be told: drop it again.
      await subscription.unsubscribe();
      throw error;
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Turns notifications off for this device, here and on the server. */
export async function disablePush(): Promise<boolean> {
  const response = await fetch('/api/push/subscription', {
    method: 'DELETE',
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });
  if (!response.ok) return false;
  const registration = await currentRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  return true;
}

/** Whether the server holds a subscription row for this device. */
async function serverHoldsSubscription(): Promise<boolean> {
  const response = await fetch('/api/push/subscription');
  if (!response.ok) throw new Error('The server could not say.');
  return pushSubscriptionResponseSchema.parse(await response.json()).subscribed;
}

async function sendSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const body: PushSubscriptionRequest = {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
  const response = await fetch('/api/push/subscription', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('The server refused the subscription.');
}

/** Decodes the URL-safe base64 VAPID key into the bytes `subscribe` wants. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
