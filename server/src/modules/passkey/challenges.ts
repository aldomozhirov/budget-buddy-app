import { systemClock, type Clock } from '../../clock.js';

/** The two ceremonies that use a challenge. */
export type ChallengeKind = 'register' | 'authenticate';

type Entry = { challenge: string; expiresAt: number; sessionId: number | null };

const maxEntries = 1000;

/**
 * Challenges handed out and not yet answered. They are single use, short
 * lived and bound to the device that asked (and, for registration, to its
 * session). They live in memory only: a restart cancels the ceremonies in
 * flight, which costs a retry, and no challenge is ever written to disk or
 * to a backup. There is one open challenge per device and kind, so a device
 * cannot grow the store.
 */
export class ChallengeStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly lifetimeMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Remembers a challenge for the device, replacing any earlier one. */
  issue(
    kind: ChallengeKind,
    deviceId: string,
    challenge: string,
    sessionId: number | null = null,
  ): void {
    const now = this.clock.now().getTime();
    this.prune(now);
    const key = `${kind}:${deviceId}`;
    this.entries.delete(key);
    this.entries.set(key, {
      challenge,
      expiresAt: now + this.lifetimeMs,
      sessionId,
    });
    while (this.entries.size > maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Takes the device's challenge out of the store: it is gone after this
   * call whether or not it is still valid, so it can be answered once.
   * @returns The challenge, or null when there is none, it expired, or it
   * was issued to another session.
   */
  take(
    kind: ChallengeKind,
    deviceId: string,
    sessionId: number | null = null,
  ): string | null {
    const key = `${kind}:${deviceId}`;
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now().getTime()) return null;
    if (entry.sessionId !== sessionId) return null;
    return entry.challenge;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
