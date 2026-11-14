import { beforeEach, describe, expect, it } from 'vitest';
import {
  pendingWishMessage,
  takeWishMessage,
} from '../src/screens/wishes/wishMessage.js';

describe('wish message hand-off', () => {
  beforeEach(() => {
    pendingWishMessage.value = null;
  });

  it('returns null when nothing is pending', () => {
    expect(takeWishMessage()).toBeNull();
  });

  it('hands the message over once and clears it', () => {
    const message = { text: 'Wish deleted.', undo: null, month: '2026-12' };
    pendingWishMessage.value = message;
    // A ref wraps the object in a reactive proxy, so compare by value.
    expect(takeWishMessage()).toEqual(message);
    expect(pendingWishMessage.value).toBeNull();
    expect(takeWishMessage()).toBeNull();
  });

  it('keeps the Undo call of the message', async () => {
    let called = 0;
    pendingWishMessage.value = {
      text: 'Dropped.',
      undo: async () => {
        called += 1;
      },
    };
    await takeWishMessage()?.undo?.();
    expect(called).toBe(1);
  });
});
