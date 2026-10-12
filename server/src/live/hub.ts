import type { LiveSignal } from '@budget-buddy/shared';
import type { CheckinEventBus } from '../events.js';

/** One open stream, as the hub sees it. */
export interface LiveStream {
  /** Writes one signal to the client. */
  send(signal: LiveSignal): void;
  /** Ends the stream; the hub has already dropped it. */
  end(): void;
}

/** Fans check-in events out as signals to every open live stream. */
export interface LiveHub {
  /** Registers a stream; a closed hub ends it at once instead. */
  add(stream: LiveStream): void;
  /** Forgets a stream; harmless for one that is already gone. */
  remove(stream: LiveStream): void;
  /** How many streams are open. */
  readonly size: number;
  /** Stops listening to the event bus and ends every open stream. */
  close(): void;
}

/**
 * Turns the events that follow a committed check-in change into signals. A
 * signal holds the kind and the check-in id and nothing else, so no amount,
 * name or balance ever leaves through a stream.
 */
export function createLiveHub(events: CheckinEventBus): LiveHub {
  const streams = new Set<LiveStream>();
  let closed = false;

  function broadcast(signal: LiveSignal): void {
    for (const stream of [...streams]) {
      try {
        stream.send(signal);
      } catch {
        // A stream that cannot be written to is gone; its own close handler
        // removes it, and the others must still get the signal.
      }
    }
  }

  const stopSaved = events.on('checkin.valueSaved', (event) =>
    broadcast({ kind: 'changed', checkinId: event.checkinId }),
  );
  const stopContent = events.on('checkin.contentChanged', (event) =>
    broadcast({ kind: 'changed', checkinId: event.checkinId }),
  );
  const stopClosed = events.on('checkin.closed', (event) =>
    broadcast({ kind: 'closed', checkinId: event.checkinId }),
  );

  return {
    add(stream) {
      if (closed) stream.end();
      else streams.add(stream);
    },
    remove(stream) {
      streams.delete(stream);
    },
    get size() {
      return streams.size;
    },
    close() {
      closed = true;
      stopSaved();
      stopContent();
      stopClosed();
      for (const stream of [...streams]) {
        streams.delete(stream);
        try {
          stream.end();
        } catch {
          // Already closed by the client.
        }
      }
    },
  };
}
