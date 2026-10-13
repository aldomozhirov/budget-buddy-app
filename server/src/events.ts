/** Lifecycle events that background notification work can observe. */
export interface CheckinEvents {
  'checkin.opened': {
    checkinId: number;
    openedAt: number;
    openedBy: number | null;
    scheduleSlot: string | null;
  };
  'checkin.closed': {
    checkinId: number;
    closedAt: number;
    /** The member who pressed "Close now"; nothing else closes a check-in. */
    closedBy: number;
  };
  /**
   * A value was saved or replaced. Carries no amount: it only tells the live
   * stream (not the notifier) that the check-in changed.
   */
  'checkin.valueSaved': {
    checkinId: number;
    accountId: number;
    savedBy: number;
  };
  /**
   * Something the open check-in shows changed outside a value save: an
   * account or a profile was added, renamed, moved or switched on or off, an
   * account changed currency, or a balance was entered or corrected. Like
   * `checkin.valueSaved` it only tells the live stream.
   */
  'checkin.contentChanged': {
    checkinId: number;
  };
  'checkin.followup': {
    checkinId: number;
    /**
     * Local `YYYY-MM-DDTHH:MM` of the reminder: a follow-up time (CHK-3) or
     * the schedule slot that found the check-in open (CHK-2). A member gets
     * one reminder per check-in and slot.
     */
    slot: string;
  };
}

/** Callback subscribed to one check-in lifecycle event. */
export type CheckinEventListener<K extends keyof CheckinEvents> = (
  event: CheckinEvents[K],
) => void | Promise<void>;

/** In-process event bus for check-in lifecycle consumers. */
export interface CheckinEventBus {
  /** Subscribes to an event and returns a function that removes the listener. */
  on<K extends keyof CheckinEvents>(
    event: K,
    listener: CheckinEventListener<K>,
  ): () => void;
  /** Notifies current listeners without making their failures fail the request. */
  emit<K extends keyof CheckinEvents>(event: K, value: CheckinEvents[K]): void;
}

/** Creates an event bus whose listener errors are sent to `onError`. */
export function createCheckinEventBus(
  onError: (error: unknown, event: keyof CheckinEvents) => void = () => {},
): CheckinEventBus {
  const listeners = new Map<
    keyof CheckinEvents,
    Set<(value: never) => void | Promise<void>>
  >();

  return {
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener as (value: never) => void | Promise<void>);
      listeners.set(event, eventListeners);
      return () =>
        eventListeners.delete(
          listener as (value: never) => void | Promise<void>,
        );
    },
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) {
        try {
          void Promise.resolve(listener(value as never)).catch(
            (error: unknown) => onError(error, event),
          );
        } catch (error) {
          onError(error, event);
        }
      }
    },
  };
}
