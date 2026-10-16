<script
  setup
  lang="ts"
  generic="
    T extends Pick<Envelope, 'id' | 'name'> &
      Partial<Pick<Envelope, 'currency' | 'plan' | 'current'>>
  "
>
import {
  formatMoney,
  type CoinSetting,
  type Envelope,
} from '@budget-buddy/shared';
import {
  envelopeCurrency,
  modeLabel,
} from '../screens/envelopes/envelopeFormat.js';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';

/**
 * Sheet behind an envelope chip row's "All…" (UI-NAV-7, UI-TXN-4): every
 * active envelope with its mode and what is left, and "None" to clear the
 * choice. The Add form knows no amounts (D3), so an envelope without
 * `current` shows its name only. One pick closes it.
 */
const props = defineProps<{
  /** The active envelopes, in the family's order. */
  envelopes: T[];
  /** Coins of the family, to write each envelope's amount. */
  coins: CoinSetting[];
  /** The id that is selected now, or null for none. */
  selectedId: number | null;
}>();

const emit = defineEmits<{
  /** An envelope was picked, or null for "None". */
  pick: [envelope: T | null];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

function detail(envelope: T): string {
  if (!('current' in envelope) || envelope.currency === undefined) return '';
  const left = formatMoney(
    BigInt(envelope.current?.closing ?? '0'),
    envelopeCurrency(envelope.currency, props.coins),
  );
  return `${modeLabel(envelope.plan?.mode ?? 'reset')} · ${left} left`;
}
</script>

<template>
  <BbSheet title="Envelope" @close="emit('close')">
    <div class="picker-list scroll" role="radiogroup" aria-label="Envelope">
      <button
        class="opt"
        type="button"
        role="radio"
        :aria-checked="selectedId === null"
        @click="emit('pick', null)"
      >
        <span class="picker-name">None</span>
        <BbIcon v-if="selectedId === null" name="check" :size="18" />
      </button>
      <h4 class="t-group">All envelopes</h4>
      <button
        v-for="envelope in envelopes"
        :key="envelope.id"
        class="opt"
        type="button"
        role="radio"
        :aria-checked="envelope.id === selectedId"
        @click="emit('pick', envelope)"
      >
        <span class="picker-text">
          <span class="picker-name">{{ envelope.name }}</span>
          <span v-if="detail(envelope)" class="num t-sub">{{
            detail(envelope)
          }}</span>
        </span>
        <BbIcon v-if="envelope.id === selectedId" name="check" :size="18" />
      </button>
    </div>
  </BbSheet>
</template>

<style scoped>
.picker-list {
  max-height: 55dvh;
  overflow-y: auto;
}
.picker-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.picker-name {
  flex: 1;
  font-weight: 500;
}
</style>
