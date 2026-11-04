<script setup lang="ts">
import { computed, ref } from 'vue';
import { isFeedbackTextLongEnough } from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSegmented from '../../components/BbSegmented.vue';
import BbSheet from '../../components/BbSheet.vue';
import { sendFeedback } from '../../offline/feedbackOutbox.js';
import { feedbackDetails } from './feedbackDetails.js';
import { clearFeedbackDraft, feedbackDraft } from './feedbackDraft.js';
import { encodeScreenshot } from './screenshot.js';

/**
 * The feedback sheet over Settings (UI-SET-6): a problem or an idea, free
 * text and an optional screenshot. Send saves the report on the phone and
 * tries to send it (spec 8, Design 4); it works offline too. Close keeps the
 * draft until the app is closed.
 */
const props = defineProps<{
  /** The screen open before Settings, sent with the report (O5). */
  fromScreen: string | null;
}>();

const emit = defineEmits<{
  /** Sent now, or saved to send itself later; the sheet is cleared. */
  sent: [result: 'sent' | 'saved'];
  /** Closed without sending; the draft is kept. */
  close: [];
}>();

const kinds = [
  { label: 'Something’s wrong', value: 'problem' },
  { label: 'An idea', value: 'idea' },
];

const placeholder = computed(() =>
  feedbackDraft.kind === 'idea'
    ? 'What would make Budget Buddy better?'
    : 'What happened, and what did you expect?',
);

const picker = ref<HTMLInputElement>();
const encoding = ref(false);
const busy = ref(false);
const error = ref('');
/** Counts picks, so only the latest one's picture is kept. */
let pickCount = 0;

const canSend = computed(
  () =>
    isFeedbackTextLongEnough(feedbackDraft.text.trim()) &&
    !encoding.value &&
    !busy.value,
);

function close(): void {
  if (!busy.value) emit('close');
}

function chooseKind(value: string | number): void {
  feedbackDraft.kind = value === 'idea' ? 'idea' : 'problem';
}

async function pickScreenshot(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared, so picking the same picture again still counts as a pick.
  input.value = '';
  if (!file) return;
  const pick = ++pickCount;
  encoding.value = true;
  error.value = '';
  try {
    const screenshot = await encodeScreenshot(file);
    if (pick === pickCount) feedbackDraft.screenshot = screenshot;
  } catch {
    if (pick === pickCount) {
      error.value = 'Could not read that picture. Try another one.';
    }
  } finally {
    if (pick === pickCount) encoding.value = false;
  }
}

async function send(): Promise<void> {
  if (!canSend.value) return;
  busy.value = true;
  error.value = '';
  // A plain copy: IndexedDB cannot store the draft's reactive proxy.
  const shot = feedbackDraft.screenshot;
  try {
    const result = await sendFeedback({
      clientId: crypto.randomUUID(),
      kind: feedbackDraft.kind,
      text: feedbackDraft.text.trim(),
      writtenAt: new Date().toISOString(),
      device: feedbackDetails(props.fromScreen),
      screenshot: shot ? { type: shot.type, data: shot.data } : null,
    });
    clearFeedbackDraft();
    emit('sent', result);
  } catch {
    error.value = 'Could not save your feedback.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BbSheet title="Send feedback" @close="close">
    <form class="feedback-form" @submit.prevent="send">
      <BbSegmented
        :model-value="feedbackDraft.kind"
        :options="kinds"
        label="Kind of feedback"
        @update:model-value="chooseKind"
      />
      <textarea
        v-model="feedbackDraft.text"
        class="noteinput noteinput-tall"
        aria-label="Your feedback"
        :placeholder="placeholder"
        :readonly="busy"
        maxlength="4000"
      />
      <div class="feedback-details">
        <span class="t-sub feedback-details-text">
          App version, device and screen are sent with it. Never amounts or
          names.
        </span>
        <button
          v-if="feedbackDraft.screenshot"
          type="button"
          class="attach-tag"
          aria-label="Remove the screenshot"
          @click="feedbackDraft.screenshot = null"
        >
          Screenshot
          <BbIcon name="close" :size="14" :stroke-width="2.4" />
        </button>
        <button
          v-else
          type="button"
          class="icon-btn"
          aria-label="Add a screenshot"
          :disabled="encoding"
          @click="picker?.click()"
        >
          <BbIcon name="image" :size="20" />
        </button>
        <input
          ref="picker"
          class="feedback-picker"
          type="file"
          accept="image/*"
          tabindex="-1"
          aria-hidden="true"
          @change="pickScreenshot"
        />
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <BbButton type="submit" :disabled="!canSend" :aria-busy="busy">
        Send
      </BbButton>
    </form>
  </BbSheet>
</template>

<style scoped>
.feedback-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feedback-details {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--touch);
}

.feedback-details-text {
  flex: 1;
  font-size: 13px;
}

.feedback-picker {
  display: none;
}
</style>
