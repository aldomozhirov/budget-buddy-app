import { reactive } from 'vue';
import type { FeedbackKind, FeedbackScreenshot } from '@budget-buddy/shared';

/**
 * The feedback being written (UI-SET-6). It lives in memory only, so Close
 * and reopening the sheet keep it until the app is closed; it is never
 * written to storage (spec 8, Design 5).
 */
export interface FeedbackDraft {
  kind: FeedbackKind;
  text: string;
  /** The picked picture, already re-encoded for sending. */
  screenshot: FeedbackScreenshot | null;
}

/** The one draft of this page. */
export const feedbackDraft = reactive<FeedbackDraft>({
  kind: 'problem',
  text: '',
  screenshot: null,
});

/** Empties the draft after it was sent. */
export function clearFeedbackDraft(): void {
  feedbackDraft.kind = 'problem';
  feedbackDraft.text = '';
  feedbackDraft.screenshot = null;
}
