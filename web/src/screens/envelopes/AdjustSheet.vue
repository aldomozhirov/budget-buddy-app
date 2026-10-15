<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  adjustmentResponseSchema,
  formatMoney,
  type CoinSetting,
  type Envelope,
} from '@budget-buddy/shared';
import BbAmountInput, {
  type AmountChange,
} from '../../components/BbAmountInput.vue';
import BbButton from '../../components/BbButton.vue';
import BbSheet from '../../components/BbSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { envelopeCurrency } from './envelopeFormat.js';

/**
 * The adjust sheet (UI-ENV-5): a signed amount on the keypad and a note.
 * A reset envelope's adjustment lasts this month; a carry-over envelope's
 * carries over to the next.
 */
const props = defineProps<{
  envelope: Envelope;
  coins: CoinSetting[];
}>();

const emit = defineEmits<{
  /** The adjustment was saved. */
  adjusted: [];
  /** Close button, scrim tap, swipe down, or after the save. */
  close: [];
}>();

const typed = ref<AmountChange | null>(null);
/** The last amount the expression came to, shown while it is unfinished. */
const preview = ref(0n);
const note = ref('');
const saving = ref(false);
const error = ref('');

const currency = computed(() =>
  envelopeCurrency(props.envelope.currency, props.coins),
);
const amount = computed(() => typed.value?.amount ?? null);
const hint = computed(
  () =>
    `Use − to take money out. ${
      props.envelope.plan?.mode === 'carry_over'
        ? 'It carries over to next month.'
        : 'Applies to this month only.'
    }`,
);
const hasExpression = computed(() =>
  /[+−\-×÷*/%]/.test(typed.value?.text ?? ''),
);
const shown = computed(() =>
  formatMoney(amount.value ?? preview.value, currency.value),
);
const canSave = computed(
  () => amount.value !== null && amount.value !== 0n && !saving.value,
);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (amount.value === null || amount.value === 0n) return 'Enter an amount';
  const size = formatMoney(
    amount.value < 0n ? -amount.value : amount.value,
    currency.value,
  );
  return `${amount.value < 0n ? 'Take out' : 'Add'} ${size}`;
});

function onChange(change: AmountChange): void {
  typed.value = change;
  if (change.amount !== null || change.empty)
    preview.value = change.amount ?? 0n;
}

async function save(): Promise<void> {
  if (!canSave.value || amount.value === null) return;
  saving.value = true;
  error.value = '';
  try {
    await callApi(
      'POST',
      `/api/envelopes/${props.envelope.id}/adjustments`,
      adjustmentResponseSchema,
      { amount: amount.value.toString(), note: note.value },
    );
    emit('adjusted');
    emit('close');
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not save the adjustment. Try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BbSheet title="Adjust balance" @close="emit('close')">
    <div class="adjust-display" role="group" aria-label="Amount to adjust by">
      <span class="num adjust-expr">{{
        hasExpression ? typed?.text : ''
      }}</span>
      <span
        class="num adjust-amount"
        :class="{ muted: amount === null }"
        aria-live="polite"
        aria-atomic="true"
        >{{ shown }}</span
      >
      <span class="adjust-hint">{{ hint }}</span>
    </div>
    <label class="sr" for="adjust-note">Note</label>
    <input
      id="adjust-note"
      v-model="note"
      class="text"
      type="text"
      maxlength="200"
      autocomplete="off"
      placeholder="Note, e.g. Goodbudget balance taken over"
    />
    <BbAmountInput
      class="adjust-keys"
      bare
      allow-negative
      :currency="currency"
      label="Amount"
      @change="onChange"
    />
    <p v-if="typed?.error" class="error" role="alert">{{ typed.error }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <BbButton needs-server :disabled="!canSave" @click="save">{{
      saveLabel
    }}</BbButton>
  </BbSheet>
</template>

<style scoped>
.adjust-display {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--bg);
}
.adjust-expr {
  min-height: 18px;
  font-size: 13px;
  color: var(--muted);
}
.adjust-amount {
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.adjust-amount.muted {
  color: var(--muted);
}
.adjust-hint {
  font-size: 12px;
  color: var(--muted);
}
.adjust-keys :deep(.key) {
  height: 46px;
}
</style>
