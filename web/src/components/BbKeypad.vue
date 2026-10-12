<script setup lang="ts">
/**
 * Four-row arithmetic keypad that emits tokens to an amount editor. It has no
 * slots; each key has a screen-reader name where its symbol is not enough.
 */
withDefaults(
  defineProps<{
    /** Disables unary minus where this amount cannot be negative. */
    minusDisabled?: boolean;
  }>(),
  { minusDisabled: false },
);

/** Emits the expression token or the `⌫` and `C` editing commands. */
const emit = defineEmits<{
  press: [key: string];
}>();

const keys: readonly {
  readonly value: string;
  readonly label: string;
  readonly operator?: boolean;
}[] = [
  { value: '7', label: '7' },
  { value: '8', label: '8' },
  { value: '9', label: '9' },
  { value: '(', label: 'Open bracket', operator: true },
  { value: ')', label: 'Close bracket', operator: true },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
  { value: '×', label: 'Multiply', operator: true },
  { value: '÷', label: 'Divide', operator: true },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '+', label: 'Plus', operator: true },
  { value: '−', label: 'Minus', operator: true },
  { value: '.', label: 'Decimal point' },
  { value: '0', label: '0' },
  { value: '%', label: 'Percent', operator: true },
  { value: '⌫', label: 'Delete', operator: true },
  { value: 'C', label: 'Clear', operator: true },
] as const;
</script>

<template>
  <div
    class="keypad"
    role="group"
    aria-label="Amount keypad"
  >
    <button
      v-for="key in keys"
      :key="key.value"
      type="button"
      :class="['key', { 'key-op': key.operator === true }]"
      :aria-label="key.label === key.value ? undefined : key.label"
      :disabled="key.value === '−' && minusDisabled"
      @click="emit('press', key.value)"
    >
      {{ key.value }}
    </button>
  </div>
</template>
