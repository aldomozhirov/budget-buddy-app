import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { createWebPushSender } from '../src/modules/push/sender.js';
import { loadOrCreateVapidKeys } from '../src/modules/push/vapid.js';

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe('VAPID keys', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-vapid-'));
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('generates a key pair into the keys folder on first start, privately', async () => {
    const keysDir = join(directory, 'data', 'keys');
    const keys = await loadOrCreateVapidKeys(keysDir);

    // 65 bytes (uncompressed P-256 point) and 32 bytes, URL-safe base64.
    expect(keys.publicKey).toMatch(/^[\w-]{87}$/u);
    expect(keys.privateKey).toMatch(/^[\w-]{43}$/u);
    expect(await mode(keysDir)).toBe(0o700);
    expect(await mode(join(keysDir, 'vapid.json'))).toBe(0o600);
  });

  it('returns the same keys on the next start', async () => {
    const keysDir = join(directory, 'keys');
    const first = await loadOrCreateVapidKeys(keysDir);
    expect(await loadOrCreateVapidKeys(keysDir)).toEqual(first);
  });

  it('tightens permissions that were too open', async () => {
    const keysDir = join(directory, 'keys');
    await loadOrCreateVapidKeys(keysDir);
    await chmod(keysDir, 0o755);
    await chmod(join(keysDir, 'vapid.json'), 0o644);

    await loadOrCreateVapidKeys(keysDir);
    expect(await mode(keysDir)).toBe(0o700);
    expect(await mode(join(keysDir, 'vapid.json'))).toBe(0o600);
  });

  it('refuses a damaged file without replacing it or printing it', async () => {
    const keysDir = join(directory, 'keys');
    const keys = await loadOrCreateVapidKeys(keysDir);
    const path = join(keysDir, 'vapid.json');
    const damaged = JSON.stringify({ ...keys, privateKey: 'short' });
    await writeFile(path, damaged);

    const failure = await loadOrCreateVapidKeys(keysDir).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(keys.publicKey);
    expect((failure as Error).message).not.toContain('short');
    expect(await readFile(path, 'utf8')).toBe(damaged);
  });
});

describe('VAPID contact', () => {
  const base = { NODE_ENV: 'test', DATA_DIR: '/tmp/bb-data' } as const;

  it('keeps the keys inside the data directory', () => {
    expect(parseConfig(base).keysDir).toBe('/tmp/bb-data/keys');
  });

  it('uses the https app address, else a mailto placeholder, else VAPID_SUBJECT', () => {
    expect(
      parseConfig({
        ...base,
        APP_ORIGIN: 'http://127.0.0.1:5173,https://mini.tail.ts.net',
      }).vapidSubject,
    ).toBe('https://mini.tail.ts.net');
    expect(parseConfig(base).vapidSubject).toMatch(/^mailto:.+@.+/u);
    expect(
      parseConfig({ ...base, VAPID_SUBJECT: 'mailto:owner@family.test' })
        .vapidSubject,
    ).toBe('mailto:owner@family.test');
    expect(() =>
      parseConfig({ ...base, VAPID_SUBJECT: 'owner@family.test' }),
    ).toThrow();
  });
});

describe('web-push sender', () => {
  // Plain functions rather than vi.fn(): Vitest reports a rejecting mock as
  // an unhandled error even when the caller handles it.
  let calls: Parameters<typeof webpush.sendNotification>[];
  let outcome: () => ReturnType<typeof webpush.sendNotification>;
  const target = {
    endpoint: 'https://push.example.test/x',
    p256dh: 'k',
    auth: 'a',
  };
  const sender = createWebPushSender({
    keys: { publicKey: 'public', privateKey: 'private' },
    subject: 'mailto:owner@family.test',
    transport: (...args) => {
      calls.push(args);
      return outcome();
    },
  });
  beforeEach(() => {
    calls = [];
  });

  it('signs with the VAPID details and passes the payload on', async () => {
    outcome = async () => ({ statusCode: 201, body: '', headers: {} });
    expect(await sender.send(target, '{"title":"t"}')).toEqual({ ok: true });
    expect(calls).toEqual([
      [
        { endpoint: target.endpoint, keys: { p256dh: 'k', auth: 'a' } },
        '{"title":"t"}',
        expect.objectContaining({
          vapidDetails: {
            subject: 'mailto:owner@family.test',
            publicKey: 'public',
            privateKey: 'private',
          },
        }),
      ],
    ]);
  });

  it('reports the push service’s status instead of throwing', async () => {
    outcome = async () => {
      throw new webpush.WebPushError('gone', 410, {}, '', target.endpoint);
    };
    expect(await sender.send(target, '{}')).toEqual({
      ok: false,
      statusCode: 410,
    });
  });

  it('reports a failure with no status when the service cannot be reached', async () => {
    outcome = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await sender.send(target, '{}')).toEqual({
      ok: false,
      statusCode: undefined,
    });
  });
});
