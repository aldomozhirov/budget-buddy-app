import {
  wishResponseSchema,
  type Wish,
  type WishState,
} from '@budget-buddy/shared';
import { ApiError, callApi } from '../../api/callApi.js';

/** What a 409 says: the wish changed since the screen last read it. */
export const WISH_CHANGED = 'Someone changed it meanwhile.';

/** How long a message with Undo stays. */
export const UNDO_MS = 8000;

/** True when the call failed because the wish is no longer as expected. */
export function isWishConflict(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409;
}

/** The text of a failed wish call, "changed" included. */
export function wishFailure(cause: unknown): string {
  if (isWishConflict(cause)) return WISH_CHANGED;
  return cause instanceof ApiError && cause.status !== 0
    ? cause.message
    : 'Could not reach the server. Check your connection and try again.';
}

/**
 * Sets a wish's state, only while it is still in `expect.state`.
 * @throws {ApiError} on a 409 when someone changed the wish first.
 */
export async function patchWishState(
  id: number,
  state: WishState,
  expect: { state: WishState },
): Promise<Wish> {
  const answer = await callApi(
    'PATCH',
    `/api/wishes/${id}`,
    wishResponseSchema,
    { state, expect },
  );
  return answer.wish;
}
