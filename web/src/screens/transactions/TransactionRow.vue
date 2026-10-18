<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { CoinCurrency, ListedTransaction } from '@budget-buddy/shared';
import BbTag from '../../components/BbTag.vue';
import { describeRow } from './transactionsFormat.js';

/**
 * One transaction of the list (UI-TXN-2): merchant or category over a meta
 * line, the signed amount and the "No category" tag. It is a plain row until
 * `to` is given, when it becomes a link to the transaction page, or
 * `onPhone`, when it is a button that opens the item's sheet. Slot `tags`:
 * more tags under the amount (such as "Waiting to send").
 */
const props = defineProps<{
  row: ListedTransaction;
  /** The family's own coins, to read the currency of the amount. */
  coins: readonly CoinCurrency[];
  /** Where the row leads; the row is not a link without it. */
  to?: string;
  /**
   * An item still on the phone (UI-TXN-9): a muted amount, no "No
   * category" tag, and a button that emits `open`.
   */
  onPhone?: boolean;
}>();

const emit = defineEmits<{
  /** An `onPhone` row was tapped. */
  open: [];
}>();

const text = computed(() => describeRow(props.row, props.coins));
</script>

<template>
  <component
    :is="to ? RouterLink : onPhone ? 'button' : 'div'"
    class="row transaction-row"
    :class="{ 'transaction-on-phone': onPhone }"
    :to="to"
    :type="onPhone ? 'button' : undefined"
    :aria-haspopup="onPhone ? 'dialog' : undefined"
    data-testid="transaction-row"
    @click="onPhone && emit('open')"
  >
    <span class="row-l">
      <span class="transaction-title">{{ text.title }}</span>
      <span class="t-sub transaction-meta">{{ text.meta }}</span>
    </span>
    <span class="transaction-right">
      <span
        class="num transaction-amount"
        :class="onPhone ? 'tone-neutral' : `tone-${text.tone}`"
        >{{ text.amount }}</span
      >
      <span v-if="text.arrives" class="num t-sub">{{ text.arrives }}</span>
      <BbTag v-if="text.noCategory && !onPhone" tone="warn">No category</BbTag>
      <slot name="tags" />
    </span>
  </component>
</template>

<style scoped>
.transaction-row {
  min-height: 42px;
  color: inherit;
  text-decoration: none;
}
.transaction-on-phone {
  width: 100%;
  text-align: left;
}
.transaction-title,
.transaction-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.transaction-title {
  font-weight: 500;
}
.transaction-meta {
  font-size: 13px;
}
.transaction-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex: none;
}
.transaction-amount {
  font-weight: 500;
}
.tone-in {
  color: var(--accent);
}
.tone-neutral {
  color: var(--muted);
}
</style>
