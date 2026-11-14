<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Currency } from '@budget-buddy/shared';
import BbAmountInput, {
  type AmountChange,
} from '../../components/BbAmountInput.vue';
import BbButton from '../../components/BbButton.vue';
import { amountText } from '../add/addForm.js';

/**
 * "Counts in the envelope as" (UI-TXN-5) and "Counts for the wish as"
 * (UI-TXN-10): what an expense in another currency takes from its envelope
 * or counts for its wish, the rate it was converted at, a keypad
 * to type what the bank charged, and the button that keeps it. It sits in
 * the Counts for sheet, under the list.
 */
const props = defineProps<{
  /** The label above the figure and on the keypad. */
  label: string;
  /** The envelope's or wish's currency, for the keypad and the figures. */
  currency: Currency;
  /** The amount now, written; empty when there is no rate yet. */
  current: string;
  /** The rate line, or the note that it was typed by hand. */
  hint: string;
  /** The save request is pending. */
  saving: boolean;
}>();

const emit = defineEmits<{
  /** "Count it as …" with the typed amount in minor units. */
  save: [amount: bigint];
}>();

const typed = ref<AmountChange | null>(null);
const shown = computed(() => {
  if (typed.value === null || typed.value.empty) {
    return props.current || amountText(null, props.currency);
  }
  return typed.value.text;
});
const amount = computed(() =>
  typed.value && typed.value.valid && !typed.value.empty
    ? typed.value.amount
    : null,
);
const buttonLabel = computed(() =>
  amount.value === null
    ? `Type the amount in ${props.currency.code}`
    : `Count it as ${amountText(amount.value, props.currency)}`,
);

function save(): void {
  if (amount.value !== null) emit('save', amount.value);
}
</script>

<template>
  <div class="counts-box">
    <span class="lbl">{{ label }}</span>
    <span class="num counts-figure">{{ shown }}</span>
    <span class="num t-sub counts-hint">{{ hint }}</span>
  </div>
  <BbAmountInput
    bare
    :currency="currency"
    :label="label"
    @change="typed = $event"
  />
  <BbButton
    class="num"
    needs-server
    :disabled="amount === null || amount <= 0n || saving"
    @click="save"
    >{{ buttonLabel }}</BbButton
  >
</template>

<style scoped>
.counts-box {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bg);
}
.counts-figure {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.counts-hint {
  font-size: 12px;
}
</style>
