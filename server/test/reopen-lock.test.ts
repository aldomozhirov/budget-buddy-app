import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  presenceIntervalMs,
  presencePath,
  reopenLockAfterMs,
} from '@budget-buddy/shared';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';

/**
 * Sign in again when the app is re-opened (MEM-7, SEC-9): the server locks a
 * session whose app has not said it is in use for more than five minutes, on
 * a fake clock, for every route and for the live stream.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';
const minute = 60_000;

describe('sign in again when the app is re-opened', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let alex: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-reopen-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = Date.parse('2026-10-12T09:00:00.000Z');
    app = await makeApp();
    await migrateDatabase(database, {
      backupDir: directory,
      migrationsFolder,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'Alex-iPhone/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    alex = cookieHeader(setup);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  function makeApp() {
    return createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
      liveHeartbeatMs: 25,
      push: { publicKey: 'test', allowedHosts: ['push.example.test'] },
    });
  }

  function call(
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  const me = (cookie: string) => call(cookie, 'GET', '/api/auth/me');
  const present = (cookie: string, awayMs = 0) =>
    call(cookie, 'POST', presencePath, { awayMs });

  /** A second device for Blair, signed in with the password. */
  async function blairDevice(): Promise<string> {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, 'user-agent': 'Blair-iPad/1.0' },
      payload: { password },
    });
    expect(signedIn.statusCode).toBe(200);
    const cookie = cookieHeader(signedIn);
    await call(cookie, 'POST', '/api/auth/profile', {
      memberId: 2,
      remember: true,
    });
    return cookie;
  }

  it('does not lock a session that was used within five minutes', async () => {
    now += reopenLockAfterMs;
    const response = await me(alex);
    expect(response.statusCode).toBe(200);
    expect(response.json().device.lockOnReopen).toBe(true);
  });

  it('locks every route once the app has been away for more than five minutes', async () => {
    now += reopenLockAfterMs + 1;
    for (const [method, url] of [
      ['GET', '/api/auth/me'],
      ['GET', '/api/home'],
      ['GET', '/api/accounts'],
      ['GET', '/api/devices/current'],
      ['GET', '/api/envelopes'],
      ['POST', '/api/envelopes'],
      ['GET', '/api/envelopes/1'],
      ['PATCH', '/api/envelopes/1'],
      ['DELETE', '/api/envelopes/1'],
      ['GET', '/api/envelopes/1/history'],
      ['POST', '/api/envelopes/1/adjustments'],
      ['POST', '/api/envelopes/moves'],
      ['DELETE', '/api/envelope-adjustments/1'],
      ['GET', '/api/categories'],
      ['POST', '/api/categories'],
      ['PATCH', '/api/categories/1'],
      ['DELETE', '/api/categories/1'],
      ['GET', '/api/rules'],
      ['POST', '/api/rules'],
      ['PATCH', '/api/rules/1'],
      ['PUT', '/api/rules/order'],
      ['DELETE', '/api/rules/1'],
      // The locked exception of spec 2 Design 4 waits for task 17.
      ['POST', '/api/transactions'],
      ['GET', '/api/transactions'],
      ['GET', '/api/transactions/facets?facet=member'],
      ['GET', '/api/transactions/needs-category'],
      ['POST', '/api/transactions/label'],
      ['GET', '/api/transactions/1'],
      ['PATCH', '/api/transactions/1'],
      ['DELETE', '/api/transactions/1'],
      ['GET', '/api/add-options'],
      ['GET', '/api/merchants'],
      ['GET', '/api/rates/pair?from=EUR&to=USD&date=2026-10-15'],
      ['GET', '/api/suggestions/categories?kind=expense'],
      ['POST', '/api/auth/sign-out'],
    ] as const) {
      const response = await call(alex, method, url, {});
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json().error.code).toBe('session_locked');
    }
  });

  it('keeps refusing a locked session until the device signs in again', async () => {
    now += 6 * minute;
    expect((await me(alex)).statusCode).toBe(401);
    now += 3 * 24 * 60 * minute;
    expect((await me(alex)).statusCode).toBe(401);
    expect((await present(alex, 0)).statusCode).toBe(401);
    expect((await me(alex)).statusCode).toBe(401);

    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, cookie: alex.split('; ')[0]! },
      payload: { password },
    });
    expect(signedIn.statusCode).toBe(200);
    const fresh = cookieHeader(signedIn);
    const state = await me(fresh);
    expect(state.statusCode).toBe(200);
    // The device row is the same one, with its default profile.
    expect(state.json().member).toEqual({ id: 1, name: 'Alex' });
    expect(deviceCountOf(database)).toBe(1);
  });

  it('does not let a later presence call bring back a session the page said was away', async () => {
    now += reopenLockAfterMs + 1;
    expect((await present(alex, reopenLockAfterMs + 1)).statusCode).toBe(401);
    // A page that returns with the connection (`visibilitychange` and
    // `online` together) can send a second call that claims nothing.
    for (const awayMs of [0, 1000, reopenLockAfterMs]) {
      const again = await present(alex, awayMs);
      expect(again.statusCode, `awayMs ${awayMs}`).toBe(401);
      expect(again.json().error.code).toBe('session_locked');
    }
    expect((await me(alex)).statusCode).toBe(401);
  });

  it('does not let a presence call bring back a session another route already refused', async () => {
    now += reopenLockAfterMs + 1;
    expect((await me(alex)).statusCode).toBe(401);
    const again = await present(alex, 0);
    expect(again.statusCode).toBe(401);
    expect(again.json().error.code).toBe('session_locked');
    expect((await me(alex)).statusCode).toBe(401);
    // Even close to now: refused is refused.
    now += 1000;
    expect((await present(alex, 0)).statusCode).toBe(401);
  });

  it('does not extend a locked session when the calls that find it locked arrive', async () => {
    const before = database.prepare('SELECT expires_at FROM session').get() as {
      expires_at: bigint;
    };
    now += 60 * minute;
    await me(alex);
    await present(alex, 0);
    await present(alex, reopenLockAfterMs + 1);
    expect(database.prepare('SELECT expires_at FROM session').get()).toEqual(
      before,
    );
  });

  it('is never locked while the app keeps saying it is in use', async () => {
    for (
      let elapsed = 0;
      elapsed < 25 * minute;
      elapsed += presenceIntervalMs
    ) {
      now += presenceIntervalMs;
      const response = await present(alex);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ lockOnReopen: true });
      expect((await me(alex)).statusCode).toBe(200);
    }
  });

  it('does not count ordinary requests as being in use', async () => {
    // A tab that never ran the timer keeps asking, and is still locked.
    for (let elapsed = 0; elapsed < 5 * minute; elapsed += minute) {
      now += minute;
      expect((await me(alex)).statusCode).toBe(200);
    }
    now += minute;
    expect((await me(alex)).statusCode).toBe(401);
  });

  it('takes the limit from the last presence, not from sign-in', async () => {
    now += 4 * minute;
    expect((await present(alex)).statusCode).toBe(200);
    now += reopenLockAfterMs;
    expect((await me(alex)).statusCode).toBe(200);
    now += 1;
    expect((await me(alex)).statusCode).toBe(401);
  });

  it('refreshes a session that fell behind when the page never left', async () => {
    // The app stayed visible and offline for 20 minutes, so no call got out.
    now += 20 * minute;
    const response = await present(alex, 0);
    expect(response.statusCode).toBe(200);
    expect((await me(alex)).statusCode).toBe(200);
  });

  it('locks at once when the page says it was away for more than five minutes', async () => {
    now += reopenLockAfterMs + 1;
    const response = await present(alex, reopenLockAfterMs + 1);
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('session_locked');
    // Not even a second later does an ordinary request get through.
    expect((await me(alex)).statusCode).toBe(401);
  });

  it('keeps a session another tab of the device kept in use', async () => {
    // Tab B stays visible and sends presence; tab A comes back from ten
    // minutes in the background and says so. The device was never away.
    for (
      let elapsed = 0;
      elapsed < 10 * minute;
      elapsed += presenceIntervalMs
    ) {
      now += presenceIntervalMs;
      expect((await present(alex, 0)).statusCode).toBe(200);
    }
    const returning = await present(alex, 10 * minute);
    expect(returning.statusCode).toBe(200);
    expect(returning.json()).toEqual({ lockOnReopen: true });
    expect((await me(alex)).statusCode).toBe(200);
    // The call refreshed it: five more minutes pass before it locks.
    now += reopenLockAfterMs;
    expect((await me(alex)).statusCode).toBe(200);
    now += 1;
    expect((await me(alex)).statusCode).toBe(401);
  });

  it('accepts an absence of exactly five minutes', async () => {
    const response = await present(alex, reopenLockAfterMs);
    expect(response.statusCode).toBe(200);
    expect((await me(alex)).statusCode).toBe(200);
  });

  it('refuses a presence call that is not a whole number of milliseconds', async () => {
    for (const payload of [
      {},
      { awayMs: -1 },
      { awayMs: 1.5 },
      { awayMs: 'x' },
    ]) {
      const response = await call(alex, 'POST', presencePath, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation');
    }
  });

  it('needs a session for the presence call', async () => {
    const response = await call('', 'POST', presencePath, { awayMs: 0 });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
  });

  describe('the switch', () => {
    it('turns the behaviour off: the device stays signed in', async () => {
      const off = await call(alex, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: false,
      });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toEqual({ lockOnReopen: false });

      now += 30 * 24 * 60 * minute;
      const state = await me(alex);
      expect(state.statusCode).toBe(200);
      expect(state.json().device.lockOnReopen).toBe(false);
      expect((await present(alex, 60 * minute)).statusCode).toBe(200);
    });

    it('takes effect from now when it is turned back on', async () => {
      await call(alex, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: false,
      });
      now += 2 * 60 * minute;
      const on = await call(alex, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: true,
      });
      expect(on.json()).toEqual({ lockOnReopen: true });
      // Two hours of use with the switch off do not lock it at once.
      expect((await me(alex)).statusCode).toBe(200);
      now += reopenLockAfterMs + 1;
      expect((await me(alex)).statusCode).toBe(401);
    });

    it('reads the current value, and refuses a body that is not on or off', async () => {
      expect(
        (await call(alex, 'GET', '/api/devices/current/lock')).json(),
      ).toEqual({ lockOnReopen: true });
      for (const payload of [
        {},
        { lockOnReopen: 'no' },
        { lockOnReopen: true, x: 1 },
      ]) {
        const response = await call(
          alex,
          'PATCH',
          '/api/devices/current/lock',
          payload,
        );
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('validation');
      }
    });

    it('can be changed by any member using the device', async () => {
      await call(alex, 'POST', '/api/auth/profile', {
        memberId: 2,
        remember: false,
      });
      const off = await call(alex, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: false,
      });
      expect(off.statusCode).toBe(200);
      now += 60 * minute;
      expect((await me(alex)).statusCode).toBe(200);
    });

    it('does not reach the Home setting, and the Home setting does not reach it', async () => {
      await call(alex, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: false,
      });
      const home = await call(alex, 'GET', '/api/devices/current');
      expect(home.json()).toEqual({ hideHomeAmounts: true });
      await call(alex, 'PATCH', '/api/devices/current', {
        hideHomeAmounts: false,
      });
      expect(
        (await call(alex, 'GET', '/api/devices/current/lock')).json(),
      ).toEqual({ lockOnReopen: false });
    });
  });

  describe('devices', () => {
    it('lock one at a time: another device in use is not affected', async () => {
      const blair = await blairDevice();
      now += 4 * minute;
      expect((await present(blair)).statusCode).toBe(200);
      now += 2 * minute;
      // Alex's device was away for 6 minutes, Blair's for 2.
      expect((await me(alex)).statusCode).toBe(401);
      expect((await me(blair)).statusCode).toBe(200);
    });

    it('keep their own switch', async () => {
      const blair = await blairDevice();
      await call(blair, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: false,
      });
      expect(
        (await call(alex, 'GET', '/api/devices/current/lock')).json(),
      ).toEqual({ lockOnReopen: true });
      now += 60 * minute;
      expect((await me(alex)).statusCode).toBe(401);
      expect((await me(blair)).statusCode).toBe(200);
    });

    it('ask a new device to sign in again by default', async () => {
      const blair = await blairDevice();
      expect(
        (await call(blair, 'GET', '/api/devices/current/lock')).json(),
      ).toEqual({ lockOnReopen: true });
      now += reopenLockAfterMs + 1;
      expect((await me(blair)).statusCode).toBe(401);
    });
  });

  describe('what a lock leaves alone', () => {
    it('keeps push subscriptions, so a locked device still gets notifications', async () => {
      const subscribed = await call(alex, 'PUT', '/api/push/subscription', {
        endpoint: 'https://push.example.test/alex',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      });
      expect(subscribed.statusCode).toBe(200);
      now += 10 * minute;
      expect((await me(alex)).statusCode).toBe(401);
      expect(
        database.prepare('SELECT count(*) AS n FROM push_subscription').get(),
      ).toEqual({ n: 1n });
    });

    it('keeps the device default profile and the passkey', async () => {
      database
        .prepare(
          "INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) SELECT id, 'cred', 'key', 0, 1 FROM device",
        )
        .run();
      now += 10 * minute;
      const hints = await app.inject({
        method: 'GET',
        url: '/api/auth/device',
        headers: { cookie: alex },
      });
      expect(hints.json()).toEqual({
        defaultMember: { id: 1, name: 'Alex' },
        hasPasskey: true,
      });
    });

    it('cannot change the family password or sign out: the device signs in first', async () => {
      now += 10 * minute;
      const change = await call(alex, 'PUT', '/api/family/password', {
        currentPassword: password,
        newPassword: 'another long password',
      });
      expect(change.statusCode).toBe(401);
      expect(change.json().error.code).toBe('session_locked');
      expect(
        database.prepare('SELECT password_epoch FROM family').get(),
      ).toEqual({ password_epoch: 0n });
    });

    it('still signs in with the family password', async () => {
      now += 10 * minute;
      const signedIn = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers: { ...jsonHeaders, cookie: alex },
        payload: { password },
      });
      expect(signedIn.statusCode).toBe(200);
      expect(signedIn.json()).toEqual({ profileRequired: false });
    });
  });

  describe('failed sign-ins on a locked device', () => {
    it('count toward the existing lockout, and the lock does not weaken it', async () => {
      now += 10 * minute;
      expect((await me(alex)).statusCode).toBe(401);
      const wrong = () =>
        app.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          headers: { ...jsonHeaders, cookie: alex },
          payload: { password: 'not the password' },
        });
      const first = await wrong();
      expect(first.statusCode).toBe(401);
      expect(first.json().error.triesLeft).toBe(2);
      expect((await wrong()).json().error.triesLeft).toBe(1);
      const third = await wrong();
      expect(third.statusCode).toBe(423);
      expect(third.json().error).toMatchObject({
        code: 'locked',
        retryAfter: 30,
      });

      // The right password is refused during the wait, as for any device.
      const during = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers: { ...jsonHeaders, cookie: alex },
        payload: { password },
      });
      expect(during.statusCode).toBe(423);
      expect((await me(alex)).statusCode).toBe(401);

      now += 30_000;
      const after = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers: { ...jsonHeaders, cookie: alex },
        payload: { password },
      });
      expect(after.statusCode).toBe(200);
      expect((await me(cookieHeader(after))).statusCode).toBe(200);
    });

    it('count with the other devices: the counter is the family’s', async () => {
      const blair = await blairDevice();
      now += 10 * minute;
      expect((await me(blair)).statusCode).toBe(401);
      for (const cookie of [alex, blair, alex]) {
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          headers: { ...jsonHeaders, cookie },
          payload: { password: 'not the password' },
        });
      }
      const family = database
        .prepare('SELECT failed_signins, locked_until FROM family')
        .get() as { failed_signins: bigint; locked_until: bigint | null };
      expect(family.failed_signins).toBe(3n);
      expect(family.locked_until).toBe(BigInt(now + 30_000));
    });
  });

  describe('the live stream', () => {
    let base: string;
    const controllers: AbortController[] = [];

    beforeEach(async () => {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('No port');
      base = `http://127.0.0.1:${address.port}`;
    });

    afterEach(() => {
      for (const controller of controllers.splice(0)) controller.abort();
    });

    /** Opens the stream and notes when its body ends. */
    async function open(cookie: string) {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${base}/api/events`, {
        headers: { cookie },
        signal: controller.signal,
      });
      const stream = { response, ended: false };
      if (response.body) {
        const reader = response.body.getReader();
        const pump = (): Promise<void> =>
          reader.read().then(({ done }) => {
            if (done) stream.ended = true;
            else return pump();
          });
        // An aborted read at the end of a test is not a finding.
        pump().catch(() => undefined);
      }
      return stream;
    }

    async function until(done: () => boolean, what: string): Promise<void> {
      const deadline = Date.now() + 3000;
      while (!done()) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    it('ends when the session locks', async () => {
      const stream = await open(alex);
      expect(stream.response.status).toBe(200);
      now += reopenLockAfterMs + 1;
      await until(() => stream.ended, 'the stream to end');
    });

    it('stays open for as long as the app keeps saying it is in use', async () => {
      const stream = await open(alex);
      for (let elapsed = 0; elapsed < 15 * minute; elapsed += minute) {
        now += minute;
        await present(alex);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(stream.ended).toBe(false);
    });

    it('is refused for a session that is already locked', async () => {
      now += reopenLockAfterMs + 1;
      const response = await fetch(`${base}/api/events`, {
        headers: { cookie: alex },
      });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe('session_locked');
    });

    it('is not ended by the lock on a device with the switch off', async () => {
      await call(alex, 'PATCH', '/api/devices/current/lock', {
        lockOnReopen: false,
      });
      const stream = await open(alex);
      now += 60 * minute;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(stream.ended).toBe(false);
    });
  });

  describe('the migration', () => {
    /** Applies migrations 0000 to 0003, as the previous `main` had them. */
    async function previousMainDatabase(): Promise<Database.Database> {
      const legacy = join(directory, 'previous-main-migrations');
      await mkdir(join(legacy, 'meta'), { recursive: true });
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: Array<{ tag: string }> };
      const previous = journal.entries.slice(0, 4);
      expect(previous.at(-1)?.tag).toBe('0003_passkey-one-per-device');
      await writeFile(
        join(legacy, 'meta', '_journal.json'),
        JSON.stringify({ ...journal, entries: previous }),
      );
      for (const entry of previous) {
        await writeFile(
          join(legacy, `${entry.tag}.sql`),
          await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'),
        );
      }
      const old = new Database(join(directory, 'previous-main.sqlite'));
      old.pragma('foreign_keys = ON');
      await migrateDatabase(old, {
        backupDir: join(directory, 'old-backups'),
        migrationsFolder: legacy,
      });
      return old;
    }

    it('turns it on for every device already signed in, and keeps their data', async () => {
      const old = await previousMainDatabase();
      const lastUsed = Date.parse('2026-10-11T18:30:00.000Z');
      old
        .prepare(
          "INSERT INTO family (id, password_hash, created_at) VALUES (1, 'x', 1)",
        )
        .run();
      old
        .prepare("INSERT INTO member (name, created_at) VALUES ('Alex', 1)")
        .run();
      for (const id of ['phone', 'tablet']) {
        old
          .prepare(
            'INSERT INTO device (id, default_member_id, hide_home_amounts, label, created_at, last_seen_at) VALUES (?, 1, 0, ?, 1, 1)',
          )
          .run(id, `${id}-label`);
        old
          .prepare(
            'INSERT INTO session (token_hash, device_id, member_id, password_epoch, created_at, last_used_at, expires_at) VALUES (?, ?, 1, 0, 1, ?, ?)',
          )
          .run(`hash-${id}`, id, lastUsed, lastUsed + 90 * 24 * 60 * minute);
      }
      old
        .prepare(
          "INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) VALUES ('phone', 'cred', 'key', 0, 1)",
        )
        .run();
      old.close();

      const upgraded = new Database(join(directory, 'previous-main.sqlite'));
      upgraded.pragma('foreign_keys = ON');
      const applied = await migrateDatabase(upgraded, {
        backupDir: join(directory, 'new-backups'),
        migrationsFolder,
      });
      expect(applied).toBeGreaterThanOrEqual(5);

      expect(
        upgraded
          .prepare(
            'SELECT id, lock_on_reopen, hide_home_amounts, default_member_id FROM device ORDER BY id',
          )
          .all(),
      ).toEqual([
        {
          id: 'phone',
          lock_on_reopen: 1n,
          hide_home_amounts: 0n,
          default_member_id: 1n,
        },
        {
          id: 'tablet',
          lock_on_reopen: 1n,
          hide_home_amounts: 0n,
          default_member_id: 1n,
        },
      ]);
      expect(
        upgraded
          .prepare(
            'SELECT device_id, foreground_at, last_used_at FROM session ORDER BY id',
          )
          .all(),
      ).toEqual([
        {
          device_id: 'phone',
          foreground_at: BigInt(lastUsed),
          last_used_at: BigInt(lastUsed),
        },
        {
          device_id: 'tablet',
          foreground_at: BigInt(lastUsed),
          last_used_at: BigInt(lastUsed),
        },
      ]);
      // Recreating nothing: rows that point at a device are still there.
      expect(
        upgraded.prepare('SELECT count(*) AS n FROM passkey').get(),
      ).toEqual({ n: 1n });
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);
      expect(() =>
        upgraded.prepare('UPDATE device SET lock_on_reopen = 2').run(),
      ).toThrow(/CHECK/u);
      upgraded.close();
    });
  });
});

function deviceCountOf(database: Database.Database): number {
  return Number(
    (
      database.prepare('SELECT count(*) AS n FROM device').get() as {
        n: bigint;
      }
    ).n,
  );
}

function cookieHeader(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? header : [header])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
