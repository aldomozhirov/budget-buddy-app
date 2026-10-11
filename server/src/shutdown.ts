/** What the shutdown needs from the process, so tests can fake it. */
export interface ShutdownProcess {
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  exit(code: number): void;
  exitCode?: number | string | null | undefined;
}

/** Options for `closeOnSignals`. */
export interface ShutdownOptions {
  /** Stops accepting work and waits for what is running; may reject. */
  close(): Promise<void>;
  /** Releases what outlives `close`, such as the database file. */
  release(): void;
  /** Where a failed or overdue shutdown is reported. */
  logger: { error(error: unknown, message: string): void };
  /** Longest the whole shutdown may take before the process is ended. */
  deadlineMs?: number;
  /** The process to listen on; the real one by default. */
  process?: ShutdownProcess;
}

const defaultDeadlineMs = 20_000;

/**
 * Closes the server cleanly on SIGTERM and SIGINT. Only the first signal
 * starts the shutdown. If it has not finished by the deadline, the process
 * ends anyway: a run still going is left `running` in `job_run`, which the
 * next start recovers.
 * @returns The shutdown itself, which resolves when it is over.
 */
export function closeOnSignals(options: ShutdownOptions): () => Promise<void> {
  const { close, release, logger } = options;
  const target = options.process ?? process;
  const deadlineMs = options.deadlineMs ?? defaultDeadlineMs;
  let closing: Promise<void> | undefined;

  function shutdown(): Promise<void> {
    closing ??= (async () => {
      const deadline = setTimeout(() => {
        logger.error(new Error('Shutdown overran'), 'Shutdown timed out');
        target.exit(1);
      }, deadlineMs);
      try {
        await close();
      } catch (error) {
        logger.error(error, 'Shutdown failed');
        target.exitCode = 1;
      } finally {
        clearTimeout(deadline);
      }
      try {
        release();
      } catch (error) {
        logger.error(error, 'Database could not be closed');
        target.exitCode = 1;
      }
    })();
    return closing;
  }

  target.once('SIGTERM', () => void shutdown());
  target.once('SIGINT', () => void shutdown());
  return shutdown;
}
