import type {
  PushResult,
  PushSender,
  PushTarget,
} from '../src/modules/push/sender.js';

/** One call to the fake sender: where it went and the decoded payload. */
export type SentPush = {
  endpoint: string;
  /** The raw payload string, as the service worker receives it. */
  payload: string;
  content: { title: string; body: string; url: string; tag: string };
};

/**
 * Recording `PushSender` for tests. Nothing leaves the process: the answer
 * for each endpoint is set with `answerWith`, success by default.
 */
export function createFakePushSender(): PushSender & {
  sent: SentPush[];
  answerWith(endpoint: string, result: PushResult): void;
  /** Sent pushes to this endpoint. */
  to(endpoint: string): SentPush[];
} {
  const sent: SentPush[] = [];
  const answers = new Map<string, PushResult>();
  return {
    sent,
    answerWith: (endpoint, result) => answers.set(endpoint, result),
    to: (endpoint) => sent.filter((push) => push.endpoint === endpoint),
    async send(target: PushTarget, payload: string) {
      sent.push({
        endpoint: target.endpoint,
        payload,
        content: JSON.parse(payload) as SentPush['content'],
      });
      return answers.get(target.endpoint) ?? { ok: true };
    },
  };
}
