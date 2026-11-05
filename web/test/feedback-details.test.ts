import { describe, expect, it } from 'vitest';
import { deviceType } from '../src/device.js';
import {
  feedbackDetails,
  iosVersion,
  type BrowserFacts,
} from '../src/screens/settings/feedbackDetails.js';

/** The device details of a report (spec 8 Design 5, FBK-2). */

const iPhoneAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const iPadAgent =
  'Mozilla/5.0 (iPad; CPU OS 26_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const iPadDesktopAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
const macAgent = iPadDesktopAgent;
const androidAgent =
  'Mozilla/5.0 (Linux; Android 15; Test) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';

const facts = (
  userAgent: string,
  maxTouchPoints = 5,
  standalone = false,
): BrowserFacts => ({ userAgent, maxTouchPoints, standalone });

describe('feedbackDetails', () => {
  it('describes an iPhone in the Home Screen app', () => {
    expect(feedbackDetails(facts(iPhoneAgent, 5, true))).toEqual({
      type: 'iPhone',
      os: 'iOS 26.1',
      display: 'standalone',
      userAgent: iPhoneAgent,
    });
  });

  it('describes an iPad in the browser, with a three-part version', () => {
    expect(feedbackDetails(facts(iPadAgent))).toMatchObject({
      type: 'iPad',
      os: 'iOS 26.0.1',
      display: 'browser',
    });
  });

  it('tells an iPad asking for desktop sites from a Mac by touch points', () => {
    expect(feedbackDetails(facts(iPadDesktopAgent, 5)).type).toBe('iPad');
    expect(feedbackDetails(facts(macAgent, 0)).type).toBe('other');
  });

  it('gives other and no os for a non-Apple device', () => {
    expect(feedbackDetails(facts(androidAgent))).toMatchObject({
      type: 'other',
      os: null,
    });
  });

  it('cuts a very long user agent to 400 characters', () => {
    const long = `${iPhoneAgent} ${'x'.repeat(1000)}`;
    expect(feedbackDetails(facts(long)).userAgent).toHaveLength(400);
  });

  it('reads only what it is given, and returns only the four fields', () => {
    const details = feedbackDetails(facts(iPhoneAgent));
    expect(Object.keys(details).sort()).toEqual([
      'display',
      'os',
      'type',
      'userAgent',
    ]);
  });
});

describe('iosVersion', () => {
  it('reads two and three part versions', () => {
    expect(iosVersion(iPhoneAgent)).toBe('iOS 26.1');
    expect(iosVersion(iPadAgent)).toBe('iOS 26.0.1');
  });
  it('is null when the agent names no version', () => {
    expect(iosVersion(iPadDesktopAgent)).toBeNull();
    expect(iosVersion('')).toBeNull();
  });
});

describe('deviceType', () => {
  it('is other without a navigator', () => {
    expect(deviceType(undefined)).toBe('other');
  });
  it('knows an iPod as an iPhone', () => {
    expect(
      deviceType({ userAgent: 'Mozilla/5.0 (iPod touch)', maxTouchPoints: 5 }),
    ).toBe('iPhone');
  });
});
