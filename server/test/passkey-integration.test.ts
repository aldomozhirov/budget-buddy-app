import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { SoftwareAuthenticator } from './softwareAuthenticator.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const otherOrigin = 'https://other.budget-buddy.test';
const rpId = 'budget-buddy.test';
const password = 'correct family password';
const json = { origin, 'content-type': 'application/json' };

type App = Awaited<ReturnType<typeof createApp>>;
type Device = {
  cookie: string;
  deviceCookie: string;
  auth: SoftwareAuthenticator;
};

describe('Face ID passkeys (task 29)', () => {
  let app: App;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let logs: string[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-passkey-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    now = Date.parse('2026-10-12T09:00:00.000Z');
    logs = [];
    app = await makeApp([origin, otherOrigin]);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function makeApp(appOrigins: string[], logger = false) {
    return createApp({
      database,
      logger,
      ...(logger
        ? { loggerStream: { write: (m: string) => logs.push(m) } }
        : {}),
      appOrigins,
      secureCookies: false,
      clock: { now: () => new Date(now) },
    });
  }

  const post = (
    url: string,
    cookie: string | undefined,
    payload: unknown = {},
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url,
      headers: { ...json, ...(cookie ? { cookie } : {}), ...headers },
      payload: payload as object,
    });

  function cookiesOf(response: { headers: Record<string, unknown> }): string {
    const setCookie = response.headers['set-cookie'];
    return (Array.isArray(setCookie) ? setCookie : [setCookie])
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.split(';', 1)[0])
      .join('; ');
  }

  async function createFamily(): Promise<Device> {
    const response = await post('/api/setup', undefined, {
      password,
      passwordConfirmation: password,
      profiles: ['Alex', 'Blair'],
    });
    expect(response.statusCode).toBe(201);
    return deviceFrom(cookiesOf(response));
  }

  /** A second browser: signs in with the password and picks a profile. */
  async function newDevice(remember = false): Promise<Device> {
    const signIn = await post('/api/auth/sign-in', undefined, { password });
    expect(signIn.statusCode).toBe(200);
    const cookie = cookiesOf(signIn);
    const chosen = await post('/api/auth/profile', cookie, {
      memberId: 2,
      remember,
    });
    expect(chosen.statusCode).toBe(200);
    return deviceFrom(cookie);
  }

  function deviceFrom(cookie: string): Device {
    return {
      cookie,
      deviceCookie: cookie.split('; ').find((c) => c.startsWith('bb_device='))!,
      auth: new SoftwareAuthenticator(rpId),
    };
  }

  /** Turns Face ID on for a device through the two registration routes. */
  async function enable(device: Device, behaviour = {}) {
    const options = await post(
      '/api/auth/passkey/register/options',
      device.cookie,
    );
    expect(options.statusCode).toBe(200);
    return post('/api/auth/passkey/register/verify', device.cookie, {
      response: device.auth.create(options.json(), { origin }, behaviour),
    });
  }

  /** Runs a full Face ID sign-in from a signed-out browser. */
  async function faceIdSignIn(device: Device, behaviour = {}) {
    const options = await post(
      '/api/auth/passkey/authenticate/options',
      device.deviceCookie,
    );
    expect(options.statusCode).toBe(200);
    return post('/api/auth/passkey/authenticate/verify', device.deviceCookie, {
      response: device.auth.get(options.json(), { origin }, behaviour),
    });
  }

  const passkeyRows = () =>
    database
      .prepare('SELECT device_id, credential_id, counter FROM passkey')
      .all() as Array<{
      device_id: string;
      credential_id: string;
      counter: bigint;
    }>;

  const failedSignins = () =>
    (
      database.prepare('SELECT failed_signins FROM family').get() as {
        failed_signins: bigint;
      }
    ).failed_signins;

  describe('registration', () => {
    it('needs a signed-in session with a profile', async () => {
      await createFamily();
      for (const url of [
        '/api/auth/passkey/register/options',
        '/api/auth/passkey/register/verify',
      ]) {
        const response = await post(url, undefined);
        expect(response.statusCode, url).toBe(401);
      }
      const noProfile = await post('/api/auth/sign-in', undefined, {
        password,
      });
      const response = await post(
        '/api/auth/passkey/register/options',
        cookiesOf(noProfile),
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('profile_required');
    });

    it('asks for a platform authenticator with user verification required', async () => {
      const device = await createFamily();
      const response = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const options = response.json();
      expect(response.headers['cache-control']).toBe('no-store');
      expect(options.rp.id).toBe(rpId);
      expect(options.authenticatorSelection).toMatchObject({
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      });
      expect(options.attestation).toBe('none');
      expect(options.user.name).toBe('Alex');
      // The user handle is opaque: not the device id from the cookie.
      expect(device.deviceCookie).not.toContain(options.user.id);
    });

    it('stores the credential for this device and turns the switch on', async () => {
      const device = await createFamily();
      const response = await enable(device);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ hasPasskey: true });
      expect(passkeyRows()).toEqual([
        {
          device_id: device.deviceCookie.replace('bb_device=', ''),
          credential_id: device.auth.id,
          counter: 0n,
        },
      ]);
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: device.cookie },
      });
      expect(me.json().device.hasPasskey).toBe(true);
    });

    it('refuses a registration without user verification', async () => {
      const device = await createFamily();
      const response = await enable(device, { userVerified: false });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation');
      expect(passkeyRows()).toEqual([]);
    });

    it('refuses a registration signed for another web address', async () => {
      const device = await createFamily();
      const options = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const wrongOrigin = await post(
        '/api/auth/passkey/register/verify',
        device.cookie,
        {
          response: device.auth.create(options.json(), { origin: otherOrigin }),
        },
      );
      expect(wrongOrigin.statusCode).toBe(400);
      expect(passkeyRows()).toEqual([]);
    });

    it('refuses a registration made for another relying party', async () => {
      const device = await createFamily();
      const options = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const response = await post(
        '/api/auth/passkey/register/verify',
        device.cookie,
        {
          response: device.auth.create(options.json(), {
            origin,
            rpId: 'evil.test',
          }),
        },
      );
      expect(response.statusCode).toBe(400);
      expect(passkeyRows()).toEqual([]);
    });

    it('answers a challenge once, and only before it expires', async () => {
      const device = await createFamily();
      const options = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const answer = device.auth.create(options.json(), { origin });
      expect(
        (
          await post('/api/auth/passkey/register/verify', device.cookie, {
            response: answer,
          })
        ).statusCode,
      ).toBe(200);
      const replay = await post(
        '/api/auth/passkey/register/verify',
        device.cookie,
        { response: answer },
      );
      expect(replay.statusCode).toBe(400);

      const late = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const lateAnswer = new SoftwareAuthenticator(rpId).create(late.json(), {
        origin,
      });
      now += 91_000;
      const expired = await post(
        '/api/auth/passkey/register/verify',
        device.cookie,
        { response: lateAnswer },
      );
      expect(expired.statusCode).toBe(400);
    });

    it('binds the challenge to the session that asked', async () => {
      const device = await createFamily();
      const options = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const secondSession = await post(
        '/api/auth/sign-in',
        device.deviceCookie,
        { password },
      );
      const response = await post(
        '/api/auth/passkey/register/verify',
        cookiesOf(secondSession),
        { response: device.auth.create(options.json(), { origin }) },
      );
      expect(response.statusCode).toBe(400);
      expect(passkeyRows()).toEqual([]);
    });

    it('keeps one passkey per device: turning it on again replaces it', async () => {
      const device = await createFamily();
      await enable(device);
      const first = device.auth.id;
      device.auth = new SoftwareAuthenticator(rpId);
      expect((await enable(device)).statusCode).toBe(200);
      expect(passkeyRows().map((r) => r.credential_id)).toEqual([
        device.auth.id,
      ]);
      expect(device.auth.id).not.toBe(first);
    });

    it('refuses a credential that another device already holds', async () => {
      const first = await createFamily();
      await enable(first);
      const second = await newDevice();
      second.auth = first.auth;
      const response = await enable(second);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('conflict');
      expect(passkeyRows()).toHaveLength(1);
    });
  });

  describe('signing in', () => {
    it('opens the same session the password does', async () => {
      const device = await createFamily();
      await enable(device);
      await post('/api/auth/sign-out', device.cookie);

      const response = await faceIdSignIn(device);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ profileRequired: false });

      const passwordSignIn = await post(
        '/api/auth/sign-in',
        device.deviceCookie,
        { password },
      );
      const passkeyCookies = response.headers['set-cookie'] as string[];
      const passwordCookies = passwordSignIn.headers['set-cookie'] as string[];
      // Same cookie names and attributes (HttpOnly, SameSite, 90 days).
      const shape = (cookies: string[]) =>
        cookies.map((c) => c.replace(/=[^;]*/u, '='));
      expect(shape(passkeyCookies)).toEqual(shape(passwordCookies));

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookiesOf(response) },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().member).toEqual({ id: 1, name: 'Alex' });
      const sessions = database
        .prepare('SELECT password_epoch FROM session')
        .all() as Array<{ password_epoch: bigint }>;
      const family = database
        .prepare('SELECT password_epoch FROM family')
        .get() as {
        password_epoch: bigint;
      };
      expect(
        sessions.every((s) => s.password_epoch === family.password_epoch),
      ).toBe(true);
    });

    it('goes on to the profile picker on a device without a default profile', async () => {
      await createFamily();
      const device = await newDevice(false);
      await enable(device);
      await post('/api/auth/sign-out', device.cookie);
      const response = await faceIdSignIn(device);
      expect(response.json()).toEqual({ profileRequired: true });
    });

    it('rejects a state-changing request from a foreign origin', async () => {
      const device = await createFamily();
      await enable(device);
      const response = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
        {},
        { origin: 'https://attacker.example' },
      );
      expect(response.statusCode).toBe(403);
    });

    it('keeps the session valid only until the password changes, like any session', async () => {
      const device = await createFamily();
      await enable(device);
      await post('/api/auth/sign-out', device.cookie);
      const signedIn = await faceIdSignIn(device);
      const cookie = cookiesOf(signedIn);
      database
        .prepare('UPDATE family SET password_epoch = password_epoch + 1')
        .run();
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(me.statusCode).toBe(401);
    });

    it('checks the signature counter and refuses a replayed answer', async () => {
      const device = await createFamily();
      await enable(device);
      expect((await faceIdSignIn(device)).statusCode).toBe(200);
      expect(passkeyRows()[0]!.counter).toBe(1n);
      expect((await faceIdSignIn(device)).statusCode).toBe(200);
      expect(passkeyRows()[0]!.counter).toBe(2n);

      const stale = await faceIdSignIn(device, { counter: 1 });
      expect(stale.statusCode).toBe(401);
      expect(passkeyRows()[0]!.counter).toBe(2n);
      const sameAgain = await faceIdSignIn(device, { counter: 2 });
      expect(sameAgain.statusCode).toBe(401);
    });

    it('accepts an authenticator that always reports counter 0', async () => {
      const device = await createFamily();
      await enable(device);
      expect((await faceIdSignIn(device, { counter: 0 })).statusCode).toBe(200);
      expect((await faceIdSignIn(device, { counter: 0 })).statusCode).toBe(200);
    });

    it('refuses an answer without user verification', async () => {
      const device = await createFamily();
      await enable(device);
      const response = await faceIdSignIn(device, { userVerified: false });
      expect(response.statusCode).toBe(401);
    });

    it('refuses an answer signed for another web address or relying party', async () => {
      const device = await createFamily();
      await enable(device);
      for (const context of [
        { origin: otherOrigin },
        { origin, rpId: 'evil.test' },
      ]) {
        const options = await post(
          '/api/auth/passkey/authenticate/options',
          device.deviceCookie,
        );
        const response = await post(
          '/api/auth/passkey/authenticate/verify',
          device.deviceCookie,
          {
            response: device.auth.get(options.json(), context),
          },
        );
        expect(response.statusCode).toBe(401);
      }
    });

    it('refuses an answer signed by another key', async () => {
      const device = await createFamily();
      await enable(device);
      const impostor = new SoftwareAuthenticator(rpId);
      Object.defineProperty(impostor, 'credentialId', {
        value: device.auth.credentialId,
      });
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const response = await post(
        '/api/auth/passkey/authenticate/verify',
        device.deviceCookie,
        {
          response: impostor.get(options.json(), { origin }),
        },
      );
      expect(response.statusCode).toBe(401);
    });

    it('answers a challenge once, and only before it expires', async () => {
      const device = await createFamily();
      await enable(device);
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const answer = device.auth.get(options.json(), { origin });
      const send = (body = answer) =>
        post('/api/auth/passkey/authenticate/verify', device.deviceCookie, {
          response: body,
        });
      expect((await send()).statusCode).toBe(200);
      expect(
        (await send(device.auth.get(options.json(), { origin }))).statusCode,
      ).toBe(401);

      const late = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const lateAnswer = device.auth.get(late.json(), { origin });
      now += 91_000;
      expect((await send(lateAnswer)).statusCode).toBe(401);
    });
  });

  describe('devices', () => {
    it('refuses a credential of another device', async () => {
      const first = await createFamily();
      await enable(first);
      const second = await newDevice();
      await enable(second);

      // The second device asks for a challenge; the first device's key signs it.
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        second.deviceCookie,
      );
      const response = await post(
        '/api/auth/passkey/authenticate/verify',
        second.deviceCookie,
        {
          response: first.auth.get(options.json(), { origin }),
        },
      );
      expect(response.statusCode).toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('refuses an answer to a challenge another device was given', async () => {
      const first = await createFamily();
      await enable(first);
      const second = await newDevice();
      await enable(second);
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        second.deviceCookie,
      );
      // The first device answers with the second device's challenge.
      const response = await post(
        '/api/auth/passkey/authenticate/verify',
        first.deviceCookie,
        {
          response: first.auth.get(options.json(), { origin }),
        },
      );
      expect(response.statusCode).toBe(401);
    });

    it('tells a signed-out visitor nothing about other devices or members', async () => {
      const first = await createFamily();
      await enable(first);
      const second = await newDevice(true);

      const withoutPasskey = await post(
        '/api/auth/passkey/authenticate/options',
        second.deviceCookie,
      );
      const unknownDevice = await post(
        '/api/auth/passkey/authenticate/options',
        'bb_device=0000000000000000ffffffffffffffff',
      );
      const noCookie = await post(
        '/api/auth/passkey/authenticate/options',
        undefined,
      );
      for (const response of [withoutPasskey, unknownDevice, noCookie]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual(withoutPasskey.json());
      }

      const hint = await app.inject({ method: 'GET', url: '/api/auth/device' });
      expect(hint.json()).toEqual({ defaultMember: null, hasPasskey: false });
      const own = await app.inject({
        method: 'GET',
        url: '/api/auth/device',
        headers: { cookie: first.deviceCookie },
      });
      expect(own.json()).toEqual({
        defaultMember: { id: 1, name: 'Alex' },
        hasPasskey: true,
      });
      const other = await app.inject({
        method: 'GET',
        url: '/api/auth/device',
        headers: { cookie: second.deviceCookie },
      });
      expect(other.json()).toEqual({
        defaultMember: { id: 2, name: 'Blair' },
        hasPasskey: false,
      });
    });

    it('removes the passkey when the switch is turned off', async () => {
      const first = await createFamily();
      await enable(first);
      const second = await newDevice();
      await enable(second);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/devices/current/passkey',
        headers: { ...json, cookie: first.cookie },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ hasPasskey: false });
      expect(passkeyRows().map((r) => r.credential_id)).toEqual([
        second.auth.id,
      ]);
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        first.deviceCookie,
      );
      expect(options.statusCode).toBe(404);
      expect((await faceIdSignIn(second)).statusCode).toBe(200);
    });

    it('needs a session to turn the switch off', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/devices/current/passkey',
        headers: json,
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('keeps the changer’s passkey and removes the others on a password change', async () => {
      const first = await createFamily();
      await enable(first);
      const second = await newDevice();
      await enable(second);

      const changed = await app.inject({
        method: 'PUT',
        url: '/api/family/password',
        headers: { ...json, cookie: first.cookie },
        payload: {
          currentPassword: password,
          newPassword: 'a brand new password',
        },
      });
      expect(changed.statusCode).toBe(200);
      expect(passkeyRows().map((r) => r.credential_id)).toEqual([
        first.auth.id,
      ]);

      const gone = await post(
        '/api/auth/passkey/authenticate/options',
        second.deviceCookie,
      );
      expect(gone.statusCode).toBe(404);
      await post('/api/auth/sign-out', first.cookie);
      const kept = await faceIdSignIn(first);
      expect(kept.statusCode).toBe(200);
    });
  });

  describe('lockout', () => {
    it('counts failed Face ID tries with the wrong passwords', async () => {
      const device = await createFamily();
      await enable(device);
      await post('/api/auth/sign-out', device.cookie);
      const wrong = await post('/api/auth/sign-in', device.deviceCookie, {
        password: 'nope',
      });
      expect(wrong.json().error.triesLeft).toBe(2);

      const options = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const first = await post(
        '/api/auth/passkey/authenticate/verify',
        device.deviceCookie,
        {
          response: device.auth.get(
            options.json(),
            { origin },
            { userVerified: false },
          ),
        },
      );
      expect(first.statusCode).toBe(401);
      expect(first.json().error).toMatchObject({
        code: 'unauthenticated',
        triesLeft: 1,
        message: 'Face ID didn’t work. 1 try before a short wait.',
      });

      const options2 = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const third = await post(
        '/api/auth/passkey/authenticate/verify',
        device.deviceCookie,
        {
          response: device.auth.get(
            options2.json(),
            { origin },
            { userVerified: false },
          ),
        },
      );
      expect(third.statusCode).toBe(423);
      expect(third.json().error).toMatchObject({
        code: 'locked',
        retryAfter: 30,
      });
    });

    it('refuses even a good answer while locked, and resets the count on success', async () => {
      const device = await createFamily();
      await enable(device);
      await post('/api/auth/sign-out', device.cookie);
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const answer = device.auth.get(options.json(), { origin });
      for (let i = 0; i < 3; i += 1) {
        await post('/api/auth/sign-in', device.deviceCookie, {
          password: 'nope',
        });
      }

      const locked = await post(
        '/api/auth/passkey/authenticate/verify',
        device.deviceCookie,
        { response: answer },
      );
      expect(locked.statusCode).toBe(423);
      expect(locked.headers['set-cookie']).toBeUndefined();
      expect(
        (
          await post(
            '/api/auth/passkey/authenticate/options',
            device.deviceCookie,
          )
        ).statusCode,
      ).toBe(423);

      now += 30_000;
      expect(failedSignins()).toBe(3n);
      expect((await faceIdSignIn(device)).statusCode).toBe(200);
      expect(failedSignins()).toBe(0n);
    });

    it('does not count a cancelled or unrequested attempt', async () => {
      const device = await createFamily();
      await enable(device);
      await post('/api/auth/sign-out', device.cookie);
      // Asking for options and never answering is what a cancelled prompt is.
      await post('/api/auth/passkey/authenticate/options', device.deviceCookie);
      await post('/api/auth/passkey/authenticate/options', device.deviceCookie);
      expect(failedSignins()).toBe(0n);
      const malformed = await post(
        '/api/auth/passkey/authenticate/verify',
        device.deviceCookie,
        {
          response: { id: 'x' },
        },
      );
      expect(malformed.statusCode).toBe(400);
      expect(failedSignins()).toBe(0n);
    });

    it('counts an answer with no challenge as a failed try', async () => {
      const device = await createFamily();
      await enable(device);
      const answer = device.auth.get({ challenge: 'AAAA' }, { origin });
      const response = await post(
        '/api/auth/passkey/authenticate/verify',
        device.deviceCookie,
        {
          response: answer,
        },
      );
      expect(response.statusCode).toBe(401);
      expect(failedSignins()).toBe(1n);
    });
  });

  describe('relying party', () => {
    it('uses the first APP_ORIGIN as the relying party', async () => {
      const device = await createFamily();
      const options = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      expect(options.json().rp.id).toBe(rpId);
    });

    it('refuses every passkey route from the other listed origins', async () => {
      const device = await createFamily();
      await enable(device);
      for (const url of [
        '/api/auth/passkey/register/options',
        '/api/auth/passkey/register/verify',
        '/api/auth/passkey/authenticate/options',
        '/api/auth/passkey/authenticate/verify',
      ]) {
        const response = await post(
          url,
          device.cookie,
          {},
          { origin: otherOrigin },
        );
        expect(response.statusCode, url).toBe(403);
        expect(response.json().error.code).toBe('forbidden_state');
        expect(response.json().error.message).toContain('another address');
      }
      // Refusing is not a failed try.
      expect(failedSignins()).toBe(0n);
    });

    it('serves no Face ID from an IP address or plain http', async () => {
      for (const appOrigins of [
        ['http://127.0.0.1:5173'],
        ['http://[::1]:5173'],
        ['http://budget-buddy.test'],
      ]) {
        await app.close();
        app = await makeApp(appOrigins);
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/passkey/authenticate/options',
          headers: {
            origin: appOrigins[0]!,
            'content-type': 'application/json',
          },
          payload: {},
        });
        expect(response.statusCode, appOrigins[0]).toBe(403);
        expect(response.json().error.message).toContain('https');
      }
    });

    it('accepts http on localhost, with localhost as the RP ID', async () => {
      await app.close();
      app = await makeApp(['http://localhost:5173']);
      const setup = await app.inject({
        method: 'POST',
        url: '/api/setup',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
        },
        payload: {
          password,
          passwordConfirmation: password,
          profiles: ['Alex'],
        },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/options',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          cookie: cookiesOf(setup),
        },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().rp.id).toBe('localhost');
    });
  });

  describe('logs (SEC)', () => {
    it('hold no challenge, credential, key or signature', async () => {
      await app.close();
      app = await makeApp([origin], true);
      const device = await createFamily();
      const registerOptions = await post(
        '/api/auth/passkey/register/options',
        device.cookie,
      );
      const registration = device.auth.create(registerOptions.json(), {
        origin,
      });
      await post('/api/auth/passkey/register/verify', device.cookie, {
        response: registration,
      });
      await post('/api/auth/sign-out', device.cookie);
      const options = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      const assertion = device.auth.get(options.json(), { origin });
      await post('/api/auth/passkey/authenticate/verify', device.deviceCookie, {
        response: assertion,
      });
      // A failing try, whose library error quotes the challenge.
      const bad = await post(
        '/api/auth/passkey/authenticate/options',
        device.deviceCookie,
      );
      await post('/api/auth/passkey/authenticate/verify', device.deviceCookie, {
        response: device.auth.get(bad.json(), { origin: otherOrigin }),
      });

      const secrets = [
        registerOptions.json().challenge,
        options.json().challenge,
        bad.json().challenge,
        device.auth.id,
        registration.response.attestationObject,
        registration.response.clientDataJSON,
        assertion.response.signature,
        assertion.response.authenticatorData,
        passkeyRowsPublicKey(),
        device.deviceCookie.replace('bb_device=', ''),
      ];
      const output = logs.join('\n');
      expect(output.length).toBeGreaterThan(0);
      for (const secret of secrets) {
        expect(secret).toBeTruthy();
        expect(output).not.toContain(secret);
      }
    });

    function passkeyRowsPublicKey(): string {
      return (
        database.prepare('SELECT public_key FROM passkey').get() as {
          public_key: string;
        }
      ).public_key;
    }
  });
});
