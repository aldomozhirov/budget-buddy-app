<script setup lang="ts">
import {
  formatMoney,
  type CoinSetting,
  type Envelope,
  type Wish,
} from '@budget-buddy/shared';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import { envelopeCurrency, modeLabel } from '../envelopes/envelopeFormat.js';

/**
 * The transaction page's "Counts for" sheet (PLN-14, UI-TXN-10): pick one of
 * the active envelopes, one of the wishes of the expense's month, or
 * neither. The current choice has the check. A pick is reported and the
 * parent closes the sheet. Slot `after`: the keypad of "Counts in the
 * envelope as" or "Counts for the wish as", which also keeps the list short.
 * The current wish's name opens it.
 */
const props = defineProps<{
  /** The active envelopes, in the family's order. */
  envelopes: Envelope[];
  /** The wishes of the expense's month that can be linked to. */
  wishes: Wish[];
  /** Coins of the family, to write the amounts. */
  coins: CoinSetting[];
  /** The month's name for the group, such as "October". */
  monthName: string;
  /** The envelope the expense is charged to, or null. */
  envelopeId: number | null;
  /** The wish it counts for, or null. */
  wishId: number | null;
  /** That wish's name, for the link that opens it. */
  wishName?: string | undefined;
}>();

const emit = defineEmits<{
  /** An envelope was picked. */
  envelope: [envelope: Envelope];
  /** A wish was picked. */
  wish: [wish: Wish];
  /** "Unplanned" was picked. */
  none: [];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

/** "Resets monthly · €187.60 left", or "· −€14.50 overspent". */
function envelopeDetail(envelope: Envelope): string {
  const closing = BigInt(envelope.current?.closing ?? '0');
  const currency = envelopeCurrency(envelope.currency, props.coins);
  const mode = modeLabel(envelope.plan?.mode ?? 'reset');
  return closing < 0n
    ? `${mode} · ${formatMoney(closing, currency)} overspent`
    : `${mode} · ${formatMoney(closing, currency)} left`;
}

/** "€480.00 · nothing spent yet" or "€350.00 · €120.00 spent". */
function wishDetail(wish: Wish): string {
  const currency = envelopeCurrency(wish.currency, props.coins);
  const amount = formatMoney(BigInt(wish.amount), currency);
  if (wish.incomplete) return `${amount} · rate missing`;
  if (BigInt(wish.spent) === 0n && wish.expenseCount === 0) {
    return `${amount} · nothing spent yet`;
  }
  return `${amount} · ${formatMoney(BigInt(wish.spent), currency)} spent`;
}

const none = () => props.envelopeId === null && props.wishId === null;
</script>

<template>
  <BbSheet
    title="Counts for"
    tall
    :top="96"
    :subtitle="`Pick one: an envelope, one of ${monthName}’s wishes, or neither. The category stays.`"
    @close="emit('close')"
  >
    <div class="picker-list scroll" :class="{ 'picker-short': $slots.after }">
      <div role="radiogroup" aria-label="Envelopes">
        <h4 class="t-group">Envelopes</h4>
        <button
          v-for="envelope in envelopes"
          :key="envelope.id"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="envelope.id === envelopeId"
          @click="emit('envelope', envelope)"
        >
          <span class="picker-text">
            <span class="picker-name">{{ envelope.name }}</span>
            <span class="num t-sub">{{ envelopeDetail(envelope) }}</span>
          </span>
          <BbIcon
            v-if="envelope.id === envelopeId"
            class="picker-check"
            name="check"
            :size="20"
            :stroke-width="2.4"
          />
        </button>
      </div>
      <div role="radiogroup" aria-label="Wishes">
        <h4 class="t-group">Wishes in {{ monthName }}</h4>
        <p v-if="!wishes.length" class="t-sub picker-empty">
          No wishes in {{ monthName }}.
        </p>
        <button
          v-for="wish in wishes"
          :key="wish.id"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="wish.id === wishId"
          @click="emit('wish', wish)"
        >
          <span class="picker-text">
            <span class="picker-name">{{ wish.name }}</span>
            <span class="num t-sub">{{ wishDetail(wish) }}</span>
          </span>
          <BbIcon
            v-if="wish.id === wishId"
            class="picker-check"
            name="check"
            :size="20"
            :stroke-width="2.4"
          />
        </button>
      </div>
      <div role="radiogroup" aria-label="Neither">
        <h4 class="t-group">Neither</h4>
        <button
          class="opt"
          type="button"
          role="radio"
          :aria-checked="none()"
          @click="emit('none')"
        >
          <span class="picker-text">
            <span class="picker-name">Unplanned</span>
            <span class="t-sub">No envelope and no wish</span>
          </span>
          <BbIcon
            v-if="none()"
            class="picker-check"
            name="check"
            :size="20"
            :stroke-width="2.4"
          />
        </button>
      </div>
    </div>
    <RouterLink
      v-if="wishId !== null"
      class="text-btn picker-open"
      :to="`/wishes/${wishId}`"
      >Open
      {{
        wishName ??
        wishes.find((wish) => wish.id === wishId)?.name ??
        'the wish'
      }}</RouterLink
    >
    <slot name="after" />
  </BbSheet>
</template>

<style scoped>
.picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.picker-list .t-group:first-child {
  margin-top: 20px;
}
.picker-check {
  color: var(--accent);
}
.picker-open {
  align-self: flex-start;
}
.picker-empty {
  margin: 0;
  padding: 8px 0;
}
.picker-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.picker-name {
  font-weight: 500;
}
</style>
