<script setup lang="ts">
/**
 * Money amount that can be masked for privacy, e.g. when balances are hidden.
 * Shows `maskedValue` instead of `value` while hidden.
 */
withDefaults(
  defineProps<{
    /** Already formatted amount, e.g. `€84,215.00`. */
    value: string;
    /** When false, shows `maskedValue` and labels it with `hiddenLabel`. */
    visible?: boolean;
    /** Placeholder text shown in place of the amount while hidden. */
    maskedValue?: string;
    /** Accessible name used while the amount is hidden. */
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
