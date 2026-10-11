import { isIP } from 'node:net';

/** Who a passkey is registered for: the address the browser binds it to. */
export type RelyingParty = {
  /** The host name the browser scopes the credential to (the RP ID). */
  id: string;
  /** The one origin whose pages may use the credential. */
  origin: string;
};

/**
 * Picks the relying party from `APP_ORIGIN`. A passkey belongs to one host
 * name, so when several origins are listed the first one is the relying
 * party and the others cannot use Face ID (`originIsRelyingParty` refuses
 * them). Browsers also refuse an IP address as an RP ID and require https
 * (or `localhost`), so such an origin gives no relying party at all.
 * @returns The relying party, or null when the first origin cannot serve one.
 */
export function relyingPartyFrom(appOrigins: string[]): RelyingParty | null {
  const first = appOrigins[0];
  if (!first) return null;
  const url = new URL(first);
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  const local = host === 'localhost' || host.endsWith('.localhost');
  if (isIP(host) !== 0) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return null;
  }
  return { id: url.hostname, origin: url.origin };
}

/**
 * Whether the request came from the relying party's own origin. The CSRF
 * check lets every listed origin through; only the relying party may use
 * Face ID. A request without an `Origin` header is not accepted here.
 */
export function originIsRelyingParty(
  origin: string | undefined,
  relyingParty: RelyingParty,
): boolean {
  return origin === relyingParty.origin;
}
