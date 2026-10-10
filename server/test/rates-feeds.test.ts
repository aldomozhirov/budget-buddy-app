import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createCbrFeed, parseCbrDaily } from '../src/rates/feeds/cbr.js';
import {
  createCoinbaseFeed,
  parseCoinbaseCandles,
} from '../src/rates/feeds/coinbase.js';
import { createEcbFeed, parseEcbRates } from '../src/rates/feeds/ecb.js';
import { createFixtureFeed } from '../src/rates/fixtureFeed.js';
import type { UsedCurrency } from '../src/rates/feed.js';
import {
  createRateHttpClient,
  RateHttpError,
  type RateHttpClient,
} from '../src/rates/http.js';

const fixtureDirectory = new URL('./fixtures/rates/', import.meta.url);

function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(name, fixtureDirectory)));
}

const usd: UsedCurrency = { code: 'USD', coinFeedId: null };
const rub: UsedCurrency = { code: 'RUB', coinFeedId: null };
const btc: UsedCurrency = { code: 'BTC', coinFeedId: 'BTC-EUR' };

/** An HTTP client that serves recorded files by URL and records the URLs. */
function recordedClient(files: Record<string, string>) {
  const urls: string[] = [];
  const client: RateHttpClient = {
    async getText(url, options) {
      urls.push(url);
      const name = files[url];
      if (name === undefined) throw new Error(`No recording for ${url}`);
      return new TextDecoder(options?.encoding ?? 'utf-8').decode(
        fixture(name),
      );
    },
  };
  return { client, urls };
}

describe('ECB feed', () => {
  it('reads the daily file into EUR rates of the wanted currencies only', () => {
    const xml = fixture('ecb-eurofxref-daily.xml').toString('utf-8');
    expect(parseEcbRates(xml, new Set(['USD', 'GBP']))).toEqual([
      { base: 'EUR', quote: 'USD', date: '2026-10-07', rate: '1.1177' },
      { base: 'EUR', quote: 'GBP', date: '2026-10-07', rate: '0.84645' },
    ]);
  });

  it('reads the 90-day file, quoted with double quotes, for every date', () => {
    const xml = fixture('ecb-eurofxref-hist-90d.xml').toString('utf-8');
    const rates = parseEcbRates(xml, new Set(['USD']));
    expect(rates).toHaveLength(64);
    expect(rates[0]).toEqual({
      base: 'EUR',
      quote: 'USD',
      date: '2026-10-07',
      rate: '1.1177',
    });
    expect(rates.find(({ date }) => date === '2026-10-02')?.rate).toBe(
      '1.1225',
    );
  });

  it('rejects an answer that is not a rate file and an unreadable rate', () => {
    expect(() => parseEcbRates('<html>Maintenance</html>', new Set())).toThrow(
      'not a rate file',
    );
    expect(() =>
      parseEcbRates(
        "<Cube time='2026-10-07'><Cube currency='USD' rate='n/a'/></Cube>",
        new Set(['USD']),
      ),
    ).toThrow('unreadable rate');
  });

  it('covers ISO currencies except EUR and RUB, and never coins', () => {
    const feed = createEcbFeed({ getText: vi.fn() });
    expect(feed.covers(usd)).toBe(true);
    expect(feed.covers({ code: 'EUR', coinFeedId: null })).toBe(false);
    expect(feed.covers(rub)).toBe(false);
    expect(feed.covers(btc)).toBe(false);
  });

  it('targets today on working days and Friday on weekends', () => {
    const feed = createEcbFeed({ getText: vi.fn() });
    const now = new Date('2026-10-10T08:00:00Z');
    expect(feed.targetDate(now, '2026-10-09')).toBe('2026-10-09');
    expect(feed.targetDate(now, '2026-10-10')).toBe('2026-10-09');
    expect(feed.targetDate(now, '2026-10-11')).toBe('2026-10-09');
    expect(feed.targetDate(now, '2026-10-12')).toBe('2026-10-12');
  });

  it('picks the daily, 90-day or full file by how far back it must reach', async () => {
    const base = 'https://www.ecb.europa.eu/stats/eurofxref/';
    const { client, urls } = recordedClient({
      [`${base}eurofxref-daily.xml`]: 'ecb-eurofxref-daily.xml',
      [`${base}eurofxref-hist-90d.xml`]: 'ecb-eurofxref-hist-90d.xml',
      [`${base}eurofxref-hist.xml`]: 'ecb-eurofxref-hist-90d.xml',
    });
    const feed = createEcbFeed(client);
    const request = {
      currencies: [usd],
      to: '2026-10-07',
      today: '2026-10-07',
      now: new Date('2026-10-07T10:00:00Z'),
    };
    await feed.fetch({ ...request, from: '2026-10-07' });
    await feed.fetch({ ...request, from: '2026-09-01' });
    await feed.fetch({ ...request, from: '2023-10-09' });
    expect(urls.map((url) => url.slice(base.length))).toEqual([
      'eurofxref-daily.xml',
      'eurofxref-hist-90d.xml',
      'eurofxref-hist.xml',
    ]);
  });
});

describe('Bank of Russia feed', () => {
  it('reads the daily file: windows-1251, decimal comma, rouble per unit', () => {
    const xml = new TextDecoder('windows-1251').decode(
      fixture('cbr-xml-daily-eng-2026-10-06.xml'),
    );
    expect(
      parseCbrDaily(xml).sort((a, b) => a.base.localeCompare(b.base)),
    ).toEqual([
      { base: 'EUR', quote: 'RUB', date: '2026-10-06', rate: '95.3349' },
      { base: 'USD', quote: 'RUB', date: '2026-10-06', rate: '84.9309' },
    ]);
  });

  it('keeps the earlier date the bank answers for a Sunday', () => {
    const xml = fixture('cbr-xml-daily-eng-2026-10-04-sunday.xml').toString(
      'latin1',
    );
    expect(parseCbrDaily(xml).map(({ date }) => date)).toEqual([
      '2026-10-03',
      '2026-10-03',
    ]);
  });

  it('asks for one date with the daily file and a range with one request per currency', async () => {
    const base = 'https://www.cbr.ru/scripts/';
    const { client, urls } = recordedClient({
      [`${base}XML_daily_eng.asp?date_req=06/10/2026`]:
        'cbr-xml-daily-eng-2026-10-06.xml',
      [`${base}XML_dynamic.asp?date_req1=01/09/2026&date_req2=07/10/2026&VAL_NM_RQ=R01239`]:
        'cbr-xml-dynamic-eur-2026-09-01-2026-10-07.xml',
      [`${base}XML_dynamic.asp?date_req1=01/09/2026&date_req2=07/10/2026&VAL_NM_RQ=R01235`]:
        'cbr-xml-dynamic-usd-2026-09-01-2026-10-07.xml',
    });
    const feed = createCbrFeed(client);
    const request = {
      currencies: [rub],
      today: '2026-10-07',
      now: new Date('2026-10-07T10:00:00Z'),
    };
    const single = await feed.fetch({
      ...request,
      from: '2026-10-06',
      to: '2026-10-06',
    });
    const range = await feed.fetch({
      ...request,
      from: '2026-09-01',
      to: '2026-10-07',
    });
    expect(single).toHaveLength(2);
    expect(urls).toHaveLength(3);
    expect(range.filter(({ base: code }) => code === 'EUR')).toHaveLength(27);
    expect(range.filter(({ base: code }) => code === 'USD')).toHaveLength(27);
    expect(range[0]).toEqual({
      base: 'EUR',
      quote: 'RUB',
      date: '2026-09-01',
      rate: '100.5714',
    });
  });

  it('targets Saturday on Sundays and Mondays, which have no rate', () => {
    const feed = createCbrFeed({ getText: vi.fn() });
    const now = new Date('2026-10-10T08:00:00Z');
    expect(feed.targetDate(now, '2026-10-10')).toBe('2026-10-10');
    expect(feed.targetDate(now, '2026-10-11')).toBe('2026-10-10');
    expect(feed.targetDate(now, '2026-10-12')).toBe('2026-10-10');
    expect(feed.targetDate(now, '2026-10-13')).toBe('2026-10-13');
  });
});

describe('Coinbase feed', () => {
  it("stores the close of each UTC day as the number's own decimal text", () => {
    const json = fixture(
      'coinbase-candles-USDT-EUR-2026-09-01-2026-10-06.json',
    );
    const rates = parseCoinbaseCandles(json.toString('utf-8'), 'USDT', 'EUR');
    expect(rates).toHaveLength(36);
    expect(rates[0]).toEqual({
      base: 'USDT',
      quote: 'EUR',
      date: '2026-10-06',
      rate: '0.8887',
    });
    expect(rates.at(-1)).toMatchObject({ date: '2026-09-01', rate: '0.8625' });
  });

  it('rejects an error answer and leaves out a candle without a close', () => {
    expect(() =>
      parseCoinbaseCandles('{"message":"NotFound"}', 'BTC', 'EUR'),
    ).toThrow('unexpected answer');
    expect(
      parseCoinbaseCandles('[[1791244800,1,2,1,0,0]]', 'BTC', 'EUR'),
    ).toEqual([]);
  });

  it('requests complete days in windows of at most 300 days', async () => {
    const urls: string[] = [];
    const feed = createCoinbaseFeed({
      getText: (url) => {
        urls.push(url);
        return Promise.resolve('[[1791158400,1,2,1,76463.32,1]]');
      },
    });
    const rates = await feed.fetch({
      currencies: [btc, usd],
      from: '2025-01-01',
      to: '2026-10-07',
      today: '2026-10-07',
      now: new Date('2026-10-07T10:00:00Z'),
    });
    expect(urls).toEqual([
      'https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=86400&start=2025-01-01T00:00:00Z&end=2025-10-27T00:00:00Z',
      'https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=86400&start=2025-10-28T00:00:00Z&end=2026-08-23T00:00:00Z',
      'https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=86400&start=2026-08-24T00:00:00Z&end=2026-10-06T00:00:00Z',
    ]);
    expect(rates.every(({ base }) => base === 'BTC')).toBe(true);
  });

  it('targets yesterday of the UTC calendar', () => {
    const feed = createCoinbaseFeed({ getText: vi.fn() });
    expect(
      feed.targetDate(new Date('2026-10-10T04:00:00Z'), '2026-10-10'),
    ).toBe('2026-10-09');
  });
});

describe('fixture feed', () => {
  it('publishes working days only, with exact decimals, and never the euro', async () => {
    const feed = createFixtureFeed();
    const rates = await feed.fetch({
      currencies: [usd, btc, { code: 'EUR', coinFeedId: null }],
      from: '2026-10-05',
      to: '2026-10-11',
      today: '2026-10-11',
      now: new Date('2026-10-11T08:00:00Z'),
    });
    expect(new Set(rates.map(({ date }) => date)).size).toBe(5);
    expect(rates.filter(({ base }) => base === 'EUR')).toHaveLength(5);
    expect(rates.filter(({ quote }) => quote === 'EUR')).toHaveLength(5);
    expect(rates.every(({ rate }) => /^\d+\.\d{4}$/.test(rate))).toBe(true);
    expect(
      await feed.fetch({
        currencies: [usd],
        from: '2026-10-05',
        to: '2026-10-09',
        today: '2026-10-11',
        now: new Date('2026-10-11T08:00:00Z'),
      }),
    ).toEqual(
      rates.filter(
        ({ quote, date }) => quote === 'USD' && date <= '2026-10-09',
      ),
    );
  });
});

describe('rate HTTP client', () => {
  it('refuses a host outside the allowlist without calling the network', async () => {
    const fetchImpl = vi.fn();
    const client = createRateHttpClient({
      allowedHosts: ['www.ecb.europa.eu'],
      fetchImpl,
    });
    await expect(
      client.getText('https://example.com/rates.xml'),
    ).rejects.toMatchObject({
      name: 'RateHttpError',
      kind: 'blocked',
      message: expect.stringContaining('example.com'),
    });
    await expect(
      client.getText('https://www.ecb.europa.eu.evil.test/rates.xml'),
    ).rejects.toBeInstanceOf(RateHttpError);
    await expect(
      client.getText('http://www.ecb.europa.eu/rates.xml'),
    ).rejects.toMatchObject({ kind: 'blocked' });
    await expect(client.getText('not a url')).rejects.toMatchObject({
      kind: 'blocked',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches an allowed host without following redirects and decodes the charset', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(Buffer.from([0xd0, 0xf3, 0xe1, 0xeb]))),
    );
    const client = createRateHttpClient({
      allowedHosts: ['WWW.CBR.RU'],
      fetchImpl,
    });
    await expect(
      client.getText('https://www.cbr.ru/scripts/x', {
        encoding: 'windows-1251',
      }),
    ).resolves.toBe('Рубл');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'www.cbr.ru' }),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('reports an error status, a failed request and an oversized answer', async () => {
    const answers = [
      () => Promise.resolve(new Response('no', { status: 503 })),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(new Response('x'.repeat(20))),
    ];
    const client = createRateHttpClient({
      allowedHosts: ['www.cbr.ru'],
      maxBytes: 10,
      fetchImpl: () => (answers.shift() as () => Promise<Response>)(),
    });
    await expect(client.getText('https://www.cbr.ru/a')).rejects.toMatchObject({
      kind: 'status',
      message: expect.stringContaining('503'),
    });
    await expect(client.getText('https://www.cbr.ru/a')).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(client.getText('https://www.cbr.ru/a')).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('more than 10 bytes'),
    });
  });

  it('gives up after the timeout', async () => {
    const client = createRateHttpClient({
      allowedHosts: ['www.cbr.ru'],
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    });
    await expect(client.getText('https://www.cbr.ru/a')).rejects.toMatchObject({
      kind: 'network',
    });
  });
});
