import type Database from 'better-sqlite3';
import type { Clock } from '../clock.js';
import type { CheckinEventBus } from '../events.js';
import type { PushSender, PushTarget } from '../modules/push/sender.js';
import { planNotification } from './plan.js';
import type { NotificationEvent } from './types.js';

/** Push services answer these when a subscription no longer exists. */
const goneStatusCodes = new Set([404, 410]);

/** Delivers notifications for check-in events to the members' devices. */
export interface Notifier {
  /** Announces one event; resolves when every delivery attempt is over. */
  notify(event: NotificationEvent): Promise<void>;
  /** Resolves when the announcements started so far are over. */
  idle(): Promise<void>;
  /** Stops listening to the event bus and waits for what is in flight. */
  close(): Promise<void>;
}

/**
 * Turns check-in events into push notifications. For each recipient with a
 * device it first records the pair in `notification`, which refuses a second
 * row for the same event, check-in, member and slot, and only then sends. A
 * crash after the record can lose a notification but never repeats one, also
 * after a restart. Members with no device get no row. A subscription the push
 * service no longer knows (404, 410) is deleted; any other failure is counted.
 */
export function createNotifier(options: {
  database: Database.Database;
  sender: PushSender;
  clock: Clock;
  events: CheckinEventBus;
}): Notifier {
  const { database, sender, clock, events } = options;
  const inFlight = new Set<Promise<void>>();

  const claim = database.prepare(
    `INSERT OR IGNORE INTO notification
       (event, checkin_id, member_id, slot, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const subscriptionsOf = database.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscription
     WHERE member_id = ? ORDER BY id`,
  );
  const markDelivered = database.prepare(
    'UPDATE push_subscription SET last_success_at = ?, failures = 0 WHERE id = ?',
  );
  const markFailed = database.prepare(
    'UPDATE push_subscription SET failures = failures + 1 WHERE id = ?',
  );
  const forget = database.prepare('DELETE FROM push_subscription WHERE id = ?');

  async function notify(event: NotificationEvent): Promise<void> {
    const plan = planNotification(database, event);
    const payload = JSON.stringify(plan.content);
    const deliveries: Array<Promise<void>> = [];
    for (const memberId of plan.recipients) {
      const subscriptions = subscriptionsOf.all(memberId) as Array<
        PushTarget & { id: bigint }
      >;
      if (subscriptions.length === 0) continue;
      const now = clock.now().getTime();
      const claimed = claim.run(
        plan.event,
        plan.checkinId,
        memberId,
        plan.slot,
        now,
      );
      if (claimed.changes === 0) continue;
      for (const subscription of subscriptions) {
        deliveries.push(deliver(subscription, payload));
      }
    }
    await Promise.all(deliveries);
  }

  async function deliver(
    subscription: PushTarget & { id: bigint },
    payload: string,
  ): Promise<void> {
    const result = await sender.send(subscription, payload);
    if (result.ok) {
      markDelivered.run(clock.now().getTime(), subscription.id);
    } else if (
      result.statusCode !== undefined &&
      goneStatusCodes.has(result.statusCode)
    ) {
      forget.run(subscription.id);
    } else {
      markFailed.run(subscription.id);
    }
  }

  const track = (work: Promise<void>): Promise<void> => {
    const tracked = work.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
    return tracked;
  };
  const offOpened = events.on('checkin.opened', (event) =>
    track(
      notify({
        kind: 'checkin.opened',
        checkinId: event.checkinId,
        openedBy: event.openedBy,
      }),
    ),
  );
  const offClosed = events.on('checkin.closed', (event) =>
    track(
      notify({
        kind: 'checkin.closed',
        checkinId: event.checkinId,
        closedBy: event.closedBy,
      }),
    ),
  );

  const offFollowUp = events.on('checkin.followup', (event) =>
    track(
      notify({
        kind: 'checkin.followup',
        checkinId: event.checkinId,
        slot: event.slot,
      }),
    ),
  );

  const idle = async (): Promise<void> => {
    await Promise.allSettled([...inFlight]);
  };
  return {
    notify: (event) => track(notify(event)),
    idle,
    async close() {
      offOpened();
      offClosed();
      offFollowUp();
      await idle();
    },
  };
}
