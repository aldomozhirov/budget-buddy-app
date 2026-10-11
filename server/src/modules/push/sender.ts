import webpush from 'web-push';
import { isAllowedPushEndpoint } from './endpoints.js';
import type { VapidKeys } from './vapid.js';

/** A browser's Web Push endpoint and the keys that encrypt payloads for it. */
export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Outcome of one delivery attempt. `statusCode` is the push service's HTTP
 * status, absent when it could not be reached.
 */
export type PushResult =
  { ok: true } | { ok: false; statusCode: number | undefined };

/** Sends one payload to one subscription; the only door to a push service. */
export interface PushSender {
  /** Never rejects: failures come back as `{ ok: false }`. */
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

/** Push services keep an undelivered message for this long. */
const timeToLiveSeconds = 24 * 60 * 60;
const requestTimeoutMs = 10_000;

/** `PushSender` over `web-push`, signing requests with the VAPID keys. */
export function createWebPushSender(options: {
  keys: VapidKeys;
  /** `mailto:` or `https:` contact for the push service operators. */
  subject: string;
  /**
   * Hosts a push may go to (SEC-8). A stored subscription on another host,
   * for example after the list was narrowed, is not sent to.
   */
  allowedHosts: readonly string[];
  /** Replaces `web-push`'s own request, so tests never reach a service. */
  transport?: typeof webpush.sendNotification;
}): PushSender {
  const transport = options.transport ?? webpush.sendNotification;
  const vapidDetails = { ...options.keys, subject: options.subject };
  return {
    async send(target, payload) {
      if (!isAllowedPushEndpoint(target.endpoint, options.allowedHosts)) {
        return { ok: false, statusCode: undefined };
      }
      try {
        await transport(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          payload,
          {
            vapidDetails,
            TTL: timeToLiveSeconds,
            timeout: requestTimeoutMs,
            urgency: 'normal',
          },
        );
        return { ok: true };
      } catch (error) {
        const statusCode =
          error instanceof webpush.WebPushError ? error.statusCode : undefined;
        return { ok: false, statusCode };
      }
    },
  };
}
