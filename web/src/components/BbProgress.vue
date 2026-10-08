<script setup lang="ts">
import { computed } from 'vue';

/**
 * Horizontal progress bar, e.g. budget spent or check-in progress.
 * The fill is clamped to 0–100%.
 */
const props = withDefaults(
  defineProps<{
    /** Current value, in the same units as `max`. */
    value: number;
    /** Upper bound; zero, negative or non-finite values fall back to 1. */
    max?: number;
    /** Accessible name; the bar shows no text. */
    label: string;
    /** Use the over-limit (e.g. overspent) style. */
    over?: boolean;
    /**
     * Value as screen readers should say it, e.g. `€120 of €100, over
     * budget`. Defaults to the percentage, marked as over the limit when
     * `over` is set.
     */
    valueText?: string;
  }>(),
  { max: 100, over: false, valueText: '' },
);

/** `max`, made safe to divide by and to expose as `aria-valuemax`. */
const safeMax = computed(() =>
  Number.isFinite(props.max) && props.max > 0 ? props.max : 1,
);
const percentage = computed(() =>
  Math.max(0, Math.min(100, (props.value / safeMax.value) * 100)),
);
/** Value reported as `aria-valuenow`, clamped to 0…max. */
const currentValue = computed(() =>
  Math.max(0, Math.min(safeMax.value, props.value)),
);
/**
 * `aria-valuetext`. The clamped `aria-valuenow` would read an overspent
 * budget as exactly 100%, so `over` states the real share and the overrun.
 */
const valueText = computed(() => {
  if (props.valueText) return props.valueText;
  if (!props.over) return undefined;
  const share = Math.round((props.value / safeMax.value) * 100);
  return `${share}%, over the limit`;
});
</script>

<template>
  <span
    class="progress"
    :class="{ 'progress-over': over }"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    :aria-valuemax="safeMax"
    :aria-valuenow="currentValue"
    :aria-valuetext="valueText"
  >
    <span :style="{ width: `${percentage}%` }" />
  </span>
</template>
