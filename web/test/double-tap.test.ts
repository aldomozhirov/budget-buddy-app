import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDoubleTap,
  DOUBLE_TAP_MS,
} from '../src/composables/useClipboard.js';

describe('createDoubleTap', () => {
  let now = 0;
  afterEach(() => vi.restoreAllMocks());

  /** A tracker whose taps happen at `now`, which each test moves on. */
  function tracker(): (target?: string) => boolean {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    return createDoubleTap();
  }

  it('counts a second tap within the window, not the first', () => {
    const isDoubleTap = tracker();
    expect(isDoubleTap()).toBe(false);
    now += DOUBLE_TAP_MS;
    expect(isDoubleTap()).toBe(true);
  });

  it('does not count two taps further apart than the window', () => {
    const isDoubleTap = tracker();
    isDoubleTap();
    now += DOUBLE_TAP_MS + 1;
    expect(isDoubleTap()).toBe(false);
    // That tap starts a new pair.
    now += 100;
    expect(isDoubleTap()).toBe(true);
  });

  it('starts a new pair on a third quick tap', () => {
    const isDoubleTap = tracker();
    isDoubleTap();
    now += 100;
    expect(isDoubleTap()).toBe(true);
    now += 100;
    expect(isDoubleTap()).toBe(false);
    now += 100;
    expect(isDoubleTap()).toBe(true);
  });

  it('does not pair quick taps on two targets', () => {
    const isDoubleTap = tracker();
    isDoubleTap('amount');
    now += 100;
    expect(isDoubleTap('arrive')).toBe(false);
    now += 100;
    expect(isDoubleTap('amount')).toBe(false);
    now += 100;
    expect(isDoubleTap('amount')).toBe(true);
  });
});
