<script
  setup
  lang="ts"
  generic="
    E extends Pick<Envelope, 'id' | 'name'> &
      Partial<Pick<Envelope, 'currency' | 'plan' | 'current'>>,
    W extends AddOptionsWish &
      Partial<Pick<Wish, 'incomplete' | 'expenseCount'>>
  "
>
import { computed, ref } from 'vue';
import {
  formatMoney,
  type AddOptionsWish,
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
 * The current wish's name opens it. The search box narrows the three groups
 * by name (UI-ADD-17). An envelope without `current` shows its name only.
 */
const props = defineProps<{
  /** The active envelopes, in the family's order. */
  envelopes: E[];
  /** The wishes of the expense's month that can be linked to. */
  wishes: W[];
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
  /**
   * Whether "Unplanned" is the choice. By default it is when no envelope and
   * no wish is; the Add form says so itself, since empty means the
   * category's default there (UI-ADD-10).
   */
  unplanned?: boolean | undefined;
  /** The Add form's sheet: no subtitle and no link away from the form. */
  onForm?: boolean | undefined;
}>();

const emit = defineEmits<{
  /** An envelope was picked. */
  envelope: [envelope: E];
  /** A wish was picked. */
  wish: [wish: W];
  /** "Unplanned" was picked. */
  none: [];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

/** "Resets monthly · €187.60 left", or "· −€14.50 overspent". */
function envelopeDetail(envelope: E): string {
  if (!envelope.current) return '';
  const closing = BigInt(envelope.current?.closing ?? '0');
  const currency = envelopeCurrency(envelope.currency ?? 'EUR', props.coins);
  const mode = modeLabel(envelope.plan?.mode ?? 'reset');
  return closing < 0n
    ? `${mode} · ${formatMoney(closing, currency)} overspent`
    : `${mode} · ${formatMoney(closing, currency)} left`;
}

/** "€480.00 · nothing spent yet" or "€350.00 · €120.00 spent". */
function wishDetail(wish: W): string {
  const currency = envelopeCurrency(wish.currency, props.coins);
  const amount = formatMoney(BigInt(wish.amount), currency);
  if (wish.incomplete) return `${amount} · rate missing`;
  if (BigInt(wish.spent) === 0n && (wish.expenseCount ?? 0) === 0) {
    return `${amount} · nothing spent yet`;
  }
  return `${amount} · ${formatMoney(BigInt(wish.spent), currency)} spent`;
}

const none = () =>
  props.unplanned ?? (props.envelopeId === null && props.wishId === null);

const query = ref('');
const matches = (name: string) =>
  name.toLowerCase().includes(query.value.trim().toLowerCase());
const shownEnvelopes = computed(() =>
  props.envelopes.filter((item) => matches(item.name)),
);
const shownWishes = computed(() =>
  props.wishes.filter((item) => matches(item.name)),
);
const searching = computed(() => query.value.trim() !== '');
const showNone = computed(() => !searching.value || matches('Unplanned'));
const nothingFound = computed(
  () =>
    searching.value &&
    !shownEnvelopes.value.length &&
    !shownWishes.value.length &&
    !showNone.value,
);
</script>

<template>
  <BbSheet
    title="Counts for"
    tall
    :top="96"
    :subtitle="
      onForm
        ? ''
        : `Pick one: an envelope, one of ${monthName}’s wishes, or neither. The category stays.`
    "
    @close="emit('close')"
  >
    <div class="input-wrap">
      <BbIcon name="search" :size="18" />
      <input
        v-model="query"
        class="search"
        type="search"
        autocomplete="off"
        aria-label="Counts for"
        placeholder="Search envelopes and wishes"
      />
    </div>
    <div class="picker-list scroll" :class="{ 'picker-short': $slots.after }">
      <p v-if="nothingFound" class="t-sub picker-empty" role="status">
        Nothing matches.
      </p>
      <div
        v-if="!searching || shownEnvelopes.length"
        role="radiogroup"
        aria-label="Envelopes"
      >
        <h4 class="t-group">Envelopes</h4>
        <button
          v-for="envelope in shownEnvelopes"
          :key="envelope.id"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="envelope.id === envelopeId"
          @click="emit('envelope', envelope)"
        >
          <span class="picker-text">
            <span class="picker-name">{{ envelope.name }}</span>
            <span v-if="envelope.current" class="num t-sub">{{
              envelopeDetail(envelope)
            }}</span>
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
      <div
        v-if="!searching || shownWishes.length"
        role="radiogroup"
        aria-label="Wishes"
      >
        <h4 class="t-group">Wishes in {{ monthName }}</h4>
        <p v-if="!wishes.length" class="t-sub picker-empty">
          No wishes in {{ monthName }}.
        </p>
        <button
          v-for="wish in shownWishes"
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
      <div v-if="showNone" role="radiogroup" aria-label="Neither">
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
      v-if="wishId !== null && !onForm"
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
.input-wrap {
  flex: none;
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
