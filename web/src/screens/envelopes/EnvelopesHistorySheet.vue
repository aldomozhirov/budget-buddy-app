<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  envelopeHistoryResponseSchema,
  type Envelope,
} from '@budget-buddy/shared';
import BbSheet from '../../components/BbSheet.vue';
import { callApi } from './envelopeApi.js';
import { modeLabel, monthWithYear } from './envelopeFormat.js';

/**
 * The History picker (UI-ENV-9, O10): each active envelope with its mode,
 * start and how many closed months stayed within budget. A pick opens that
 * envelope on its History tab.
 */
const props = defineProps<{
  /** The active envelopes. */
  envelopes: Envelope[];
}>();

const emit = defineEmits<{
  /** Close button, scrim tap, swipe down, or a pick. */
  close: [];
}>();

/** "3 of 5 months within budget" by envelope id, once read. */
const summaries = ref<Record<number, string>>({});

onMounted(() => {
  for (const envelope of props.envelopes) {
    callApi(
      'GET',
      `/api/envelopes/${envelope.id}/history?period=all`,
      envelopeHistoryResponseSchema,
    )
      .then(({ statistics }) => {
        summaries.value[envelope.id] =
          statistics.months === 0
            ? 'No closed month yet'
            : `${statistics.withinBudget} of ${statistics.months} months within budget`;
      })
      .catch(() => {
        summaries.value[envelope.id] = '';
      });
  }
});
</script>

<template>
  <BbSheet title="History" @close="emit('close')">
    <p class="t-sub history-hint">Pick an envelope to see its months.</p>
    <div class="history-list">
      <RouterLink
        v-for="envelope in envelopes"
        :key="envelope.id"
        class="opt"
        :to="{ path: `/envelopes/${envelope.id}`, query: { tab: 'history' } }"
        @click="emit('close')"
      >
        <span class="history-name">
          <span class="history-title">{{ envelope.name }}</span>
          <span class="t-sub"
            >{{ modeLabel(envelope.plan?.mode ?? 'reset') }} · since
            {{ monthWithYear(envelope.startingMonth) }}</span
          >
        </span>
        <span class="t-sub num">{{ summaries[envelope.id] }}</span>
      </RouterLink>
    </div>
  </BbSheet>
</template>

<style scoped>
.history-hint {
  margin: 0;
}
.history-list {
  display: flex;
  flex-direction: column;
}
.history-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.history-title {
  font-weight: 600;
}
</style>
