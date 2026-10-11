import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import {
  passkeyAuthenticateVerifyRequestSchema,
  passkeyOptionsResponseSchema,
  passkeyRegisterVerifyRequestSchema,
  passkeyStateResponseSchema,
  signInResponseSchema,
} from '@budget-buddy/shared';
import { systemClock, type Clock } from '../../clock.js';
import { readCookie, setSessionCookies } from '../../plugins/session.js';
import {
  activeLockEnd,
  openSession,
  recordFailedSignIn,
  sendFailedSignIn,
  sendLocked,
} from '../auth/signIn.js';
import { ChallengeStore } from './challenges.js';
import { originIsRelyingParty, relyingPartyFrom } from './relyingParty.js';

/** How long a challenge may wait; the browser's own timeout is 60 s. */
const challengeLifetimeMs = 90_000;
const ceremonyTimeoutMs = 60_000;

/**
 * Registers Face ID: a platform passkey per device (MEM-6). Registration needs
 * a signed-in session; signing in with the passkey opens exactly the session
 * the password does and its failures count toward the same lockout.
 */
export const passkeyRoutes: FastifyPluginAsync<{
  database: Database.Database;
  secureCookies: boolean;
  appOrigins: string[];
  clock?: Clock;
}> = async (app, options) => {
  const { database, secureCookies } = options;
  const clock = options.clock ?? systemClock;
  const relyingParty = relyingPartyFrom(options.appOrigins);
  const challenges = new ChallengeStore(challengeLifetimeMs, clock);

  /** Refuses a request that cannot use Face ID here; returns null if fine. */
  const refuseUnlessRelyingParty = (
    origin: string | undefined,
    reply: FastifyReply,
  ) => {
    if (!relyingParty) {
      return reply.code(403).send({
        error: {
          code: 'forbidden_state',
          message:
            'Face ID needs the app’s https web address, not an IP address.',
        },
      });
    }
    if (!originIsRelyingParty(origin, relyingParty)) {
      return reply.code(403).send({
        error: {
          code: 'forbidden_state',
          message:
            'Face ID is set up for another address of this app. Open the app there.',
        },
      });
    }
    return null;
  };

  app.post('/api/auth/passkey/register/options', async (request, reply) => {
    const refused = refuseUnlessRelyingParty(request.headers.origin, reply);
    if (refused) return refused;
    const context = request.authContext!;
    const name = context.memberName ?? 'Budget Buddy';
    const registrationOptions = await generateRegistrationOptions({
      rpName: 'Budget Buddy',
      rpID: relyingParty!.id,
      userName: name,
      userDisplayName: name,
      // Opaque and stable per device, so registering again replaces the
      // credential in the keychain instead of adding another.
      userID: createHash('sha256')
        .update(`budget-buddy:passkey-user:${context.deviceId}`)
        .digest(),
      attestationType: 'none',
      timeout: ceremonyTimeoutMs,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    challenges.issue(
      'register',
      context.deviceId,
      registrationOptions.challenge,
      context.sessionId,
    );
    reply.header('Cache-Control', 'no-store');
    return passkeyOptionsResponseSchema.parse(registrationOptions);
  });

  app.post('/api/auth/passkey/register/verify', async (request, reply) => {
    const refused = refuseUnlessRelyingParty(request.headers.origin, reply);
    if (refused) return refused;
    const parsed = passkeyRegisterVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendRegistrationFailed(reply);

    const context = request.authContext!;
    const challenge = challenges.take(
      'register',
      context.deviceId,
      context.sessionId,
    );
    if (!challenge) return sendRegistrationFailed(reply);

    let credential: { id: string; publicKey: Uint8Array; counter: number };
    try {
      const verification = await verifyRegistrationResponse({
        response: parsed.data.response as Parameters<
          typeof verifyRegistrationResponse
        >[0]['response'],
        expectedChallenge: challenge,
        expectedOrigin: relyingParty!.origin,
        expectedRPID: relyingParty!.id,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return sendRegistrationFailed(reply);
      }
      credential = verification.registrationInfo.credential;
    } catch {
      // The library's messages quote challenges and origins: log nothing.
      return sendRegistrationFailed(reply);
    }

    try {
      database.transaction(() => {
        database
          .prepare('DELETE FROM passkey WHERE device_id = ?')
          .run(context.deviceId);
        database
          .prepare(
            'INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            context.deviceId,
            credential.id,
            isoBase64URL.fromBuffer(
              credential.publicKey as Uint8Array<ArrayBuffer>,
            ),
            credential.counter,
            clock.now().getTime(),
          );
      })();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({
          error: {
            code: 'conflict',
            message: 'That Face ID is already used on another device.',
          },
        });
      }
      throw error;
    }
    return passkeyStateResponseSchema.parse({ hasPasskey: true });
  });

  app.post(
    '/api/auth/passkey/authenticate/options',
    { config: { auth: 'open' } },
    async (request, reply) => {
      const refused = refuseUnlessRelyingParty(request.headers.origin, reply);
      if (refused) return refused;
      const now = clock.now().getTime();
      const lockEnd = activeLockEnd(database, now);
      if (lockEnd !== null) return sendLocked(reply, lockEnd, now);

      const deviceId = readCookie(request.headers.cookie, 'bb_device');
      const row = deviceId
        ? (database
            .prepare('SELECT credential_id FROM passkey WHERE device_id = ?')
            .get(deviceId) as { credential_id: string } | undefined)
        : undefined;
      if (!deviceId || !row) {
        // The same answer for an unknown device and one without a passkey.
        return reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Face ID isn’t set up on this device.',
          },
        });
      }

      const authenticationOptions = await generateAuthenticationOptions({
        rpID: relyingParty!.id,
        allowCredentials: [{ id: row.credential_id }],
        userVerification: 'required',
        timeout: ceremonyTimeoutMs,
      });
      challenges.issue(
        'authenticate',
        deviceId,
        authenticationOptions.challenge,
      );
      reply.header('Cache-Control', 'no-store');
      return passkeyOptionsResponseSchema.parse(authenticationOptions);
    },
  );

  app.post(
    '/api/auth/passkey/authenticate/verify',
    { config: { auth: 'open' } },
    async (request, reply) => {
      const refused = refuseUnlessRelyingParty(request.headers.origin, reply);
      if (refused) return refused;
      const parsed = passkeyAuthenticateVerifyRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'validation', message: 'Try Face ID again.' },
        });
      }

      const now = clock.now().getTime();
      const family = database
        .prepare('SELECT password_epoch FROM family WHERE id = 1')
        .get() as { password_epoch: bigint } | undefined;
      if (!family) {
        return reply.code(403).send({
          error: {
            code: 'forbidden_state',
            message: 'First start has not been completed.',
          },
        });
      }
      const lockEnd = activeLockEnd(database, now);
      if (lockEnd !== null) return sendLocked(reply, lockEnd, now);

      // Every way of not proving the device's passkey is one failed try.
      const fail = () =>
        sendFailedSignIn(
          reply,
          recordFailedSignIn(database, now),
          now,
          'Face ID didn’t work.',
        );

      const deviceCookie = readCookie(request.headers.cookie, 'bb_device');
      const challenge = deviceCookie
        ? challenges.take('authenticate', deviceCookie)
        : null;
      if (!deviceCookie || !challenge) return fail();

      const { response } = parsed.data;
      const stored = database
        .prepare(
          'SELECT id, device_id, credential_id, public_key, counter FROM passkey WHERE credential_id = ?',
        )
        .get(response.id) as
        | {
            id: bigint;
            device_id: string;
            credential_id: string;
            public_key: string;
            counter: bigint;
          }
        | undefined;
      // A credential of another device is refused like an unknown one.
      if (!stored || stored.device_id !== deviceCookie) return fail();

      let newCounter: number;
      try {
        const verification = await verifyAuthenticationResponse({
          response: response as Parameters<
            typeof verifyAuthenticationResponse
          >[0]['response'],
          expectedChallenge: challenge,
          expectedOrigin: relyingParty!.origin,
          expectedRPID: relyingParty!.id,
          requireUserVerification: true,
          credential: {
            id: stored.credential_id,
            publicKey: isoBase64URL.toBuffer(stored.public_key),
            counter: Number(stored.counter),
          },
        });
        if (!verification.verified) return fail();
        newCounter = verification.authenticationInfo.newCounter;
      } catch {
        // The library's messages quote challenges and origins: log nothing.
        return fail();
      }

      const outcome = database.transaction(() => {
        const lock = activeLockEnd(database, now);
        if (lock !== null) return { lock } as const;
        // Only the answer that still sees the old counter wins a race.
        const advanced = database
          .prepare(
            'UPDATE passkey SET counter = ? WHERE id = ? AND counter = ?',
          )
          .run(newCounter, stored.id, stored.counter);
        if (advanced.changes !== 1) return { stale: true } as const;
        return {
          opened: openSession(database, {
            deviceCookie,
            userAgent: request.headers['user-agent'],
            passwordEpoch: family.password_epoch,
            now,
          }),
        } as const;
      })();

      if ('lock' in outcome) return sendLocked(reply, outcome.lock, now);
      if ('stale' in outcome) return fail();
      if (!outcome.opened) {
        return sendLocked(reply, activeLockEnd(database, now) ?? now, now);
      }
      setSessionCookies(reply, {
        deviceId: outcome.opened.deviceId,
        sessionToken: outcome.opened.sessionToken,
        secureCookies,
      });
      return signInResponseSchema.parse({
        profileRequired: outcome.opened.memberId === null,
      });
    },
  );

  app.delete('/api/devices/current/passkey', async (request) => {
    database
      .prepare('DELETE FROM passkey WHERE device_id = ?')
      .run(request.authContext!.deviceId);
    return passkeyStateResponseSchema.parse({ hasPasskey: false });
  });
};

function sendRegistrationFailed(reply: FastifyReply) {
  return reply.code(400).send({
    error: {
      code: 'validation',
      message: 'Face ID could not be turned on. Try again.',
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
