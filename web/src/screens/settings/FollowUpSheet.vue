<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  settingsResponseSchema,
  summarizeFollowUp,
  type SettingsResponse,
} from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbSheet from '../../components/BbSheet.vue';

/**
 * Bottom sheet for the follow-up reminder interval (CHK-3, UI-SET-1): every
 * day, every 2, 3 or 7 days, or off. "Done" saves; Close discards.
 */
const props = defineProps<{
  /** The saved interval in days the sheet starts from; 0 is off. */
  followupDays: number;
}>();

const emit = defineEmits<{
  /** The interval was saved; carries the settings the server returned. */
  saved: [settings: SettingsResponse];
  /** The sheet was dismissed without saving. */
  close: [];
}>();

const standardDays = [1, 2, 3, 7, 0];

const days = ref(props.followupDays);
const busy = ref(false);
const error = ref('');

/** The usual intervals, plus a saved one that is not one of them. */
const options = computed(() =>
  standardDays.includes(props.followupDays)
    ? standardDays
    : [...standardDays.slice(0, -1), props.followupDays, 0].sort(
        (left, right) => (left || Infinity) - (right || Infinity),
      ),
);

const preview = computed(() =>
  days.value < 1
    ? 'No reminders. The banner still shows an open check-in.'
    : `${summarizeFollowUp(days.value)} while a check-in is open, a reminder goes to each profile with accounts left. It never shows amounts.`,
);

function close(): void {
  if (!busy.value) emit('close');
}

async function save(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ followupDays: days.value }),
    });
    if (!response.ok) {
      error.value = 'Could not save the reminders. Try again.';
      return;
    }
    emit('saved', settingsResponseSchema.parse(await response.json()));
  } catch {
    error.value =
      'Could not save the reminders. Check your connection and try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BbSheet title="Follow-up reminders" @close="close">
    <div class="followup-group">
      <span id="followup-days-label" class="lbl">Remind</span>
      <div
        class="followup-options"
        role="group"
        aria-labelledby="followup-days-label"
      >
        <BbChip
          v-for="option in options"
          :key="option"
          :selected="days === option"
          @click="days = option"
        >
          {{ summarizeFollowUp(option) }}
        </BbChip>
      </div>
    </div>

    <p class="num followup-preview" role="status">{{ preview }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <BbButton :disabled="busy" :aria-busy="busy" @click="save">Done</BbButton>
  </BbSheet>
</template>

<style scoped>
.followup-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.followup-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.followup-preview {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bg);
  font-size: 14px;
}

/* The design puts the chips on the page colour: the sheet itself is white. */
.followup-group :deep(.chip:not(.chip-on)) {
  background: var(--bg);
}
</style>
