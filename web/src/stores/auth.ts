import { shallowRef } from 'vue';
import {
  authMeResponseSchema,
  type AuthMeResponse,
} from '@budget-buddy/shared';

/** Current server-confirmed session, profile list and device preferences. */
export const authState = shallowRef<AuthMeResponse | null>(null);

/** Fetches the current session and clears local state when it has ended. */
export async function refreshAuthState(): Promise<AuthMeResponse | null> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) {
    authState.value = null;
    return null;
  }
  if (!response.ok) throw new Error('Could not check the sign-in state.');
  const state = authMeResponseSchema.parse(await response.json());
  authState.value = state;
  return state;
}

/** Replaces local authentication state after a confirmed profile change. */
export function setAuthState(state: AuthMeResponse | null): void {
  authState.value = state;
}
