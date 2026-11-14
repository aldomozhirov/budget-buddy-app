<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  accountChipLabels,
  addOptionsResponseSchema,
  formatMoney,
  getCurrency,
  pickAccountChips,
  ratePairResponseSchema,
  recordWishResponseSchema,
  todayInTimeZone,
  type AddOptionsAccount,
  type AddOptionsResponse,
  type CoinCurrency,
  type DatedRate,
  type RecordWishResponse,
  type Wish,
} from '@budget-buddy/shared';
import AccountPickerSheet from '../../components/AccountPickerSheet.vue';
import BbAmountInput, {
  type AmountChange,
} from '../../components/BbAmountInput.vue';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbSheet from '../../components/BbSheet.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { isOnline } from '../../composables/useOnline.js';
import DateSheet from '../add/DateSheet.vue';
import MerchantSheet, { type MerchantOption } from '../add/MerchantSheet.vue';
import { accountCurrency, dayLabel, withFront } from '../add/addForm.js';
import { convertedBase, recordRateLine, sheetBase } from './recordForm.js';

/**
 * "Record as expense" (UI-WSH-5, PLN-18): the amount, the account that paid
 * (none picked), merchant, date and category rows and the "Keep the wish
 * open" switch. Saving makes the expense with no envelope, linked to the
 * wish, and tells the page what came back so it can offer Undo. It needs a
 * connection.
 */
const props = defineProps<{
  wish: Wish;
  /** The family's coins, to format amounts in a coin currency. */
  coins: readonly CoinCurrency[];
}>();

const emit = defineEmits<{
  /** The expense was saved; the answer carries the wish and its old state. */
  saved: [answer: RecordWishResponse, keepOpen: boolean];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const options = ref<AddOptionsResponse | null>(null);
const loadError = ref('');
const accountId = ref<number | null>(null);
const merchant = ref('');
const date = ref('');
const categoryId = ref<number | null>(props.wish.categoryId);
const keepOpen = ref(false);
/** The amount typed on the keypad, in the account's currency; null: none. */
const typed = ref<bigint | null>(null);
const editing = ref(false);
const keypadError = ref('');
const sheet = ref<'account' | 'merchant' | 'date' | 'category' | null>(null);
const rate = ref<DatedRate | null>(null);
const rateLoading = ref(false);
const saving = ref(false);
const saveError = ref('');
/** The client id of the last attempt, kept for a retry of the same body. */
let pending: { signature: string; clientId: string } | null = null;

const today = computed(() =>
  options.value ? todayInTimeZone(new Date(), options.value.timeZone) : '',
);
const account = computed<AddOptionsAccount | undefined>(() =>
  options.value?.accounts.find((item) => item.id === accountId.value),
);
const wishCurrency = computed(
  () =>
    getCurrency(props.wish.currency, props.coins) ?? {
      code: props.wish.currency,
      name: props.wish.currency,
      decimals: 2,
      symbol: props.wish.currency,
      kind: 'coin' as const,
    },
);
/** The currency of the amount: the account's once one is picked. */
const currency = computed(() =>
  account.value ? accountCurrency(account.value) : wishCurrency.value,
);
const base = computed(() => sheetBase(props.wish));
const converted = computed(() =>
  date.value
    ? convertedBase(
        base.value.amount,
        wishCurrency.value,
        currency.value,
        date.value,
        rate.value,
      )
    : null,
);
/** The amount the expense is saved with: typed, else the sheet's own. */
const amount = computed(() => typed.value ?? converted.value);
const otherCurrency = computed(
  () =>
    account.value !== undefined &&
    currency.value.code !== wishCurrency.value.code,
);
const rateMissing = computed(
  () => otherCurrency.value && rate.value === null && !rateLoading.value,
);
const amountText = computed(() =>
  amount.value === null ? '—' : formatMoney(amount.value, currency.value),
);
const rateLine = computed(() =>
  otherCurrency.value && rate.value
    ? recordRateLine(
        rate.value,
        wishCurrency.value.code,
        currency.value.code,
        date.value,
        today.value,
        props.coins,
      )
    : '',
);
const dateText = computed(() =>
  date.value && today.value ? dayLabel(date.value, today.value) : 'Today',
);
const categoryName = computed(
  () =>
    options.value?.categories.find((item) => item.id === categoryId.value)
      ?.name ??
    // An archived category is not offered, but the wish keeps it (O7).
    (categoryId.value === props.wish.categoryId
      ? props.wish.categoryName
      : null) ??
    'None',
);
const expenseCategories = computed(() =>
  (options.value?.categories ?? [])
    .filter((item) => item.kind === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const accountChips = computed(() => {
  const data = options.value;
  if (!data) return [];
  const ids = withFront(
    pickAccountChips(data.accounts, data.profileId).map((item) => item.id),
    accountId.value,
  );
  const row = ids
    .map((id) => data.accounts.find((item) => item.id === id))
    .filter((item): item is AddOptionsAccount => item !== undefined);
  return accountChipLabels(row, data.profileId, data.commonCurrency);
});
const merchants = computed<MerchantOption[]>(() =>
  (options.value?.merchants ?? []).map((item) => ({
    ...item,
    detail: 'Used before',
  })),
);
const recentMerchants = computed<MerchantOption[]>(() =>
  (options.value?.recentMerchants ?? []).map((item) => ({
    ...item,
    detail: 'Used before',
  })),
);
/** A wish of a coming month cannot be recorded yet: no future dates. */
const comingMonth = computed(
  () => today.value !== '' && props.wish.month > today.value.slice(0, 7),
);
const canSave = computed(
  () =>
    isOnline.value &&
    !comingMonth.value &&
    !saving.value &&
    account.value !== undefined &&
    amount.value !== null &&
    amount.value > 0n,
);
const buttonText = computed(() => {
  if (!account.value) return 'Pick the account that paid';
  if (amount.value === null || amount.value <= 0n) {
    return rateMissing.value ? 'Type the amount' : 'Enter an amount';
  }
  return `Save ${amountText.value}`;
});

onMounted(() => void load());
watch(
  () => [account.value?.currency, date.value] as const,
  () => void loadRate(),
);

/** The last day of a `YYYY-MM` month as `YYYY-MM-DD`. */
function lastDayOf(month: string): string {
  const day = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Loads the accounts, categories and merchants the form offers. */
async function load(): Promise<void> {
  loadError.value = '';
  try {
    const data = await callApi(
      'GET',
      '/api/add-options',
      addOptionsResponseSchema,
    );
    options.value = data;
    const now = todayInTimeZone(new Date(), data.timeZone);
    // A wish of an earlier month is recorded on that month's last day.
    date.value =
      props.wish.month < now.slice(0, 7) ? lastDayOf(props.wish.month) : now;
  } catch {
    loadError.value = 'Could not load the accounts. Check your connection.';
  }
}

/** Asks for the day's rate from the wish's currency to the account's. */
async function loadRate(): Promise<void> {
  const to = account.value?.currency;
  const from = props.wish.currency;
  if (!to || to === from || !date.value) {
    rate.value = null;
    rateLoading.value = false;
    return;
  }
  const asked = `${from}>${to}@${date.value}`;
  rate.value = null;
  rateLoading.value = true;
  try {
    const answer = await callApi(
      'GET',
      `/api/rates/pair?${new URLSearchParams({ from, to, date: date.value })}`,
      ratePairResponseSchema,
    );
    if (asked === `${from}>${account.value?.currency}@${date.value}`) {
      rate.value = answer.rate;
    }
  } catch {
    // No rate: the member types the amount.
  } finally {
    if (asked === `${from}>${account.value?.currency}@${date.value}`) {
      rateLoading.value = false;
    }
  }
}

/** Picking another account starts the amount over from the wish's. */
function pickAccount(id: number): void {
  accountId.value = id;
  typed.value = null;
  keypadError.value = '';
}

function onChange(change: AmountChange): void {
  keypadError.value = change.error;
  if (change.empty) typed.value = null;
  else if (change.amount !== null) typed.value = change.amount;
}

/** Saves the expense; a retry of the same body keeps its client id. */
async function save(): Promise<void> {
  if (!canSave.value || !account.value || amount.value === null) return;
  const body = {
    amount: amount.value.toString(),
    accountId: account.value.id,
    ...(merchant.value ? { merchant: merchant.value } : {}),
    date: date.value,
    // Left out while unchanged: the wish may keep an archived category.
    ...(categoryId.value === props.wish.categoryId
      ? {}
      : { categoryId: categoryId.value }),
    keepOpen: keepOpen.value,
  };
  const signature = JSON.stringify(body);
  if (pending?.signature !== signature) {
    pending = { signature, clientId: crypto.randomUUID() };
  }
  saving.value = true;
  saveError.value = '';
  try {
    const answer = await callApi(
      'POST',
      `/api/wishes/${props.wish.id}/record`,
      recordWishResponseSchema,
      { ...body, clientId: pending.clientId },
    );
    emit('saved', answer, keepOpen.value);
  } catch (cause) {
    saveError.value =
      cause instanceof ApiError && cause.status !== 0
        ? (Object.values(cause.fields)[0] ?? cause.message)
        : 'Could not reach the server. Check your connection and try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BbSheet
    title="Record as expense"
    :subtitle="`${wish.name} · no envelope`"
    tall
    :top="96"
    @close="emit('close')"
  >
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <p v-else-if="!options" class="t-sub" role="status">Loading…</p>
    <div v-else class="rec-body scroll">
      <button
        class="rec-amt"
        :class="{ 'rec-amt-on': editing }"
        type="button"
        :aria-label="`Amount ${amountText}. Change`"
        :aria-pressed="editing"
        @click="editing = !editing"
      >
        <span class="num rec-amt-v">{{ amountText }}</span>
        <span class="rec-amt-l">{{
          typed !== null ? 'Typed' : base.label
        }}</span>
      </button>
      <p v-if="rateLine" class="num t-sub rec-rate">{{ rateLine }}</p>
      <p v-else-if="rateMissing" class="t-sub rec-rate warn">Rate missing</p>
      <p v-if="keypadError" class="error" role="alert">{{ keypadError }}</p>

      <div class="rec-field">
        <span class="lbl" :class="{ warn: !account }"
          >Paid from · pick the account that paid</span
        >
        <BbChipGroup
          :model-value="accountId ?? 0"
          :options="
            accountChips.map((chip) => ({
              label: chip.label,
              value: chip.account.id,
            }))
          "
          label="Paid from"
          @update:model-value="pickAccount(Number($event))"
        >
          <template #trailing>
            <BbChip
              variant="ghost"
              aria-label="All accounts"
              @click="sheet = 'account'"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>

      <div class="rec-rows">
        <button
          class="field"
          type="button"
          aria-haspopup="dialog"
          @click="sheet = 'merchant'"
        >
          <span class="field-l">Merchant</span>
          <span class="field-v" :class="{ 'rec-optional': !merchant }">{{
            merchant || 'Optional'
          }}</span>
        </button>
        <button
          class="field"
          type="button"
          aria-haspopup="dialog"
          @click="sheet = 'date'"
        >
          <span class="field-l">Date</span>
          <span class="field-v">{{ dateText }}</span>
        </button>
        <button
          class="field rec-last"
          type="button"
          aria-haspopup="dialog"
          @click="sheet = 'category'"
        >
          <span class="field-l">Category</span>
          <span class="field-v">{{ categoryName }}</span>
        </button>
      </div>

      <button
        class="rec-keep"
        type="button"
        role="switch"
        :aria-checked="keepOpen"
        @click="keepOpen = !keepOpen"
      >
        <span class="rec-keep-text">
          <span class="rec-keep-t">Keep the wish open</span>
          <span class="t-sub"
            >For more spending on it later. Off: it’s ticked off as done.</span
          >
        </span>
        <span class="switch" :aria-checked="keepOpen"
          ><span class="knob"
        /></span>
      </button>
    </div>

    <BbAmountInput
      v-if="options && editing"
      bare
      :currency="currency"
      :initial-amount="amount"
      label="Amount"
      @change="onChange"
    />
    <p v-if="comingMonth" class="t-sub" role="status">
      This wish is for a coming month. Record it once the month starts.
    </p>
    <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>
    <BbButton class="num" :disabled="!canSave" @click="save">{{
      isOnline ? buttonText : 'Recording needs a connection'
    }}</BbButton>

    <AccountPickerSheet
      v-if="sheet === 'account' && options"
      :accounts="options.accounts"
      :selected-id="accountId"
      :profile-id="options.profileId"
      title="Paid from"
      @pick="
        (item) => {
          if (item) pickAccount(item.id);
          sheet = null;
        }
      "
      @close="sheet = null"
    />
    <MerchantSheet
      v-if="sheet === 'merchant'"
      :merchants="merchants"
      :recent="recentMerchants"
      :selected="merchant"
      @pick="
        (value) => {
          merchant = value;
          sheet = null;
        }
      "
      @close="sheet = null"
    />
    <DateSheet
      v-if="sheet === 'date'"
      :date="date"
      :today="today"
      @pick="
        (value) => {
          date = value;
          typed = null;
          sheet = null;
        }
      "
      @close="sheet = null"
    />
    <CategoryPickerSheet
      v-if="sheet === 'category'"
      :categories="expenseCategories"
      :selected-id="categoryId"
      @pick="
        (item) => {
          categoryId = item.id;
          sheet = null;
        }
      "
      @close="sheet = null"
    />
  </BbSheet>
</template>

<style scoped>
.rec-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rec-amt {
  width: 100%;
  height: 52px;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  text-align: left;
}
.rec-amt-on {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}
.rec-amt-v {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
}
.rec-amt-l {
  font-size: 12px;
  color: var(--muted);
}
.rec-rate {
  margin: -8px 0 0;
}
.rec-rate.warn {
  color: var(--warn);
}
.rec-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rec-rows {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--bg);
  padding: 0 14px;
}
.rec-last {
  border-bottom: 0;
}
.rec-optional {
  color: var(--muted);
  font-weight: 400;
}
.rec-keep {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  text-align: left;
}
.rec-keep-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.rec-keep-t {
  font-weight: 500;
}
</style>
