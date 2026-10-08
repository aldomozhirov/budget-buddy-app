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
  }>(),
  { max: 100, over: false },
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
  >
    <span :style="{ width: `${percentage}%` }" />
  </span>
</template>
