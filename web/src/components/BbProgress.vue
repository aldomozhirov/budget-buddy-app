<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number;
    max?: number;
    label: string;
    over?: boolean;
  }>(),
  { max: 100, over: false },
);

const safeMax = computed(() =>
  Number.isFinite(props.max) && props.max > 0 ? props.max : 1,
);
const percentage = computed(() =>
  Math.max(0, Math.min(100, (props.value / safeMax.value) * 100)),
);
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
