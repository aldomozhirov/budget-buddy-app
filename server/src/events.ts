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
    closedBy: number | null;
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
