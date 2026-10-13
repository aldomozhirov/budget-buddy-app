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
  /**
   * An open check-in still has accounts without a value: the follow-up
   * (CHK-3) and the schedule slot that finds it open (CHK-2) read the same.
   */
  followUp(checkinId: number): PushContent {
    return {
      title: 'Your check-in is waiting',
      body: 'Some of your accounts still need a balance.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-followup`,
    };
  },
  /**
   * An open check-in has a value for every account, so only closing is
   * left: the follow-up (CHK-3) and the schedule slot that finds it open
   * (CHK-2) send it to every active member instead of the text above. It
   * shares that text's tag, so it replaces a waiting reminder on the device.
   */
  closeReminder(checkinId: number): PushContent {
    return {
      title: 'Ready to close',
      body: 'All amounts are in. Close the check-in.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-followup`,
    };
  },
  /** The check-in closed; `closer` is null only if the member is unknown. */
  closed(checkinId: number, closer: string | null): PushContent {
    return {
      title: closer ? `${closer} closed the check-in` : 'Check-in closed',
      body: 'The summary is ready.',
      url: checkinPath(checkinId),
      tag: `checkin-${checkinId}-closed`,
    };
  },
};
