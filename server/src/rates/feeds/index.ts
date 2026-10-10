import type { RateFeed } from '../feed.js';
import type { RateHttpClient } from '../http.js';
import { createCbrFeed } from './cbr.js';
import { createCoinbaseFeed } from './coinbase.js';
import { createEcbFeed } from './ecb.js';

/** Hosts the live feeds call; the default for the HTTP client's allowlist. */
export const liveFeedHosts = [
  'www.ecb.europa.eu',
  'www.cbr.ru',
  'api.exchange.coinbase.com',
] as const;

/** The chosen feeds of spec 1 (task 1): ECB, Bank of Russia and Coinbase. */
export function createLiveFeeds(http: RateHttpClient): RateFeed[] {
  return [createEcbFeed(http), createCbrFeed(http), createCoinbaseFeed(http)];
}
