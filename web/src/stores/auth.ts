import { shallowRef } from 'vue';
import {
  authMeResponseSchema,
  sessionLockedCode,
  type AuthMeResponse,
} from '@budget-buddy/shared';

/** Current server-confirmed session, profile list and device preferences. */
export const authState = shallowRef<AuthMeResponse | null>(null);

/**
 * Why the sign-in screen is showing, when it is not just a signed-out
 * device: the app was away for more than five minutes (MEM-7). Cleared by a
 * sign-in. Held in memory only.
 */
export const signInReason = shallowRef<'locked' | null>(null);

/** Whether a 401 body is the server's "locked by time away" answer. */
export async function isLockedAnswer(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: string };
    };
    return body.error?.code === sessionLockedCode;
  } catch {
    return false;
  }
}

/** Fetches the current session and clears local state when it has ended. */
export async function refreshAuthState(): Promise<AuthMeResponse | null> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) {
    authState.value = null;
    if (await isLockedAnswer(response)) signInReason.value = 'locked';
    return null;
  }
  if (!response.ok) throw new Error('Could not check the sign-in state.');
  const state = authMeResponseSchema.parse(await response.json());
  authState.value = state;
  signInReason.value = null;
  return state;
}

/** Replaces local authentication state after a confirmed profile change. */
export function setAuthState(state: AuthMeResponse | null): void {
  authState.value = state;
}
