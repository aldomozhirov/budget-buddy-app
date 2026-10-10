/** Why a request to a price feed did not give an answer. */
export class RateHttpError extends Error {
  constructor(
    message: string,
    /** `blocked` never left the machine; `status` and `network` did. */
    readonly kind: 'blocked' | 'status' | 'network',
    /** The HTTP status of a `status` error. */
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'RateHttpError';
  }
}

/** The only way the rates code reaches the network (SEC-8). */
export interface RateHttpClient {
  /**
   * GETs `url` and decodes the body as text.
   * @param options.encoding Character set of the body; `utf-8` by default.
   * @throws {RateHttpError} when the host is not allowed, the request times
   * out or fails, or the answer is not a success.
   */
  getText(url: string, options?: { encoding?: string }): Promise<string>;
}

/** Options for `createRateHttpClient`. */
export interface RateHttpClientOptions {
  /** Host names requests may go to; any other host is refused. */
  allowedHosts: readonly string[];
  /** Milliseconds before a request is given up; 20 s by default. */
  timeoutMs?: number;
  /** Largest answer accepted, in bytes; 32 MB by default. */
  maxBytes?: number;
  /** Replaces `fetch`; tests use it so no real host is called. */
  fetchImpl?: typeof fetch;
}

/** Names the app in the User-Agent of every feed request. */
const userAgent = 'BudgetBuddy/0.1 (family budget app; daily exchange rates)';

/**
 * Creates the HTTP client of the rates code. It refuses any URL that is not
 * HTTPS to an allowlisted host, follows no redirects (a redirect could leave
 * the list), and gives up after a timeout.
 */
export function createRateHttpClient(
  options: RateHttpClientOptions,
): RateHttpClient {
  const allowedHosts = new Set(
    options.allowedHosts.map((host) => host.toLowerCase()),
  );
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async getText(url, { encoding = 'utf-8' } = {}) {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new RateHttpError('Not a valid URL', 'blocked');
      }
      if (target.protocol !== 'https:') {
        throw new RateHttpError(
          `Only HTTPS is allowed, not ${target.protocol}`,
          'blocked',
        );
      }
      if (!allowedHosts.has(target.hostname.toLowerCase())) {
        throw new RateHttpError(
          `Host ${target.hostname} is not on the price feed allowlist`,
          'blocked',
        );
      }

      let response: Response;
      try {
        response = await fetchImpl(target, {
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'user-agent': userAgent },
        });
      } catch (error) {
        throw new RateHttpError(
          `${target.hostname} could not be reached: ${describe(error)}`,
          'network',
        );
      }
      if (!response.ok) {
        throw new RateHttpError(
          `${target.hostname} answered HTTP ${response.status}`,
          'status',
          response.status,
        );
      }
      try {
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength > maxBytes) {
          throw new RateHttpError(
            `${target.hostname} sent more than ${maxBytes} bytes`,
            'network',
          );
        }
        return new TextDecoder(encoding).decode(body);
      } catch (error) {
        if (error instanceof RateHttpError) throw error;
        throw new RateHttpError(
          `${target.hostname} answer could not be read: ${describe(error)}`,
          'network',
        );
      }
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
