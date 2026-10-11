/**
 * What a push shows and does. It is sent as JSON and read by `web/src/sw.ts`.
 * No field may contain an amount (NTF-4).
 */
export type PushContent = {
  title: string;
  body: string;
  /** In-app path opened by a tap on the notification (UI-NAV-6). */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
};

/**
 * Something that happened to a check-in and may have to be announced. A new
 * kind needs its own case in `planNotification` and, if it comes from the
 * event bus, a listener in `createNotifier`.
 */
export type NotificationEvent =
  | {
      kind: 'checkin.opened';
      checkinId: number;
      /** The member who started it, or null when the schedule did. */
      openedBy: number | null;
    }
  | {
      kind: 'checkin.closed';
      checkinId: number;
      /** The member who closed it, or null when it closed by itself. */
      closedBy: number | null;
    }
  | {
      kind: 'checkin.followup';
      checkinId: number;
      /** Local time of the reminder; it makes each reminder once per member. */
      slot: string;
    };

/** Who gets which message for one event, and the key that makes it once. */
export type NotificationPlan = {
  /** Value of `notification.event`. */
  event: NotificationEvent['kind'];
  checkinId: number;
  /** Value of `notification.slot`; `''` for events that happen once. */
  slot: string;
  /** Member IDs, in ascending order. */
  recipients: number[];
  content: PushContent;
};
