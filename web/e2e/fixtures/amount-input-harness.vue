<script setup lang="ts">
import { ref } from 'vue';
import { formatMoney, getCurrency } from '@budget-buddy/shared';
import BbAmountInput from '../../src/components/BbAmountInput.vue';

const currency = getCurrency('EUR')!;
const allowNegative =
  new URLSearchParams(window.location.search).get('allowNegative') === 'true';

const savedAmount = ref('');

function save(amount: bigint): void {
  savedAmount.value = formatMoney(amount, currency);
}
</script>

<template>
  <main class="bb amount-input-harness">
    <h1>Amount input component harness</h1>
    <BbAmountInput
      :currency="currency"
      :allow-negative="allowNegative"
      :last-amount="allowNegative ? null : 12345n"
      :label="allowNegative ? 'Refund amount' : 'Amount'"
      save-label="Save"
      @save="save"
    />
    <output
      v-if="savedAmount"
      role="status"
      aria-live="polite"
      aria-label="Saved amount"
    >
      {{ savedAmount }}
    </output>
  </main>
</template>
