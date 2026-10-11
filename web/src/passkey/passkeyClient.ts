import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  passkeyOptionsResponseSchema,
  passkeyStateResponseSchema,
  signInResponseSchema,
} from '@budget-buddy/shared';

const jsonHeaders = { 'content-type': 'application/json' };

/** Why turning Face ID on did not work. `cancelled` is not an error. */
export type EnablePasskeyResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'failed'; message: string };

/** How a Face ID sign-in ended. `cancelled` is not an error. */
export type PasskeySignInResult =
  | { ok: true; profileRequired: boolean }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'locked'; message: string; retryAfter: number }
  | {
      ok: false;
      reason: 'wrong' | 'missing' | 'failed';
      message: string;
    };

/** Whether this browser can use passkeys at all (not whether it has one). */
export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

/**
 * Turns Face ID on for this device: asks the server for a challenge, lets the
 * person confirm with Face ID, and sends the result back. Call it straight
 * from the tap, so the browser accepts the prompt.
 */
export async function enablePasskey(): Promise<EnablePasskeyResult> {
  const failed = (message = 'Could not turn on Face ID. Try again.') =>
    ({ ok: false, reason: 'failed', message }) as const;
  try {
    const optionsResponse = await postJson(
      '/api/auth/passkey/register/options',
    );
    if (!optionsResponse.ok)
      return failed(await serverMessage(optionsResponse));
    const optionsJSON: unknown = await optionsResponse.json();
    passkeyOptionsResponseSchema.parse(optionsJSON);

    let credential;
    try {
      credential = await startRegistration({
        optionsJSON: optionsJSON as PublicKeyCredentialCreationOptionsJSON,
      });
    } catch (error) {
      return isCancelled(error) ? { ok: false, reason: 'cancelled' } : failed();
    }

    const verifyResponse = await postJson('/api/auth/passkey/register/verify', {
      response: credential,
    });
    if (!verifyResponse.ok) return failed(await serverMessage(verifyResponse));
    passkeyStateResponseSchema.parse(await verifyResponse.json());
    return { ok: true };
  } catch {
    return failed('Could not turn on Face ID. Check your connection.');
  }
}

/** Turns Face ID off for this device on the server. */
export async function disablePasskey(): Promise<boolean> {
  try {
    const response = await fetch('/api/devices/current/passkey', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Signs in with Face ID on the sign-in screen. The server opens the same
 * session as the family password, and counts a failure toward the same
 * lockout. Call it straight from the tap on "Use Face ID".
 */
export async function signInWithPasskey(): Promise<PasskeySignInResult> {
  const failed = {
    ok: false,
    reason: 'failed',
    message: 'Could not use Face ID. Use your family password.',
  } as const;
  try {
    const optionsResponse = await postJson(
      '/api/auth/passkey/authenticate/options',
    );
    if (!optionsResponse.ok) return await mapSignInFailure(optionsResponse);
    const optionsJSON: unknown = await optionsResponse.json();
    passkeyOptionsResponseSchema.parse(optionsJSON);

    let credential;
    try {
      credential = await startAuthentication({
        optionsJSON: optionsJSON as PublicKeyCredentialRequestOptionsJSON,
      });
    } catch (error) {
      return isCancelled(error) ? { ok: false, reason: 'cancelled' } : failed;
    }

    const verifyResponse = await postJson(
      '/api/auth/passkey/authenticate/verify',
      { response: credential },
    );
    if (!verifyResponse.ok) return await mapSignInFailure(verifyResponse);
    const { profileRequired } = signInResponseSchema.parse(
      await verifyResponse.json(),
    );
    return { ok: true, profileRequired };
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: 'Could not use Face ID. Check your connection.',
    };
  }
}

function postJson(url: string, body: unknown = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

/** Cancelling the Face ID prompt (or letting it time out) is not a failure. */
function isCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotAllowedError' ||
      (error as Error & { code?: string }).code === 'ERROR_CEREMONY_ABORTED')
  );
}

async function serverMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? 'Could not turn on Face ID. Try again.';
  } catch {
    return 'Could not turn on Face ID. Try again.';
  }
}

async function mapSignInFailure(
  response: Response,
): Promise<PasskeySignInResult> {
  let error: { message?: string; retryAfter?: number } = {};
  try {
    error = ((await response.json()) as { error?: typeof error }).error ?? {};
  } catch {
    // An unreadable body is treated like any other failure below.
  }
  if (response.status === 423) {
    return {
      ok: false,
      reason: 'locked',
      message: error.message ?? 'Too many tries. Try again in a moment.',
      retryAfter: error.retryAfter ?? 30,
    };
  }
  if (response.status === 401) {
    return {
      ok: false,
      reason: 'wrong',
      message: error.message ?? 'Face ID didn’t work.',
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      reason: 'missing',
      message: 'Face ID isn’t set up on this device. Use your family password.',
    };
  }
  return {
    ok: false,
    reason: 'failed',
    message:
      error.message ?? 'Could not use Face ID. Use your family password.',
  };
}
