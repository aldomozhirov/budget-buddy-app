<script setup lang="ts">
/**
 * Money amount that can be masked for privacy, e.g. when balances are hidden.
 * Shows `maskedValue` instead of `value` while hidden.
 */
withDefaults(
  defineProps<{
    /** Already formatted amount, e.g. `€84,215.00`. */
    value: string;
    /** When false, shows `maskedValue` and reads out `hiddenLabel`. */
    visible?: boolean;
    /** Placeholder text shown in place of the amount while hidden. */
    maskedValue?: string;
    /**
     * Text read by screen readers while the amount is hidden. It is rendered
     * as visually hidden text: a plain span can't carry `aria-label`.
     */
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
    v-if="visible"
    class="num"
  >
    {{ value }}
  </span>
  <span
    v-else
    class="num masked"
  >
    <span aria-hidden="true">{{ maskedValue }}</span>
    <span class="visually-hidden">{{ hiddenLabel }}</span>
  </span>
</template>
