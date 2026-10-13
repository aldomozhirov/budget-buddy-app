import { afterEach, describe, expect, it, vi } from 'vitest';
import { returnPath, signInLocation } from '../src/session/lock.js';
import { signInReason } from '../src/stores/auth.js';

describe('returnPath', () => {
  it('keeps a path inside the app, with its query', () => {
    expect(returnPath('/accounts/12')).toBe('/accounts/12');
    expect(returnPath('/check-ins?x=1#top')).toBe('/check-ins?x=1#top');
  });

  it.each([
    'https://evil.example/accounts',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'accounts',
    '',
    '/sign-in',
    '/sign-in?next=/accounts',
    '/setup',
    '/dev/components',
    undefined,
    null,
    ['/accounts'],
  ])('sends %j to Home', (value) => {
    expect(returnPath(value)).toBe('/');
  });
});

describe('signInLocation', () => {
  afterEach(() => {
    signInReason.value = null;
    vi.unstubAllGlobals();
  });

  it('names the screen to return to, unless it is Home', () => {
    expect(signInLocation('/accounts')).toEqual({
      path: '/sign-in',
      query: { next: '/accounts' },
    });
    expect(signInLocation('/')).toEqual({ path: '/sign-in' });
    expect(signInLocation('/sign-in')).toEqual({ path: '/sign-in' });
  });

  it('uses the screen kept when the app was left, for a load that starts at Home after a lock', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '/check-ins/3',
      removeItem: () => undefined,
      setItem: () => undefined,
    });
    expect(signInLocation('/')).toEqual({ path: '/sign-in' });
    signInReason.value = 'locked';
    expect(signInLocation('/')).toEqual({
      path: '/sign-in',
      query: { next: '/check-ins/3' },
    });
    // A path that was asked for wins over the one kept.
    expect(signInLocation('/accounts')).toEqual({
      path: '/sign-in',
      query: { next: '/accounts' },
    });
  });

  it('ignores a kept screen that is not a path inside the app', () => {
    signInReason.value = 'locked';
    vi.stubGlobal('localStorage', {
      getItem: () => 'https://evil.example',
      removeItem: () => undefined,
      setItem: () => undefined,
    });
    expect(signInLocation('/')).toEqual({ path: '/sign-in' });
  });
});
