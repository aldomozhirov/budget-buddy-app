/**
 * Whether the server may send a push to `endpoint` (SEC-8: the only push
 * service the app talks to is Apple's). The endpoint must be plain `https:`
 * on the default port, without credentials, and its host must match an entry
 * of `allowedHosts`: an exact name, or `*.suffix` for any host below it.
 */
export function isAllowedPushEndpoint(
  endpoint: string,
  allowedHosts: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const pattern = allowed.toLowerCase();
    return pattern.startsWith('*.')
      ? host.endsWith(pattern.slice(1))
      : host === pattern;
  });
}
