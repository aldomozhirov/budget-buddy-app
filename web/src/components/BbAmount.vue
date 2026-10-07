<script setup lang="ts">
withDefaults(
  defineProps<{
    value: string;
    visible?: boolean;
    maskedValue?: string;
    hiddenLabel?: string;
  }>(),
  {
    visible: true,
    maskedValue: '€ • • • • •',
    hiddenLabel: 'Amount hidden',
  },
);
</script>

<template>
  <span
    class="num"
    :class="{ masked: !visible }"
    :aria-label="visible ? undefined : hiddenLabel"
  >
    {{ visible ? value : maskedValue }}
  </span>
</template>
