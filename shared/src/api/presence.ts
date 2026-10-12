import { z } from 'zod';

/** Path of the call a visible app makes to say it is in use (SEC-9). */
export const presencePath = '/api/session/presence';

/**
 * How long a device may be out of the foreground before the server asks it
 * to sign in again (SEC-9, MEM-7): more than five minutes.
 */
export const reopenLockAfterMs = 5 * 60 * 1000;

/** How often a visible app repeats its presence call. */
export const presenceIntervalMs = 30_000;

/** Error code of the 401 a locked session gets on every route (SEC-9). */
export const sessionLockedCode = 'session_locked';

/**
 * The body of a presence call. `awayMs` is how long this page was out of the
 * foreground since it last told the server it was in use: 0 when it stayed
 * visible the whole time, even if the call could not be sent (offline).
 */
export const presenceRequestSchema = z
  .object({ awayMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
  .strict();

/** A presence call, as the server reads it. */
export type PresenceRequest = z.infer<typeof presenceRequestSchema>;

/** This device's "Sign in again when reopened" switch (MEM-7). */
export const deviceLockSchema = z.object({ lockOnReopen: z.boolean() });

/** Response of `GET` and `PATCH /api/devices/current/lock`. */
export type DeviceLock = z.infer<typeof deviceLockSchema>;

/** Validates a change to this device's "Sign in again when reopened". */
export const updateDeviceLockRequestSchema = z
  .object({ lockOnReopen: z.boolean() })
  .strict();
