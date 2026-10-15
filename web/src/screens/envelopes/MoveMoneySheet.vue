<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  formatMoney,
  moveResponseSchema,
  type CoinSetting,
  type Envelope,
} from '@budget-buddy/shared';
import BbAmountInput from '../../components/BbAmountInput.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbSheet from '../../components/BbSheet.vue';
import { callApi, EnvelopeApiError } from './envelopeApi.js';
import { envelopeCurrency } from './envelopeFormat.js';

/**
 * The move sheet (UI-ENV-5, UI-ENV-9): "From" and "To" chips, only envelopes
 * of one currency (O5), the keypad, what the source has left and the action.
 */
const props = defineProps<{
  /** The active envelopes. */
  envelopes: Envelope[];
  coins: CoinSetting[];
  /** The envelope to take from when the sheet opens. */
  fromId?: number;
}>();

const emit = defineEmits<{
  /** The money was moved. */
  moved: [];
  /** Close button, scrim tap, swipe down, or after the move. */
  close: [];
}>();

const from = ref(props.fromId ?? props.envelopes[0]?.id ?? 0);
const to = ref(0);
const amount = ref<bigint | null>(null);
const saving = ref(false);
const error = ref('');

const source = computed(() =>
  props.envelopes.find((item) => item.id === from.value),
);
const targets = computed(() =>
  props.envelopes.filter(
    (item) =>
      item.id !== from.value && item.currency === source.value?.currency,
  ),
);
const target = computed(
  () => targets.value.find((item) => item.id === to.value) ?? targets.value[0],
);
const currency = computed(() =>
  envelopeCurrency(source.value?.currency ?? 'EUR', props.coins),
);
const left = computed(() => BigInt(source.value?.current?.closing ?? '0'));
const hint = computed(() =>
  source.value
    ? `${source.value.name} has ${formatMoney(left.value, currency.value)} left`
    : '',
);
const belowZero = computed(
  () => amount.value !== null && amount.value > left.value,
);
const saveLabel = computed(() =>
  saving.value
    ? 'Moving…'
    : `Move ${formatMoney(amount.value ?? 0n, currency.value)} to ${
        target.value?.name ?? '…'
      }`,
);

async function move(value: bigint): Promise<void> {
  if (saving.value || !source.value || !target.value) return;
  if (value <= 0n) {
    error.value = 'Enter an amount above zero.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await callApi('POST', '/api/envelopes/moves', moveResponseSchema, {
      fromEnvelopeId: source.value.id,
      toEnvelopeId: target.value.id,
      amount: value.toString(),
    });
    emit('moved');
    emit('close');
  } catch (cause) {
    error.value =
      cause instanceof EnvelopeApiError
        ? cause.message
        : 'Could not move the money. Try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BbSheet title="Move money" @close="emit('close')">
    <div class="move-field">
      <span class="lbl">From</span>
      <BbChipGroup
        v-model="from"
        label="From"
        :options="
          envelopes.map((item) => ({ label: item.name, value: item.id }))
        "
      />
    </div>
    <div class="move-field">
      <span class="lbl">To</span>
      <BbChipGroup
        v-if="targets.length"
        :model-value="target?.id ?? 0"
        label="To"
        :options="targets.map((item) => ({ label: item.name, value: item.id }))"
        @update:model-value="to = Number($event)"
      />
      <span v-else class="t-sub"
        >No other envelope in {{ currency.code }}.</span
      >
    </div>
    <BbAmountInput
      v-if="source"
      class="move-amount"
      :currency="currency"
      :hint="hint"
      :hint-warn="belowZero"
      :save-label="saveLabel"
      :saving="saving"
      needs-server
      label="Amount to move"
      @update:amount="amount = $event"
      @save="move"
    />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </BbSheet>
</template>

<style scoped>
.move-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.move-amount :deep(.amount-entry-display) {
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--bg);
  text-align: left;
}
.move-amount :deep(.amount) {
  font-size: 32px;
  letter-spacing: -0.02em;
}
.move-amount :deep(.key) {
  height: 46px;
}
</style>
