<script setup lang="ts">
import { computed } from 'vue';
import type { CoinCurrency } from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import type { OutboxItem } from '../../offline/outbox.js';
import { PAGE_WORDS } from './transactionPage.js';
import { money } from './transactionsFormat.js';
import { outboxTag, typedInText } from './outboxRows.js';

/**
 * The details of an item still on the phone (UI-TXN-9): amount, merchant,
 * accounts, category and who typed it when; for a refused one the server's
 * message and a hint. "Delete" takes it off the phone, "Keep it" closes.
 */
const props = defineProps<{
  item: OutboxItem;
  coins: readonly CoinCurrency[];
  /** `YYYY-MM-DD` in the family time zone. */
  today: string;
  timeZone: string;
  /** A delete is under way. */
  busy: boolean;
}>();

const emit = defineEmits<{
  /** "Delete" was pressed. */
  delete: [];
  /** "Keep it", the close button or a dismissal. */
  close: [];
}>();

const words = computed(() => PAGE_WORDS[props.item.body.kind]);
const rows = computed(() => {
  const { body, names } = props.item;
  const list: { label: string; value: string }[] = [
    { label: 'Amount', value: money(body.amount, names.currency, props.coins) },
  ];
  if (body.kind === 'transfer' && body.toAmount && names.toCurrency) {
    list.push({
      label: 'Arrives',
      value: money(body.toAmount, names.toCurrency, props.coins),
    });
  }
  if (body.merchant) list.push({ label: 'Merchant', value: body.merchant });
  list.push({ label: words.value.fromLabel, value: names.account });
  if (names.toAccount) list.push({ label: 'To', value: names.toAccount });
  if (names.category) list.push({ label: 'Category', value: names.category });
  if (names.envelope && names.envelope !== names.category) {
    list.push({ label: 'Envelope', value: names.envelope });
  }
  if (body.note) list.push({ label: 'Note', value: body.note });
  list.push({
    label: 'Typed in',
    value: typedInText(props.item, props.today, props.timeZone),
  });
  return list;
});
</script>

<template>
  <BbSheet :title="outboxTag(item)" @close="emit('close')">
    <p class="t-sub outbox-sub">{{ words.title }} · on this phone</p>
    <div v-if="item.state === 'failed'" class="outbox-error" role="alert">
      <BbIcon name="alert" :size="20" />
      <span class="outbox-error-text">{{ item.error }}</span>
    </div>
    <div class="outbox-rows">
      <div v-for="row in rows" :key="row.label" class="outbox-kv">
        <span class="t-sub">{{ row.label }}</span>
        <span class="num outbox-value">{{ row.value }}</span>
      </div>
    </div>
    <p v-if="item.state === 'failed'" class="t-sub outbox-hint">
      It won’t be sent again by itself. Delete it here and type it again with
      another account.
    </p>
    <BbButton class="outbox-delete" :disabled="busy" @click="emit('delete')">
      Delete
    </BbButton>
    <BbButton variant="secondary" class="outbox-keep" @click="emit('close')">
      Keep it
    </BbButton>
  </BbSheet>
</template>

<style scoped>
.outbox-sub {
  margin: -10px 0 0;
  font-size: 13px;
}
.outbox-error {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 14px;
  font-weight: 500;
}
.outbox-error :deep(svg) {
  flex: none;
}
.outbox-error-text {
  flex: 1;
}
.outbox-rows {
  display: flex;
  flex-direction: column;
  padding: 0 2px;
}
.outbox-kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.outbox-kv .t-sub {
  font-size: 14px;
}
.outbox-value {
  font-weight: 500;
  text-align: right;
}
.outbox-hint {
  margin: 0;
  font-size: 13px;
}
.bb .outbox-delete {
  background: var(--warn);
  color: var(--surface);
}
.bb .outbox-keep {
  background: var(--bg);
}
</style>
