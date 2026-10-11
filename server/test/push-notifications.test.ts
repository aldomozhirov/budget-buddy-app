import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ISO_4217_CODES } from '@budget-buddy/shared';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createCheckinEventBus } from '../src/events.js';
import { createCheckinScheduleJob } from '../src/jobs/checkinSchedule.js';
import { createJobRunner } from '../src/jobs/runner.js';
import { createNotifier, type Notifier } from '../src/notify/notifier.js';
import { createFakePushSender } from './fakePushSender.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';
const endpointOf = (device: string) => `https://push.example.test/${device}`;

describe('Web Push notifications', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let events: ReturnType<typeof createCheckinEventBus>;
  let sender: ReturnType<typeof createFakePushSender>;
  let notifier: Notifier;
  /** Session cookies per device name, e.g. `Alex`, `Alex iPad`. */
  const cookies = new Map<string, string>();
  const clock = { now: () => new Date(now) };

  const request = (
    device: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie: cookies.get(device)! },
      ...(payload === undefined ? {} : { payload }),
    });

  /** A new device that signs in with the password and opens as `name`. */
  async function signInAs(device: string, name: string, memberId: number) {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { ...jsonHeaders, 'user-agent': `${device}/1.0` },
      payload: { password },
    });
    expect(signedIn.statusCode, name).toBe(200);
    cookies.set(device, cookieHeader(signedIn));
    const profile = await request(device, 'POST', '/api/auth/profile', {
      memberId,
      remember: false,
    });
    expect(profile.statusCode).toBe(200);
  }

  async function subscribe(device: string) {
    const response = await request(device, 'PUT', '/api/push/subscription', {
      endpoint: endpointOf(device),
      keys: { p256dh: `p256dh-${device}`, auth: `auth-${device}` },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  const startCheckin = (device: string) =>
    request(device, 'POST', '/api/checkins', {});
  const closeCheckin = (device: string, id: number) =>
    request(device, 'POST', `/api/checkins/${id}/close`, {});
  const subscriptionCount = () =>
    (
      database.prepare('SELECT COUNT(*) AS n FROM push_subscription').get() as {
        n: bigint;
      }
    ).n;
  const endpointsSent = () => sender.sent.map((push) => push.endpoint).sort();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-push-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = Date.parse('2026-11-10T12:00:00Z');
    events = createCheckinEventBus();
    sender = createFakePushSender();
    await migrateDatabase(database, { backupDir: directory, migrationsFolder });
    notifier = createNotifier({ database, sender, clock, events });
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
      clock,
      events,
      push: {
        publicKey: 'test-public-key',
        allowedHosts: ['push.example.test'],
      },
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'Alex/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair', 'Casey', 'Dana'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookies.clear();
    cookies.set('Alex', cookieHeader(setup));
    await signInAs('Blair', 'Blair', 2);
    await signInAs('Casey', 'Casey', 3);
    await signInAs('Dana', 'Dana', 4);
    // Alex has a second device, so one member can hold two subscriptions.
    await signInAs('Alex iPad', 'Alex', 1);
    for (const device of ['Alex', 'Alex iPad', 'Blair', 'Casey', 'Dana'])
      await subscribe(device);
  });

  afterEach(async () => {
    await notifier.close();
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  describe('events and recipients', () => {
    it('tells every active member when the schedule opens a check-in', async () => {
      expect(
        (
          await request('Alex', 'PATCH', '/api/settings', {
            cadence: { kind: 'monthly', day: 5, time: '09:00' },
          })
        ).statusCode,
      ).toBe(200);
      // Dana is no longer active, so she is not told.
      await request('Alex', 'PATCH', '/api/members/4', { active: false });

      // 09:00 in Berlin is 08:00 UTC in December.
      now = Date.parse('2026-12-05T08:00:00Z');
      await createJobRunner({
        database,
        clock,
        jobs: [createCheckinScheduleJob({ database, clock, events })],
      }).tick();
      await notifier.idle();

      expect(endpointsSent()).toEqual(
        ['Alex', 'Alex iPad', 'Blair', 'Casey'].map(endpointOf).sort(),
      );
      expect(sender.sent[0]!.content).toEqual({
        title: 'Time for a check-in',
        body: 'It’s open now. Add your balances when you have a minute.',
        url: '/check-ins/1',
        tag: 'checkin-1-opened',
      });
    });

    it('tells every other active member, by name, when a member starts one', async () => {
      await request('Alex', 'PATCH', '/api/members/4', { active: false });
      expect((await startCheckin('Alex')).statusCode).toBe(201);
      await notifier.idle();

      expect(endpointsSent()).toEqual(
        ['Blair', 'Casey'].map(endpointOf).sort(),
      );
      expect(sender.sent.map((push) => push.content.title)).toEqual([
        'Alex started a check-in',
        'Alex started a check-in',
      ]);
      expect(sender.sent[0]!.content.url).toBe('/check-ins/1');
    });

    it('does not announce joining a check-in that is already open', async () => {
      await startCheckin('Alex');
      await notifier.idle();
      sender.sent.length = 0;

      expect((await startCheckin('Blair')).statusCode).toBe(200);
      await notifier.idle();
      expect(sender.sent).toEqual([]);
    });

    it('tells every active member, the closer too, when it closes', async () => {
      await startCheckin('Alex');
      await notifier.idle();
      sender.sent.length = 0;
      await request('Alex', 'PATCH', '/api/members/4', { active: false });

      expect((await closeCheckin('Blair', 1)).statusCode).toBe(200);
      await notifier.idle();

      expect(endpointsSent()).toEqual(
        ['Alex', 'Alex iPad', 'Blair', 'Casey'].map(endpointOf).sort(),
      );
      expect(sender.sent[0]!.content).toEqual({
        title: 'Blair closed the check-in',
        body: 'The summary is ready.',
        url: '/check-ins/1',
        tag: 'checkin-1-closed',
      });
      // A second close changes nothing and tells nobody again.
      sender.sent.length = 0;
      await closeCheckin('Casey', 1);
      await notifier.idle();
      expect(sender.sent).toEqual([]);
    });

    it('names no one when the check-in closed by itself', async () => {
      await startCheckin('Alex');
      await notifier.idle();
      sender.sent.length = 0;
      await notifier.notify({
        kind: 'checkin.closed',
        checkinId: 1,
        closedBy: null,
      });
      expect(sender.sent[0]!.content.title).toBe('Check-in complete');
    });
  });

  describe('once per member', () => {
    it('records each member once and never sends the same event twice', async () => {
      await startCheckin('Alex');
      await notifier.idle();
      expect(sender.sent).toHaveLength(3);
      const rows = database
        .prepare(
          'SELECT event, checkin_id, member_id, slot FROM notification ORDER BY member_id',
        )
        .all();
      expect(rows).toEqual([
        { event: 'checkin.opened', checkin_id: 1n, member_id: 2n, slot: '' },
        { event: 'checkin.opened', checkin_id: 1n, member_id: 3n, slot: '' },
        { event: 'checkin.opened', checkin_id: 1n, member_id: 4n, slot: '' },
      ]);

      await notifier.notify({
        kind: 'checkin.opened',
        checkinId: 1,
        openedBy: 1,
      });
      expect(sender.sent).toHaveLength(3);
    });

    it('still sends once after a restart', async () => {
      await startCheckin('Alex');
      await notifier.idle();
      sender.sent.length = 0;

      // A new process: a fresh bus and notifier over the same database.
      await notifier.close();
      const restartedEvents = createCheckinEventBus();
      notifier = createNotifier({
        database,
        sender,
        clock,
        events: restartedEvents,
      });
      restartedEvents.emit('checkin.opened', {
        checkinId: 1,
        openedAt: now,
        openedBy: 1,
        scheduleSlot: null,
      });
      await notifier.idle();
      expect(sender.sent).toEqual([]);
    });

    it('sends to a member once even when the event fires twice at the same time', async () => {
      await startCheckin('Alex');
      await notifier.idle();
      sender.sent.length = 0;
      const close = {
        kind: 'checkin.closed',
        checkinId: 1,
        closedBy: 1,
      } as const;
      await Promise.all([notifier.notify(close), notifier.notify(close)]);
      expect(endpointsSent()).toEqual(
        ['Alex', 'Alex iPad', 'Blair', 'Casey', 'Dana'].map(endpointOf).sort(),
      );
    });

    it('works without any subscription (NTF-3)', async () => {
      database.prepare('DELETE FROM push_subscription').run();
      expect((await startCheckin('Alex')).statusCode).toBe(201);
      await notifier.idle();
      expect(sender.sent).toEqual([]);
      expect(
        database.prepare('SELECT COUNT(*) AS n FROM notification').get(),
      ).toEqual({ n: 0n });
      expect((await closeCheckin('Blair', 1)).statusCode).toBe(200);
    });
  });

  describe('subscriptions the push service answers for', () => {
    it.each([404, 410])(
      'removes a subscription answering %i',
      async (statusCode) => {
        sender.answerWith(endpointOf('Blair'), { ok: false, statusCode });
        await startCheckin('Alex');
        await notifier.idle();
        const left = database
          .prepare('SELECT endpoint FROM push_subscription ORDER BY id')
          .all() as Array<{ endpoint: string }>;
        expect(left.map(({ endpoint }) => endpoint)).toEqual(
          ['Alex', 'Alex iPad', 'Casey', 'Dana'].map(endpointOf),
        );
      },
    );

    it('keeps a subscription after other failures and counts them', async () => {
      sender.answerWith(endpointOf('Blair'), { ok: false, statusCode: 503 });
      sender.answerWith(endpointOf('Casey'), {
        ok: false,
        statusCode: undefined,
      });
      await startCheckin('Alex');
      await notifier.idle();
      const row = (device: string) =>
        database
          .prepare(
            'SELECT failures, last_success_at FROM push_subscription WHERE endpoint = ?',
          )
          .get(endpointOf(device));
      expect(row('Blair')).toEqual({ failures: 1n, last_success_at: null });
      expect(row('Casey')).toEqual({ failures: 1n, last_success_at: null });
    });

    it('records the time of a delivery and clears earlier failures', async () => {
      database
        .prepare('UPDATE push_subscription SET failures = 2 WHERE endpoint = ?')
        .run(endpointOf('Blair'));
      await startCheckin('Alex');
      await notifier.idle();
      expect(
        database
          .prepare(
            'SELECT failures, last_success_at FROM push_subscription WHERE endpoint = ?',
          )
          .get(endpointOf('Blair')),
      ).toEqual({ failures: 0n, last_success_at: BigInt(now) });
    });
  });

  describe('texts carry no amounts (NTF-4)', () => {
    const symbols = /[$€£¥₽₿Ξ₹₩₺₴₪₫฿₱]/u;
    const isoCodes = new RegExp(
      `\\b(${ISO_4217_CODES.join('|')}|BTC|ETH|USDT)\\b`,
      'u',
    );
    const decimalNumber = /\d[.,]\d/u;
    // Anything that reads as a figure: a run of digits with a separator.
    const groupedNumber = /\d[\s,.'’]\d{3}\b/u;

    it('holds for every event and every text, whatever the family holds', async () => {
      // Real balances, so a text built from them would show up.
      const account = await request('Alex', 'POST', '/api/accounts', {
        name: 'Main',
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '123456',
      });
      expect(account.statusCode, account.body).toBe(201);
      await request('Blair', 'POST', '/api/accounts', {
        name: 'Cash',
        ownerMemberId: 2,
        type: 'cash',
        currency: 'EUR',
        openingBalance: '99900',
      });

      await startCheckin('Alex');
      const saved = await request('Alex', 'PUT', '/api/checkins/1/values/1', {
        amount: '654321',
      });
      expect(saved.statusCode, saved.body).toBe(200);
      // Blair's account has no value yet, so the round is still open and
      // she gets a follow-up reminder.
      await notifier.notify({
        kind: 'checkin.followup',
        checkinId: 1,
        slot: '2026-11-12T13:00',
      });
      expect((await closeCheckin('Blair', 1)).statusCode).toBe(200);
      await notifier.idle();
      // Later rounds, closed already, to announce the other texts.
      for (let id = 2; id <= 4; id += 1)
        database
          .prepare('INSERT INTO checkin (opened_at, closed_at) VALUES (?, ?)')
          .run(now, now);
      await notifier.notify({
        kind: 'checkin.opened',
        checkinId: 2,
        openedBy: null,
      });
      await notifier.notify({
        kind: 'checkin.closed',
        checkinId: 3,
        closedBy: null,
      });
      await notifier.notify({
        kind: 'checkin.closed',
        checkinId: 4,
        closedBy: 3,
      });

      const titles = new Set(sender.sent.map((push) => push.content.title));
      expect(titles).toEqual(
        new Set([
          'Alex started a check-in',
          'Blair closed the check-in',
          'Time for a check-in',
          'Check-in complete',
          'Casey closed the check-in',
          'Your check-in is waiting',
        ]),
      );
      for (const push of sender.sent) {
        // The whole payload, as the device receives it, not only the title.
        for (const [name, pattern] of Object.entries({
          symbols,
          isoCodes,
          decimalNumber,
          groupedNumber,
        }))
          expect(push.payload, `${name} in ${push.payload}`).not.toMatch(
            pattern,
          );
        expect(Object.keys(push.content).sort()).toEqual([
          'body',
          'tag',
          'title',
          'url',
        ]);
        expect(push.payload).not.toMatch(/123456|654321/u);
      }
    });
  });

  describe('opt-in routes', () => {
    it('hands out the public key and nothing secret', async () => {
      const response = await request('Alex', 'GET', '/api/push/key');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ publicKey: 'test-public-key' });
    });

    it('needs a signed-in profile', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/push/subscription',
        headers: jsonHeaders,
        payload: {
          endpoint: endpointOf('x'),
          keys: { p256dh: 'a', auth: 'b' },
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('keeps one row per endpoint and takes it over for the device that sends it again', async () => {
      expect(subscriptionCount()).toBe(5n);
      await subscribe('Alex');
      await subscribe('Alex');
      expect(subscriptionCount()).toBe(5n);
      expect(
        database
          .prepare('SELECT member_id FROM push_subscription WHERE endpoint = ?')
          .get(endpointOf('Alex')),
      ).toEqual({ member_id: 1n });
    });

    it('refuses a push service that is not on the allowed list (SEC-8)', async () => {
      for (const endpoint of [
        'https://internal.tailnet.test/hook',
        'https://push.example.test.evil.test/x',
        'https://push.example.test:8443/x',
        'https://user:secret@push.example.test/x',
        'https://127.0.0.1/x',
      ]) {
        const response = await request(
          'Alex',
          'PUT',
          '/api/push/subscription',
          { endpoint, keys: { p256dh: 'a', auth: 'b' } },
        );
        expect(response.statusCode, endpoint).toBe(400);
        expect(response.json().error.fields.endpoint, endpoint).toBe(
          'This push service is not allowed.',
        );
      }
      expect(subscriptionCount()).toBe(5n);
    });

    it('keeps one subscription per device: a new endpoint replaces the old one', async () => {
      const response = await request('Alex', 'PUT', '/api/push/subscription', {
        endpoint: endpointOf('Alex-renewed'),
        keys: { p256dh: 'new', auth: 'new' },
      });
      expect(response.statusCode).toBe(200);
      const alex = database
        .prepare(
          'SELECT endpoint FROM push_subscription WHERE member_id = 1 ORDER BY id',
        )
        .all() as Array<{ endpoint: string }>;
      // The iPad's own subscription is untouched.
      expect(alex.map(({ endpoint }) => endpoint).sort()).toEqual(
        [endpointOf('Alex iPad'), endpointOf('Alex-renewed')].sort(),
      );
    });

    it('rejects an address that is not https and a body with no keys', async () => {
      for (const payload of [
        {
          endpoint: 'http://push.example.test/x',
          keys: { p256dh: 'a', auth: 'b' },
        },
        { endpoint: endpointOf('x') },
        { endpoint: endpointOf('x'), keys: { p256dh: '', auth: 'b' } },
        {},
      ]) {
        const response = await request(
          'Alex',
          'PUT',
          '/api/push/subscription',
          payload,
        );
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      }
      expect(subscriptionCount()).toBe(5n);
    });

    it('removes only this device’s subscription on opt-out', async () => {
      const response = await request(
        'Alex',
        'DELETE',
        '/api/push/subscription',
        {},
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ subscribed: false });
      const left = database
        .prepare('SELECT endpoint FROM push_subscription ORDER BY id')
        .all() as Array<{ endpoint: string }>;
      expect(left.map(({ endpoint }) => endpoint)).toEqual(
        ['Alex iPad', 'Blair', 'Casey', 'Dana'].map(endpointOf),
      );
    });

    it('moves a device’s subscription to the profile it opens as', async () => {
      const response = await request('Blair', 'POST', '/api/auth/profile', {
        memberId: 3,
        remember: false,
      });
      expect(response.statusCode).toBe(200);
      await startCheckin('Alex');
      await notifier.idle();
      // Blair's phone is now Casey's: Casey is told once on it, Blair's phone
      // is not told twice.
      expect(
        sender.sent.filter((push) => push.endpoint === endpointOf('Blair')),
      ).toHaveLength(1);
      expect(
        database
          .prepare('SELECT member_id FROM push_subscription WHERE endpoint = ?')
          .get(endpointOf('Blair')),
      ).toEqual({ member_id: 3n });
    });
  });
});

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? header : [header])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
