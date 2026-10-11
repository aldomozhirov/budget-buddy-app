import { describe, expect, it } from 'vitest';
import { ChallengeStore } from '../src/modules/passkey/challenges.js';
import {
  originIsRelyingParty,
  relyingPartyFrom,
} from '../src/modules/passkey/relyingParty.js';

describe('relying party', () => {
  it('is the first origin: its host is the RP ID and only it may use Face ID', () => {
    const rp = relyingPartyFrom([
      'https://mini.tail1234.ts.net',
      'https://other.example',
    ]);
    expect(rp).toEqual({
      id: 'mini.tail1234.ts.net',
      origin: 'https://mini.tail1234.ts.net',
    });
    expect(originIsRelyingParty('https://mini.tail1234.ts.net', rp!)).toBe(
      true,
    );
    expect(originIsRelyingParty('https://other.example', rp!)).toBe(false);
    expect(originIsRelyingParty(undefined, rp!)).toBe(false);
    // The port is part of the origin.
    expect(originIsRelyingParty('https://mini.tail1234.ts.net:5443', rp!)).toBe(
      false,
    );
  });

  it('keeps the port out of the RP ID but in the origin', () => {
    expect(relyingPartyFrom(['https://mini.ts.net:5443'])).toEqual({
      id: 'mini.ts.net',
      origin: 'https://mini.ts.net:5443',
    });
  });

  it('accepts http only on localhost', () => {
    expect(relyingPartyFrom(['http://localhost:5173'])?.id).toBe('localhost');
    expect(relyingPartyFrom(['http://app.localhost:5173'])?.id).toBe(
      'app.localhost',
    );
    expect(relyingPartyFrom(['http://mini.ts.net'])).toBeNull();
  });

  it('gives none for an IP address, which browsers refuse as an RP ID', () => {
    expect(relyingPartyFrom(['http://127.0.0.1:5173'])).toBeNull();
    expect(relyingPartyFrom(['https://192.168.1.20'])).toBeNull();
    expect(relyingPartyFrom(['https://[::1]:5443'])).toBeNull();
    expect(relyingPartyFrom([])).toBeNull();
  });
});

describe('challenge store', () => {
  const at = (ms: number) => ({ now: () => new Date(ms) });

  it('hands a challenge out once', () => {
    const store = new ChallengeStore(1000, at(0));
    store.issue('authenticate', 'device-a', 'c1');
    expect(store.take('authenticate', 'device-a')).toBe('c1');
    expect(store.take('authenticate', 'device-a')).toBeNull();
  });

  it('is gone after a failed look, so a wrong session cannot retry it', () => {
    const store = new ChallengeStore(1000, at(0));
    store.issue('register', 'device-a', 'c1', 7);
    expect(store.take('register', 'device-a', 8)).toBeNull();
    expect(store.take('register', 'device-a', 7)).toBeNull();
  });

  it('is bound to the device, the kind and the session', () => {
    const store = new ChallengeStore(1000, at(0));
    store.issue('register', 'device-a', 'c1', 7);
    expect(store.take('register', 'device-b', 7)).toBeNull();
    expect(store.take('authenticate', 'device-a', 7)).toBeNull();
    expect(store.take('register', 'device-a', null)).toBeNull();
  });

  it('expires', () => {
    let now = 0;
    const store = new ChallengeStore(1000, { now: () => new Date(now) });
    store.issue('authenticate', 'device-a', 'c1');
    now = 1000;
    expect(store.take('authenticate', 'device-a')).toBeNull();
  });

  it('keeps one per device and kind: a new one replaces the old', () => {
    const store = new ChallengeStore(1000, at(0));
    store.issue('authenticate', 'device-a', 'c1');
    store.issue('authenticate', 'device-a', 'c2');
    expect(store.take('authenticate', 'device-a')).toBe('c2');
  });

  it('stays bounded when many devices ask', () => {
    const store = new ChallengeStore(1_000_000, at(0));
    for (let i = 0; i < 1500; i += 1) {
      store.issue('authenticate', `device-${i}`, `c${i}`);
    }
    expect(store.take('authenticate', 'device-0')).toBeNull();
    expect(store.take('authenticate', 'device-1499')).toBe('c1499');
  });
});
