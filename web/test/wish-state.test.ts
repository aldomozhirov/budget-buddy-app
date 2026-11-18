import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/callApi.js';
import {
  isWishConflict,
  UNDO_MS,
  WISH_CHANGED,
  wishFailure,
} from '../src/screens/wishes/wishState.js';

describe('wish state failures', () => {
  it('knows a 409 as a conflict and words it', () => {
    const conflict = new ApiError('Conflict', 409);
    expect(isWishConflict(conflict)).toBe(true);
    expect(wishFailure(conflict)).toBe(WISH_CHANGED);
    expect(WISH_CHANGED).toBe('Someone changed it meanwhile.');
  });

  it('shows the server message of another error', () => {
    const other = new ApiError('Wish not found.', 404);
    expect(isWishConflict(other)).toBe(false);
    expect(wishFailure(other)).toBe('Wish not found.');
  });

  it('says the server is out of reach when the call never arrived', () => {
    expect(wishFailure(new ApiError('x', 0))).toMatch(/Could not reach/u);
    expect(wishFailure(new Error('boom'))).toMatch(/Could not reach/u);
    expect(isWishConflict(new Error('boom'))).toBe(false);
  });

  it('keeps an Undo message for 8 seconds', () => {
    expect(UNDO_MS).toBe(8000);
  });
});
