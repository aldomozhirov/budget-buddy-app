import { goToSignIn } from '../../session/lock.js';
import { setAuthState } from '../../stores/auth.js';

/** A refused request, with the server's message and per-field messages. */
export class EnvelopeApiError extends Error {
  /**
   * @param message What to tell the member.
   * @param status HTTP status, or 0 when the server could not be reached.
   * @param fields Messages by request field, when the server names them.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Anything with a zod-style `parse`, so web needs no direct zod import. */
interface Parser<T> {
  parse(value: unknown): T;
}

/**
 * Calls an API route, checks the answer against `schema` and sends the
 * member to sign-in when the session has ended.
 * @throws {EnvelopeApiError} when the request fails or is refused.
 */
export async function callApi<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  schema: Parser<T>,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new EnvelopeApiError(
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }
  if (response.status === 401) {
    setAuthState(null);
    await goToSignIn();
    throw new EnvelopeApiError('Sign in again to continue.', 401);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      payload as {
        error?: { message?: string; fields?: Record<string, string> };
      } | null
    )?.error;
    throw new EnvelopeApiError(
      error?.message ?? 'Something went wrong. Try again.',
      response.status,
      error?.fields,
    );
  }
  return schema.parse(payload);
}
