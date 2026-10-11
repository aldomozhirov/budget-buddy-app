import type { PushContent } from './types.js';

/** In-app path of a check-in: its form while open, its summary once closed. */
export function checkinPath(checkinId: number): string {
  return `/check-ins/${checkinId}`;
}

/**
 * The texts of the push notifications. They state what happened and never
 * an amount, a currency or a figure (NTF-4); `push-notifications.test.ts` checks that.
 * Member names come from the family and are the only free text.
 */
export const notificationText = {
  /** The schedule opened a check-in. */
  scheduled(checkinId: number): PushContent {
    return {
      title: 'Time for a check-in',
      body: 'It’s open now. Add your balances when you have a minute.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-opened`,
    };
  },
  /** A member started a check-in by hand; `starter` is their name. */
  startedBy(checkinId: number, starter: string): PushContent {
    return {
      title: `${starter} started a check-in`,
      body: 'Add your balances when you have a minute.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-opened`,
    };
  },
  /** An open check-in still has accounts without a value (CHK-3). */
  followUp(checkinId: number): PushContent {
    return {
      title: 'Your check-in is waiting',
      body: 'Some of your accounts still need a balance.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-followup`,
    };
  },
  /** The check-in closed; `closer` is null when it closed by itself. */
  closed(checkinId: number, closer: string | null): PushContent {
    return {
      title: closer ? `${closer} closed the check-in` : 'Check-in complete',
      body: 'The summary is ready.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-closed`,
    };
  },
};
