<script setup lang="ts">
import { computed } from 'vue';
import { addMonths } from '@budget-buddy/shared';
import BbIcon from '../../components/BbIcon.vue';
import { monthWithYear } from '../envelopes/envelopeFormat.js';
import {
  hasNextMonth,
  hasPreviousMonth,
  monthRelation,
} from './wishesFormat.js';

/**
 * Previous and next arrows around a month and its relation to the current
 * one (UI-WSH-1, UI-WSH-3). The range is 2000-01 to 12 months ahead (O8).
 */
defineOptions({ name: 'WishMonthStepper' });

const props = defineProps<{
  /** The month shown, as `YYYY-MM`. */
  month: string;
  /** The family's current month, as `YYYY-MM`. */
  current: string;
}>();

const emit = defineEmits<{
  /** The month after a step. */
  'update:month': [month: string];
}>();

const relation = computed(() => monthRelation(props.month, props.current));

function step(by: number): void {
  emit('update:month', addMonths(props.month, by));
}
</script>

<template>
  <div class="wishes-months" role="group">
    <button
      class="wishes-step"
      type="button"
      aria-label="Previous month"
      :disabled="!hasPreviousMonth(month)"
      @click="step(-1)"
    >
      <BbIcon name="back" />
    </button>
    <span class="wishes-month" aria-live="polite">
      <span class="wishes-month-name">{{ monthWithYear(month) }}</span>
      <span class="t-sub">{{ relation }}</span>
    </span>
    <button
      class="wishes-step"
      type="button"
      aria-label="Next month"
      :disabled="!hasNextMonth(month, current)"
      @click="step(1)"
    >
      <BbIcon name="forward" />
    </button>
  </div>
</template>

<style scoped>
.wishes-months {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
}
.wishes-step {
  flex: none;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 22px;
  color: var(--ink);
}
.wishes-step:disabled {
  opacity: 0.3;
}
.wishes-month {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.wishes-month-name {
  font-weight: 600;
}
.wishes-month .t-sub {
  font-size: 12px;
}
</style>
