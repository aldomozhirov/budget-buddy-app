import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createCheckinEventBus } from '../src/events.js';
import { createCheckinScheduleJob } from '../src/jobs/checkinSchedule.js';
import { createFollowUpJob } from '../src/jobs/followUp.js';
import { createJobRunner } from '../src/jobs/runner.js';
import { createNotifier, type Notifier } from '../src/notify/notifier.js';
import { createFakePushSender } from './fakePushSender.js';
import { turnOffReopenLock } from './reopenLock.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';
const endpointOf = (name: string) => `https://push.example.test/${name}`;

/**
 * Follow-up reminders (CHK-3, NTF-2) with a fake clock: Alex (1), Blair (2)
 * and Casey (3) each have a device; Alex owns "Main", Blair "Cash".
 */
describe('follow-up reminders', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let now: number;
  let events: ReturnType<typeof createCheckinEventBus>;
  let notifier: Notifier;
  let sender: ReturnType<typeof createFakePushSender>;
  const cookies = new Map<string, string>();
  const clock = { now: () => new Date(now) };
  const at = (iso: string) => {
    now = Date.parse(iso);
  };

  const request = (
    name: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { ...jsonHeaders, cookie: cookies.get(name)! },
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh runner and job, as after a server restart; runs one tick. */
  const tick = async () => {
    await createJobRunner({
      database,
      clock,
      jobs: [
        createCheckinScheduleJob({ database, clock, events }),
        createFollowUpJob({ database, events }),
      ],
    }).tick();
    await notifier.idle();
  };
  const reminded = () =>
    sender.sent
      .filter((push) => push.content.tag.endsWith('-followup'))
      .map((push) => push.endpoint)
      .sort();
  const alert = (names: string[]) => names.map(endpointOf).sort();
  const reminderRows = () =>
    database
      .prepare(
        `SELECT member_id, slot FROM notification
         WHERE event = 'checkin.followup' ORDER BY member_id, slot`,
      )
      .all();
  const setFollowupDays = async (days: number) => {
    const response = await request('Alex', 'PATCH', '/api/settings', {
      followupDays: days,
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const startCheckin = async () => {
    const response = await request('Alex', 'POST', '/api/checkins', {});
    expect(response.statusCode, response.body).toBe(201);
    await notifier.idle();
    sender.sent.length = 0;
    return response.json().checkin.id as number;
  };
  const enterValue = async (name: string, checkinId: number, account: number) =>
    request(name, 'PUT', `/api/checkins/${checkinId}/values/${account}`, {
      amount: '1000',
    });
  const nextReminderAt = async (checkinId: number) =>
    (await request('Alex', 'GET', `/api/checkins/${checkinId}`)).json().checkin
      .nextReminderAt;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-followup-'));
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    // 13:00 in Berlin.
    at('2026-11-10T12:00:00Z');
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
      push: { publicKey: 'test', allowedHosts: ['push.example.test'] },
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { ...jsonHeaders, 'user-agent': 'Alex/1.0' },
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair', 'Casey'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookies.set('Alex', cookieHeader(setup));
    for (const [name, id] of [
      ['Blair', 2],
      ['Casey', 3],
    ] as const) {
      const signedIn = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers: { ...jsonHeaders, 'user-agent': `${name}/1.0` },
        payload: { password },
      });
      cookies.set(name, cookieHeader(signedIn));
      const profile = await request(name, 'POST', '/api/auth/profile', {
        memberId: id,
        remember: false,
      });
      expect(profile.statusCode).toBe(200);
    }
    turnOffReopenLock(database);
    for (const name of ['Alex', 'Blair', 'Casey']) {
      const subscribed = await request(name, 'PUT', '/api/push/subscription', {
        endpoint: endpointOf(name),
        keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
      });
      expect(subscribed.statusCode, subscribed.body).toBe(200);
    }
    for (const [name, owner] of [
      ['Main', 1],
      ['Cash', 2],
    ] as const) {
      const account = await request('Alex', 'POST', '/api/accounts', {
        name,
        ownerMemberId: owner,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '10000',
      });
      expect(account.statusCode, account.body).toBe(201);
    }
  });

  afterEach(async () => {
    await notifier.close();
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  describe('who is reminded and when', () => {
    it('reminds each member with accounts left, every interval after it opened', async () => {
      await startCheckin();

      // The first reminder is 48 hours after 13:00 on the 10th, in Berlin.
      at('2026-11-12T11:59:00Z');
      await tick();
      expect(reminded()).toEqual([]);

      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      expect(sender.sent[0]!.content).toEqual({
        title: 'Your check-in is waiting',
        body: 'Some of your accounts still need a balance.',
        url: '/check-ins/1',
        tag: 'checkin-1-followup',
      });

      // Casey owns no account and Alex's second tick adds nothing.
      await tick();
      expect(reminded()).toHaveLength(2);

      at('2026-11-14T12:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(4);
      expect(reminderRows()).toEqual([
        { member_id: 1n, slot: '2026-11-12T13:00' },
        { member_id: 1n, slot: '2026-11-14T13:00' },
        { member_id: 2n, slot: '2026-11-12T13:00' },
        { member_id: 2n, slot: '2026-11-14T13:00' },
      ]);
    });

    it('reminds only members who still own accounts without a value', async () => {
      const id = await startCheckin();
      expect((await enterValue('Alex', id, 1)).statusCode).toBe(200);
      sender.sent.length = 0;

      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Blair']));
    });

    it('does not remind a member whose only account has no value but who is inactive', async () => {
      await startCheckin();
      await request('Alex', 'PATCH', '/api/members/2', { active: false });

      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex']));
    });

    it('does not remind about an account nobody owns or one that was closed', async () => {
      await startCheckin();
      database
        .prepare('UPDATE account SET owner_member_id = NULL WHERE id = 2')
        .run();
      database.prepare('UPDATE account SET active = 0 WHERE id = 1').run();
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toEqual([]);
    });

    it('reminds nobody once the check-in is closed', async () => {
      const id = await startCheckin();
      expect(
        (await request('Alex', 'POST', `/api/checkins/${id}/close`, {}))
          .statusCode,
      ).toBe(200);
      await notifier.idle();
      sender.sent.length = 0;

      at('2026-11-12T12:00:00Z');
      await tick();
      at('2026-11-20T12:00:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
    });

    it('sends nothing for a reminder announced after the check-in closed', async () => {
      const id = await startCheckin();
      await request('Alex', 'POST', `/api/checkins/${id}/close`, {});
      await notifier.idle();
      sender.sent.length = 0;
      await notifier.notify({
        kind: 'checkin.followup',
        checkinId: id,
        slot: '2026-11-12T13:00',
      });
      expect(sender.sent).toEqual([]);
    });

    it('stops reminding a member as soon as their last value is in', async () => {
      const id = await startCheckin();
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
      sender.sent.length = 0;

      at('2026-11-13T12:00:00Z');
      await enterValue('Blair', id, 2);
      at('2026-11-14T12:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex']));
    });

    it('sends none when the interval is 0', async () => {
      await setFollowupDays(0);
      await startCheckin();
      at('2026-11-12T12:00:00Z');
      await tick();
      at('2026-12-12T12:00:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
      expect(reminderRows()).toEqual([]);
    });

    it('follows the interval that was set', async () => {
      await setFollowupDays(1);
      await startCheckin();
      at('2026-11-11T12:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
    });

    it('counts from the cadence time of a scheduled check-in', async () => {
      await request('Alex', 'PATCH', '/api/settings', {
        cadence: { kind: 'monthly', day: 5, time: '09:00' },
      });
      // 09:00 in Berlin is 08:00 UTC in December.
      at('2026-12-05T08:00:20Z');
      await tick();
      expect(sender.sent.map((push) => push.content.tag)).toEqual([
        'checkin-1-opened',
        'checkin-1-opened',
        'checkin-1-opened',
      ]);
      sender.sent.length = 0;

      at('2026-12-07T07:59:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
      at('2026-12-07T08:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      expect(reminderRows()[0]).toEqual({
        member_id: 1n,
        slot: '2026-12-07T09:00',
      });
    });

    it('keeps the wall time across the end of daylight saving time', async () => {
      // 09:00 on 24 October in Berlin (CEST).
      at('2026-10-24T07:00:00Z');
      await setFollowupDays(1);
      await startCheckin();

      // 24 hours later is only 08:00 in Berlin now (CET).
      at('2026-10-25T07:00:00Z');
      await tick();
      expect(reminded()).toEqual([]);
      at('2026-10-25T08:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
      expect(reminderRows()[0]).toEqual({
        member_id: 1n,
        slot: '2026-10-25T09:00',
      });
    });

    it('does not remind at once about a check-in the schedule made up late', async () => {
      await request('Alex', 'PATCH', '/api/settings', {
        cadence: { kind: 'monthly', day: 5, time: '09:00' },
      });
      // The server was off from before the slot until the 8th.
      at('2026-12-08T10:00:00Z');
      database
        .prepare('DELETE FROM job_run WHERE job = ?')
        .run('checkin-followup');
      await tick();
      expect(
        sender.sent.filter((push) => push.content.tag.endsWith('-opened')),
      ).toHaveLength(3);
      expect(reminded()).toEqual([]);

      // The slot was the 5th; its second reminder, the 9th, is the next one.
      at('2026-12-09T08:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
    });
  });

  describe('restarts and repeats (COR-3)', () => {
    it('sends one reminder, not several, after a restart that missed three', async () => {
      await startCheckin();
      // Off across the reminders of the 12th, 14th and 16th.
      at('2026-11-16T18:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      expect(reminderRows()).toEqual([
        { member_id: 1n, slot: '2026-11-16T13:00' },
        { member_id: 2n, slot: '2026-11-16T13:00' },
      ]);

      // Another restart in the same interval adds nothing.
      await tick();
      expect(reminded()).toHaveLength(2);
    });

    it('never sends the same reminder to a member twice', async () => {
      const id = await startCheckin();
      const event = {
        kind: 'checkin.followup',
        checkinId: id,
        slot: '2026-11-12T13:00',
      } as const;
      await Promise.all([notifier.notify(event), notifier.notify(event)]);
      await notifier.notify(event);
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
    });

    it('does not repeat a reminder that a failed run is retried for', async () => {
      await startCheckin();
      const job = createFollowUpJob({ database, events });
      let attempts = 0;
      const flaky = {
        ...job,
        run(slot: string) {
          job.run(slot);
          attempts += 1;
          if (attempts === 1) throw new Error('crashed after announcing');
        },
      };
      const runner = createJobRunner({ database, clock, jobs: [flaky] });
      at('2026-11-12T12:00:00Z');
      await runner.tick();
      await notifier.idle();
      await runner.tick();
      await notifier.idle();
      expect(attempts).toBe(2);
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
    });
  });

  describe('changing the interval', () => {
    it('does not send a reminder for a time already past', async () => {
      await startCheckin();
      // Day 3, 13:00 in Berlin: the first reminder of "every 2 days" is sent.
      at('2026-11-12T12:00:00Z');
      await tick();
      sender.sent.length = 0;

      // Switching to every day would owe the 13th at 13:00, and it is later.
      at('2026-11-13T15:00:00Z');
      await setFollowupDays(1);
      await tick();
      expect(sender.sent).toEqual([]);

      at('2026-11-14T12:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
    });

    it('starts counting again when reminders are turned back on', async () => {
      await setFollowupDays(0);
      await startCheckin();
      at('2026-11-20T10:00:00Z');
      await setFollowupDays(2);
      await tick();
      expect(sender.sent).toEqual([]);
      at('2026-11-20T12:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
    });

    it('rejects an interval that is negative, fractional or too long', async () => {
      for (const followupDays of [-1, 1.5, 31, '2']) {
        const response = await request('Alex', 'PATCH', '/api/settings', {
          followupDays,
        });
        expect(response.statusCode, String(followupDays)).toBe(400);
      }
      const read = await request('Alex', 'GET', '/api/settings');
      expect(read.json().followupDays).toBe(2);
    });
  });

  describe('the date shown in the check-in footer', () => {
    it('is the next reminder, and moves after one is sent', async () => {
      const id = await startCheckin();
      expect(await nextReminderAt(id)).toBe(Date.parse('2026-11-12T12:00:00Z'));
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(await nextReminderAt(id)).toBe(Date.parse('2026-11-14T12:00:00Z'));
    });

    it('is null when reminders are off, when the check-in is closed, or when nobody is left to remind', async () => {
      const id = await startCheckin();
      await enterValue('Alex', id, 1);
      expect(await nextReminderAt(id)).toBe(Date.parse('2026-11-12T12:00:00Z'));
      await setFollowupDays(0);
      expect(await nextReminderAt(id)).toBeNull();
      await setFollowupDays(2);
      expect(await nextReminderAt(id)).not.toBeNull();
      await request('Alex', 'PATCH', '/api/members/2', { active: false });
      expect(await nextReminderAt(id)).toBeNull();
      await request('Alex', 'PATCH', '/api/members/2', { active: true });
      await request('Alex', 'POST', `/api/checkins/${id}/close`, {});
      expect(await nextReminderAt(id)).toBeNull();
    });
  });

  /**
   * CHK-2: a schedule slot that finds a check-in open opens nothing and
   * reminds, with the follow-up text, the members a follow-up would remind.
   */
  describe('a schedule slot that finds a check-in open (CHK-2)', () => {
    // Tuesdays at 09:00 Berlin (08:00 UTC in winter); today is Tuesday the
    // 10th at 13:00, so the first slot is the 17th.
    const weekly = { kind: 'weeks', every: 1, weekday: 2, time: '09:00' };
    const slotReminders = () =>
      database
        .prepare(
          `SELECT member_id, slot FROM notification
           WHERE event = 'checkin.followup' ORDER BY member_id, slot`,
        )
        .all();
    const checkinCount = () =>
      (
        database.prepare('SELECT COUNT(*) AS n FROM checkin').get() as {
          n: bigint;
        }
      ).n;
    const schedule = async (followupDays = 0) => {
      await setFollowupDays(followupDays);
      const saved = await request('Alex', 'PATCH', '/api/settings', {
        cadence: weekly,
      });
      expect(saved.statusCode, saved.body).toBe(200);
    };

    it('opens nothing and reminds the members with accounts left', async () => {
      await schedule();
      await startCheckin();

      at('2026-11-17T08:00:00Z');
      await tick();

      expect(checkinCount()).toBe(1n);
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      // The existing reminder text; amounts never appear (NTF-4).
      expect(sender.sent[0]!.content).toEqual({
        title: 'Your check-in is waiting',
        body: 'Some of your accounts still need a balance.',
        url: '/check-ins/1',
        tag: 'checkin-1-followup',
      });
      expect(slotReminders()).toEqual([
        { member_id: 1n, slot: '2026-11-17T09:00' },
        { member_id: 2n, slot: '2026-11-17T09:00' },
      ]);
      expect(
        database
          .prepare("SELECT status FROM job_run WHERE slot = '2026-11-17T09:00'")
          .get(),
      ).toEqual({ status: 'done' });
    });

    it('does not depend on the follow-up interval', async () => {
      await schedule(0);
      await startCheckin();
      at('2026-11-17T08:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(2);
    });

    it('skips members with no accounts left, inactive members and members without a device', async () => {
      await schedule();
      const id = await startCheckin();
      await enterValue('Alex', id, 1);
      sender.sent.length = 0;
      at('2026-11-17T08:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Blair']));

      // Same slot for nobody else: Blair inactive, Alex has his value in.
      sender.sent.length = 0;
      database.prepare('DELETE FROM notification').run();
      database
        .prepare("DELETE FROM job_run WHERE slot = '2026-11-17T09:00'")
        .run();
      await request('Alex', 'PATCH', '/api/members/2', { active: false });
      await tick();
      expect(sender.sent).toEqual([]);

      // Alex's value stays; Blair is back but has no device.
      await request('Alex', 'PATCH', '/api/members/2', { active: true });
      database
        .prepare('DELETE FROM push_subscription WHERE member_id = 2')
        .run();
      database
        .prepare("DELETE FROM job_run WHERE slot = '2026-11-17T09:00'")
        .run();
      await tick();
      expect(sender.sent).toEqual([]);
      expect(slotReminders()).toEqual([]);
    });

    it('sends nothing when notifications are off for everyone', async () => {
      await schedule();
      await startCheckin();
      database.prepare('DELETE FROM push_subscription').run();
      at('2026-11-17T08:00:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
      expect(slotReminders()).toEqual([]);
      expect(checkinCount()).toBe(1n);
    });

    it('sends one reminder, not several, after a restart that missed three slots', async () => {
      await schedule();
      await startCheckin();
      // Off across Tuesdays 17 and 24 November and 1 December.
      at('2026-12-01T18:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      expect(slotReminders()).toEqual([
        { member_id: 1n, slot: '2026-12-01T09:00' },
        { member_id: 2n, slot: '2026-12-01T09:00' },
      ]);
      await tick();
      expect(reminded()).toHaveLength(2);

      // The next slot is a new reminder.
      at('2026-12-08T08:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(4);
    });

    it('sends once to a member for a slot when the run is retried', async () => {
      await schedule();
      await startCheckin();
      const job = createCheckinScheduleJob({ database, clock, events });
      let attempts = 0;
      const flaky = {
        ...job,
        run(slot: string) {
          job.run(slot);
          attempts += 1;
          if (attempts === 1) throw new Error('crashed after announcing');
        },
      };
      const runner = createJobRunner({ database, clock, jobs: [flaky] });
      at('2026-11-17T08:00:00Z');
      await runner.tick();
      await notifier.idle();
      await runner.tick();
      await notifier.idle();
      expect(attempts).toBe(2);
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      expect(slotReminders()).toHaveLength(2);
    });

    it('sends no reminder when a retried slot finds the check-in it opened itself', async () => {
      await schedule();
      const job = createCheckinScheduleJob({ database, clock, events });
      let attempts = 0;
      const flaky = {
        ...job,
        run(slot: string) {
          job.run(slot);
          attempts += 1;
          if (attempts === 1) throw new Error('crashed after opening');
        },
      };
      const runner = createJobRunner({ database, clock, jobs: [flaky] });
      at('2026-11-17T08:00:00Z');
      await runner.tick();
      await notifier.idle();
      await runner.tick();
      await notifier.idle();
      expect(attempts).toBe(2);
      expect(checkinCount()).toBe(1n);
      expect(sender.sent.map((push) => push.content.tag)).toEqual([
        'checkin-1-opened',
        'checkin-1-opened',
        'checkin-1-opened',
      ]);
      expect(slotReminders()).toEqual([]);
    });

    it('sends no reminder and opens a check-in when none is open', async () => {
      await schedule();
      at('2026-11-17T08:00:00Z');
      await tick();
      expect(checkinCount()).toBe(1n);
      expect(reminded()).toEqual([]);
    });

    it.each([
      ['the slot job first', 'slot-first'],
      ['the follow-up job first', 'followup-first'],
    ] as const)(
      'gives a member one push when a follow-up and a slot reminder fall in the same minute (%s)',
      async (_name, order) => {
        // Weekly slots and a 7-day follow-up meet every Tuesday at 09:00.
        await schedule(7);
        const runner = () => {
          const slotJob = createCheckinScheduleJob({ database, clock, events });
          const followUpJob = createFollowUpJob({ database, events });
          return createJobRunner({
            database,
            clock,
            jobs:
              order === 'slot-first'
                ? [slotJob, followUpJob]
                : [followUpJob, slotJob],
          });
        };
        // The 17th's slot opens the check-in and tells everyone.
        at('2026-11-17T08:00:00Z');
        await runner().tick();
        await notifier.idle();
        sender.sent.length = 0;

        at('2026-11-24T08:00:00Z');
        await runner().tick();
        await notifier.idle();
        expect(reminded()).toEqual(alert(['Alex', 'Blair']));
        expect(slotReminders()).toEqual([
          { member_id: 1n, slot: '2026-11-24T09:00' },
          { member_id: 2n, slot: '2026-11-24T09:00' },
        ]);
      },
    );

    it('gives a member two pushes when the two reminders fall in different minutes', async () => {
      // Opened by hand at 13:00 on the 10th: follow-ups at 13:00 on Tuesdays.
      await schedule(7);
      await startCheckin();
      at('2026-11-17T08:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex', 'Blair']));
      at('2026-11-17T12:00:00Z');
      await tick();
      expect(reminded()).toHaveLength(4);
      expect(slotReminders()).toEqual([
        { member_id: 1n, slot: '2026-11-17T09:00' },
        { member_id: 1n, slot: '2026-11-17T13:00' },
        { member_id: 2n, slot: '2026-11-17T09:00' },
        { member_id: 2n, slot: '2026-11-17T13:00' },
      ]);
    });
  });

  /**
   * Owner's decision, 2026-10-13: once every account has a value only "Close
   * now" is left, so the follow-up and the slot ask every active member to
   * close the check-in, with a text of their own.
   */
  describe('a check-in with a value for every account', () => {
    const closeText = {
      title: 'Ready to close',
      body: 'All amounts are in. Close the check-in.',
      url: '/check-ins/1',
      tag: 'checkin-1-followup',
    };
    const waitingText = {
      title: 'Your check-in is waiting',
      body: 'Some of your accounts still need a balance.',
      url: '/check-ins/1',
      tag: 'checkin-1-followup',
    };
    const weekly = { kind: 'weeks', every: 1, weekday: 2, time: '09:00' };
    const texts = () => sender.sent.map((push) => push.content);
    const completeCheckin = async () => {
      const id = await startCheckin();
      await enterValue('Alex', id, 1);
      await enterValue('Blair', id, 2);
      return id;
    };
    const followUpRows = () =>
      database
        .prepare(
          `SELECT member_id, slot FROM notification
           WHERE event = 'checkin.followup' ORDER BY member_id, slot`,
        )
        .all();

    it('is reminded by the follow-up: every active member, with the close text, once', async () => {
      await completeCheckin();
      at('2026-11-12T12:00:00Z');
      await tick();

      // Casey owns no account and is reminded too.
      expect(sender.sent.map((push) => push.endpoint).sort()).toEqual(
        alert(['Alex', 'Blair', 'Casey']),
      );
      expect(new Set(texts().map((text) => JSON.stringify(text)))).toEqual(
        new Set([JSON.stringify(closeText)]),
      );
      expect(followUpRows()).toEqual([
        { member_id: 1n, slot: '2026-11-12T13:00' },
        { member_id: 2n, slot: '2026-11-12T13:00' },
        { member_id: 3n, slot: '2026-11-12T13:00' },
      ]);

      // The same occasion again, as after a restart, sends nothing more.
      database
        .prepare("DELETE FROM job_run WHERE slot = '2026-11-12T13:00'")
        .run();
      await tick();
      expect(sender.sent).toHaveLength(3);

      // The next follow-up is a new occasion.
      at('2026-11-14T12:00:00Z');
      await tick();
      expect(sender.sent).toHaveLength(6);
    });

    it('is reminded by a schedule slot, also with follow-ups off', async () => {
      await setFollowupDays(0);
      const saved = await request('Alex', 'PATCH', '/api/settings', {
        cadence: weekly,
      });
      expect(saved.statusCode, saved.body).toBe(200);
      await completeCheckin();

      at('2026-11-17T08:00:00Z');
      await tick();
      expect(sender.sent.map((push) => push.endpoint).sort()).toEqual(
        alert(['Alex', 'Blair', 'Casey']),
      );
      expect(texts().every((text) => text.body === closeText.body)).toBe(true);
      expect(followUpRows()).toHaveLength(3);
      expect(
        database.prepare('SELECT COUNT(*) AS n FROM checkin').get(),
      ).toEqual({ n: 1n });

      database
        .prepare("DELETE FROM job_run WHERE slot = '2026-11-17T09:00'")
        .run();
      await tick();
      expect(sender.sent).toHaveLength(3);
    });

    it('gives one push when the slot and a follow-up fall in the same minute', async () => {
      // Weekly Tuesday 09:00 slots; a check-in opened by the schedule counts
      // its 7-day follow-ups from the same time.
      await setFollowupDays(7);
      await request('Alex', 'PATCH', '/api/settings', { cadence: weekly });
      at('2026-11-17T08:00:00Z');
      await tick();
      await notifier.idle();
      sender.sent.length = 0;
      database.prepare('DELETE FROM notification').run();
      await enterValue('Alex', 1, 1);
      await enterValue('Blair', 1, 2);

      at('2026-11-24T08:00:00Z');
      await tick();
      expect(sender.sent).toHaveLength(3);
      expect(new Set(texts().map((text) => text.body))).toEqual(
        new Set([closeText.body]),
      );
    });

    it('sends nothing when follow-ups are off and no slot is due', async () => {
      await completeCheckin();
      await setFollowupDays(0);
      at('2026-11-20T12:00:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
    });

    it('reminds nobody once it is closed', async () => {
      const id = await completeCheckin();
      await request('Alex', 'POST', `/api/checkins/${id}/close`, {});
      await notifier.idle();
      sender.sent.length = 0;
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
    });

    it('goes back to the waiting reminder when an account is added', async () => {
      await completeCheckin();
      const added = await request('Alex', 'POST', '/api/accounts', {
        name: 'Savings',
        ownerMemberId: 2,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '500',
      });
      expect(added.statusCode, added.body).toBe(201);
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Blair']));
      expect(texts()).toEqual([waitingText]);
    });

    it('goes back to the waiting reminder when an amount is cleared', async () => {
      const id = await completeCheckin();
      database
        .prepare('DELETE FROM snapshot WHERE checkin_id = ? AND account_id = 1')
        .run(id);
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(reminded()).toEqual(alert(['Alex']));
      expect(texts()).toEqual([waitingText]);
    });

    it('keeps the waiting text for members with accounts left and sends no close text', async () => {
      const id = await startCheckin();
      await enterValue('Alex', id, 1);
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(texts()).toEqual([waitingText]);
      expect(reminded()).toEqual(alert(['Blair']));
    });

    it('sends no close reminder when there are no active accounts', async () => {
      const id = await startCheckin();
      database.prepare('UPDATE account SET active = 0').run();
      expect(id).toBe(1);
      at('2026-11-12T12:00:00Z');
      await tick();
      expect(sender.sent).toEqual([]);
      expect(followUpRows()).toEqual([]);
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
