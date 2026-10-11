import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeOnSignals, type ShutdownProcess } from '../src/shutdown.js';

/** A stand-in for `process` that lets the test send the signals. */
function fakeProcess() {
  const handlers = new Map<string, () => void>();
  const target: ShutdownProcess & { send(signal: string): void } = {
    once: (signal, listener) => handlers.set(signal, listener),
    exit: vi.fn(),
    exitCode: undefined,
    send: (signal) => handlers.get(signal)?.(),
  };
  return target;
}

describe('closeOnSignals', () => {
  const logger = { error: vi.fn() };

  afterEach(() => {
    vi.useRealTimers();
    logger.error.mockReset();
  });

  it.each(['SIGTERM', 'SIGINT'])(
    'closes the app and then releases the database on %s, once',
    async (signal) => {
      const order: string[] = [];
      const target = fakeProcess();
      const shutdown = closeOnSignals({
        close: () => {
          order.push('close');
          return Promise.resolve();
        },
        release: () => order.push('release'),
        logger,
        process: target,
      });

      target.send(signal);
      target.send('SIGTERM');
      await shutdown();

      expect(order).toEqual(['close', 'release']);
      expect(target.exit).not.toHaveBeenCalled();
      expect(target.exitCode).toBeUndefined();
    },
  );

  it('still releases the database and fails the exit code when closing fails', async () => {
    const release = vi.fn();
    const target = fakeProcess();
    const failure = new Error('hook failed');
    const shutdown = closeOnSignals({
      close: () => Promise.reject(failure),
      release,
      logger,
      process: target,
    });

    target.send('SIGTERM');
    await shutdown();

    expect(release).toHaveBeenCalledTimes(1);
    expect(target.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(failure, 'Shutdown failed');
  });

  it('ends the process at the deadline when closing hangs', async () => {
    vi.useFakeTimers();
    const target = fakeProcess();
    closeOnSignals({
      close: () => new Promise<void>(() => undefined),
      release: vi.fn(),
      logger,
      deadlineMs: 5_000,
      process: target,
    });

    target.send('SIGINT');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(target.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(target.exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      'Shutdown timed out',
    );
  });
});
