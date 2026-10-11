import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));
vi.mock('@simplewebauthn/browser', () => browser);

const { disablePasskey, enablePasskey, passkeysSupported, signInWithPasskey } =
  await import('../src/passkey/passkeyClient.js');

const options = { challenge: 'abc_123', rpId: 'budget-buddy.test' };
const credential = { id: 'cred', rawId: 'cred', type: 'public-key' };

/** Replaces `fetch` with answers in order; returns the calls it saw. */
function answer(...responses: Array<[number, unknown]>) {
  const calls: Array<{
    url: string;
    method: string | undefined;
    body: string | undefined;
  }> = [];
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body as string | undefined,
      });
      const [status, body] = queue.shift() ?? [500, {}];
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

function notAllowed(): Error {
  const error = new Error('The operation was cancelled.');
  error.name = 'NotAllowedError';
  return error;
}

beforeEach(() => {
  browser.startRegistration.mockReset();
  browser.startAuthentication.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('turning Face ID on', () => {
  it('asks for options, runs the prompt and sends the credential back', async () => {
    const calls = answer([200, options], [200, { hasPasskey: true }]);
    browser.startRegistration.mockResolvedValue(credential);

    expect(await enablePasskey()).toEqual({ ok: true });
    expect(browser.startRegistration).toHaveBeenCalledWith({
      optionsJSON: options,
    });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/auth/passkey/register/options',
      '/api/auth/passkey/register/verify',
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ response: credential });
  });

  it('treats a cancelled prompt as no change and sends nothing', async () => {
    const calls = answer([200, options]);
    browser.startRegistration.mockRejectedValue(notAllowed());

    expect(await enablePasskey()).toEqual({ ok: false, reason: 'cancelled' });
    expect(calls).toHaveLength(1);
  });

  it('reports the server’s refusal', async () => {
    answer([403, { error: { message: 'Face ID needs the https address.' } }]);
    expect(await enablePasskey()).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Face ID needs the https address.',
    });
    expect(browser.startRegistration).not.toHaveBeenCalled();
  });

  it('reports a browser error that is not a cancel', async () => {
    answer([200, options]);
    browser.startRegistration.mockRejectedValue(new Error('boom'));
    expect(await enablePasskey()).toMatchObject({
      ok: false,
      reason: 'failed',
      message: 'Could not turn on Face ID. Try again.',
    });
  });

  it('reports a failed verification', async () => {
    answer([200, options], [400, { error: { message: 'Try again.' } }]);
    browser.startRegistration.mockResolvedValue(credential);
    expect(await enablePasskey()).toMatchObject({
      ok: false,
      reason: 'failed',
      message: 'Try again.',
    });
  });

  it('reports a lost connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await enablePasskey()).toMatchObject({
      ok: false,
      reason: 'failed',
    });
  });
});

describe('turning Face ID off', () => {
  it('deletes the passkey on the server', async () => {
    const calls = answer([200, { hasPasskey: false }]);
    expect(await disablePasskey()).toBe(true);
    expect(calls[0]).toMatchObject({
      url: '/api/devices/current/passkey',
      method: 'DELETE',
    });
  });

  it('says so when it could not', async () => {
    answer([500, {}]);
    expect(await disablePasskey()).toBe(false);
  });
});

describe('signing in with Face ID', () => {
  it('opens the session after the prompt', async () => {
    const calls = answer([200, options], [200, { profileRequired: true }]);
    browser.startAuthentication.mockResolvedValue(credential);

    expect(await signInWithPasskey()).toEqual({
      ok: true,
      profileRequired: true,
    });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/auth/passkey/authenticate/options',
      '/api/auth/passkey/authenticate/verify',
    ]);
  });

  it('sends nothing after a cancelled prompt, so nothing counts as a try', async () => {
    const calls = answer([200, options]);
    browser.startAuthentication.mockRejectedValue(notAllowed());
    expect(await signInWithPasskey()).toEqual({
      ok: false,
      reason: 'cancelled',
    });
    expect(calls).toHaveLength(1);
  });

  it('passes on the remaining tries after a failed answer', async () => {
    answer(
      [200, options],
      [
        401,
        {
          error: {
            message: 'Face ID didn’t work. 2 tries before a short wait.',
          },
        },
      ],
    );
    browser.startAuthentication.mockResolvedValue(credential);
    expect(await signInWithPasskey()).toEqual({
      ok: false,
      reason: 'wrong',
      message: 'Face ID didn’t work. 2 tries before a short wait.',
    });
  });

  it('passes on the lockout and its countdown', async () => {
    answer([423, { error: { message: 'Too many tries.', retryAfter: 17 } }]);
    expect(await signInWithPasskey()).toEqual({
      ok: false,
      reason: 'locked',
      message: 'Too many tries.',
      retryAfter: 17,
    });
    expect(browser.startAuthentication).not.toHaveBeenCalled();
  });

  it('reports a device whose passkey is gone', async () => {
    answer([404, { error: { code: 'not_found' } }]);
    expect(await signInWithPasskey()).toMatchObject({
      ok: false,
      reason: 'missing',
    });
  });
});

it('reports whether the browser has WebAuthn', () => {
  browser.browserSupportsWebAuthn.mockReturnValueOnce(false);
  expect(passkeysSupported()).toBe(false);
  expect(passkeysSupported()).toBe(true);
});
