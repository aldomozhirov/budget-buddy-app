<script setup lang="ts">
import { computed } from 'vue';
import { addMonths } from '@budget-buddy/shared';
import BbIcon from '../../components/BbIcon.vue';
import { monthWithYear } from '../envelopes/envelopeFormat.js';
import {
  EARLIEST_MONTH,
  clampMonth,
  hasNextMonth,
  hasPreviousMonth,
  lastMonth,
  monthRelation,
} from './wishesFormat.js';

/**
 * A month and its relation to the current one (UI-WSH-1, UI-WSH-3). A
 * transparent `<input type="month">` over the month opens the iPhone's month
 * picker. With arrows it is the Wishes switcher; with `field` it is the form's
 * Month field, without arrows. The range is 2000-01 to 12 months ahead (O8).
 */
defineOptions({ name: 'WishMonthStepper' });

const props = defineProps<{
  /** The month shown, as `YYYY-MM`. */
  month: string;
  /** The family's current month, as `YYYY-MM`. */
  current: string;
  /** Draws the form's Month field: no arrows, the field look. */
  field?: boolean;
  /** Accessible name of the input before the month; "Choose month". */
  label?: string;
}>();

const emit = defineEmits<{
  /** The month after a step or a pick. */
  'update:month': [month: string];
}>();

const relation = computed(() => monthRelation(props.month, props.current));

const inputName = computed(
  () => `${props.label ?? 'Choose month'}, ${monthWithYear(props.month)}`,
);

/**
 * Applies a picked month: an empty value keeps the month shown, a month out
 * of range takes the nearest allowed one, the month shown emits nothing.
 */
function pick(event: Event): void {
  const el = event.target as HTMLInputElement;
  const picked = /^\d{4}-\d{2}$/.test(el.value)
    ? clampMonth(el.value, props.current)
    : props.month;
  el.value = props.month;
  if (picked !== props.month) emit('update:month', picked);
}

function step(by: number): void {
  emit('update:month', addMonths(props.month, by));
}
</script>

<template>
  <div class="wishes-months" :class="{ 'wishes-field': field }" role="group">
    <button
      v-if="!field"
      class="wishes-step"
      type="button"
      aria-label="Previous month"
      :disabled="!hasPreviousMonth(month)"
      @click="step(-1)"
    >
      <BbIcon name="back" />
    </button>
    <span class="wishes-month" :aria-live="field ? undefined : 'polite'">
      <span class="wishes-month-name">{{ monthWithYear(month) }}</span>
      <span class="t-sub">{{ relation }}</span>
      <input
        class="wishes-pick"
        type="month"
        :value="month"
        :min="EARLIEST_MONTH"
        :max="lastMonth(current)"
        :aria-label="inputName"
        @change="pick"
      />
    </span>
    <button
      v-if="!field"
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
.wishes-field {
  padding: 0;
}
.wishes-field .wishes-month {
  min-height: 52px;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface);
  padding: 6px 12px;
  align-items: flex-start;
  justify-content: center;
  text-align: left;
}
.wishes-field .wishes-month-name {
  font-size: 18px;
}
.wishes-pick {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  font-size: 16px;
  border: 0;
  padding: 0;
}
.wishes-month:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.wishes-month {
  position: relative;
  min-height: 44px;
  justify-content: center;
  flex: 1;
  min-width: 0;
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
