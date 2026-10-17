<script setup lang="ts">
import type { Currency } from '@budget-buddy/shared';
import BbAmountInput from '../../components/BbAmountInput.vue';
import BbSheet from '../../components/BbSheet.vue';

/**
 * The amount sheet behind the big amount of the transaction page: the
 * app's keypad with the amount now. A refund is typed with a minus, so only
 * an expense allows one (UI-AMT-3). "Save" closes it with the new amount.
 */
defineProps<{
  /** Heading: "Amount" or "Amount that arrives". */
  title: string;
  /** The currency of the amount. */
  currency: Currency;
  /** The amount now, in minor units; negative for a refund. */
  amount: bigint;
  /** A refund can be typed with a minus. */
  allowNegative: boolean;
  /** The save request is pending. */
  saving: boolean;
}>();

const emit = defineEmits<{
  /** "Save" with the amount in minor units. */
  save: [amount: bigint];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();
</script>

<template>
  <BbSheet :title="title" @close="emit('close')">
    <BbAmountInput
      :currency="currency"
      :allow-negative="allowNegative"
      :initial-amount="amount"
      :label="title"
      :saving="saving"
      needs-server
      @save="emit('save', $event)"
    />
  </BbSheet>
</template>
