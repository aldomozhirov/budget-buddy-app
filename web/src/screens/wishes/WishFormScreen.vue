<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  accountsResponseSchema,
  categoriesResponseSchema,
  currenciesResponseSchema,
  formatMoney,
  monthOfDate,
  restoreWishResponseSchema,
  settingsResponseSchema,
  todayInTimeZone,
  wishResponseSchema,
  type Category,
  type CoinSetting,
  type CurrencyOption,
  type Wish,
  type WishState,
} from '@budget-buddy/shared';
import BbAmountInput, {
  type AmountChange,
} from '../../components/BbAmountInput.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import CurrencyPickerSheet from '../../components/CurrencyPickerSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { useBack } from '../../composables/useBack.js';
import { leaveToPast } from '../../router/index.js';
import { envelopeCurrency, monthName } from '../envelopes/envelopeFormat.js';
import { pendingWishMessage } from './wishMessage.js';

/**
 * The new and edit wish page (UI-WSH-3): name, amount on the keypad with
 * the typed expression under the result (PLN-16), currency, category and
 * note. `/wishes/new?month=` and `/wishes/:id/edit` open it. Editing ends
 * with "Drop" ("Bring back") and "Delete", which act at once and leave a
 * message with Undo on Wishes. It needs a connection (UI-WSH-7).
 */
defineOptions({ name: 'WishFormScreen' });

const CHANGED = 'Someone changed it meanwhile.';
const NAME_MAX = 80;
const NOTE_MAX = 500;
const EXPRESSION_PATTERN = /^[0-9 +\-−×÷*/().,]{1,120}$/u;

const route = useRoute();
const { label: backLabel, goBack } = useBack();
const editing = route.name === 'EditWish';

const loading = ref(true);
const loadError = ref('');
const wish = ref<Wish | null>(null);
const month = ref('');
const currencies = ref<CurrencyOption[]>([]);
const coins = ref<CoinSetting[]>([]);
const categories = ref<Category[]>([]);
const quickCodes = ref<string[]>([]);
const commonCurrency = ref('EUR');

const name = ref('');
const note = ref('');
const currencyCode = ref('');
const amount = ref(0n);
/** What the member typed for the amount, when it was a calculation. */
const expression = ref<string | null>(null);
const categoryId = ref(0);

const keypadOpen = ref(false);
const typed = ref<AmountChange | null>(null);
const currencySheet = ref(false);
const categorySheet = ref(false);
const saving = ref(false);
const error = ref('');
const nameError = ref('');

const currency = computed(() =>
  envelopeCurrency(currencyCode.value || commonCurrency.value, coins.value),
);
const keypadInvalid = computed(() => typed.value?.valid === false);
const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    amount.value > 0n &&
    !loading.value &&
    !saving.value &&
    !keypadInvalid.value,
);
const title = editing ? 'Edit wish' : 'New wish';
const subtitle = computed(() =>
  month.value ? `For ${monthName(month.value)}` : '',
);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (!name.value.trim()) return 'Name the wish';
  if (amount.value <= 0n) return 'Enter the amount';
  return editing ? 'Save' : `Add ${formatMoney(amount.value, currency.value)}`;
});
const OPERATOR = /[+−\-×÷*/]/u;
/** The result: the keypad's own text while a plain number is typed. */
const amountText = computed(() =>
  keypadOpen.value && typed.value && !OPERATOR.test(typed.value.text)
    ? typed.value.text
    : formatMoney(amount.value, currency.value),
);
/** The calculation under the result: live while typing (PLN-16). */
const expressionText = computed(() =>
  keypadOpen.value && typed.value && OPERATOR.test(typed.value.text)
    ? typed.value.text
    : expression.value,
);

const currencyChips = computed(() => {
  const chips = quickCodes.value.slice(0, 3);
  if (currencyCode.value && !chips.includes(currencyCode.value)) {
    chips.unshift(currencyCode.value);
    chips.splice(3);
  }
  return chips.map((code) => ({ label: code, value: code }));
});
const activeCategories = computed(() =>
  categories.value.filter((item) => item.kind === 'expense' && !item.archived),
);
const categoryChips = computed(() => {
  const ranked = [...activeCategories.value].sort(
    (a, b) => b.usedThisYear - a.usedThisYear || a.position - b.position,
  );
  const chips = ranked.slice(0, 3);
  const picked = ranked.find((item) => item.id === categoryId.value);
  if (picked && !chips.includes(picked)) {
    chips.unshift(picked);
    chips.splice(3);
  }
  return [
    { label: 'None', value: 0 },
    ...chips.map((item) => ({ label: item.name, value: item.id })),
  ];
});
const dropped = computed(() => wish.value?.state === 'dropped');
const dangerHint = computed(() =>
  (wish.value?.expenseCount ?? 0) > 0
    ? 'It has expenses: deleting it unlinks them, and they count as unplanned.'
    : 'Drop keeps it in the list as not bought; Delete removes it.',
);

// An unfinished expression must not block Save once the keypad is away: the
// field then shows its last valid value.
watch(keypadOpen, (open) => {
  if (!open) typed.value = null;
});

onMounted(() => void load());

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [currencyData, settings, accounts, categoryData, detail] =
      await Promise.all([
        callApi('GET', '/api/currencies', currenciesResponseSchema),
        callApi('GET', '/api/settings', settingsResponseSchema),
        callApi('GET', '/api/accounts', accountsResponseSchema),
        callApi('GET', '/api/categories', categoriesResponseSchema),
        editing
          ? callApi(
              'GET',
              `/api/wishes/${String(route.params.id)}`,
              wishResponseSchema,
            )
          : Promise.resolve(null),
      ]);
    currencies.value = currencyData.currencies;
    coins.value = currencyData.coins;
    commonCurrency.value = settings.commonCurrency;
    categories.value = categoryData.categories;
    const counts = new Map<string, number>();
    for (const account of accounts.accounts) {
      counts.set(account.currency, (counts.get(account.currency) ?? 0) + 1);
    }
    quickCodes.value = [
      settings.commonCurrency,
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code]) => code)
        .filter((code) => code !== settings.commonCurrency),
    ];
    if (detail) {
      wish.value = detail.wish;
      month.value = detail.wish.month;
      name.value = detail.wish.name;
      note.value = detail.wish.note ?? '';
      currencyCode.value = detail.wish.currency;
      amount.value = BigInt(detail.wish.amount);
      expression.value = detail.wish.expression;
      categoryId.value = detail.wish.categoryId ?? 0;
    } else {
      const wanted = route.query.month;
      month.value =
        typeof wanted === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(wanted)
          ? wanted
          : monthOfDate(todayInTimeZone(new Date(), settings.timeZone));
      currencyCode.value = settings.commonCurrency;
    }
  } catch (cause) {
    loadError.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the wish form. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

/** Puts the keypad on the amount, empty so that typing replaces it. */
function toggleKeypad(): void {
  keypadOpen.value = !keypadOpen.value;
  typed.value = null;
}

function onAmountChange(change: AmountChange): void {
  typed.value = change;
  if (!change.valid) return;
  amount.value = change.amount ?? 0n;
  expression.value = OPERATOR.test(change.text) ? change.text : null;
}

function pickCurrency(code: string): void {
  currencyCode.value = code;
  currencySheet.value = false;
  // The amount keeps its number, so what was typed must be read again.
  typed.value = null;
}

function pickCategory(category: Category): void {
  if (!categories.value.some((item) => item.id === category.id)) {
    categories.value = [...categories.value, category];
  }
  categoryId.value = category.id;
  categorySheet.value = false;
}

function messageFor(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0
    ? cause.message
    : 'Could not reach the server. Check your connection and try again.';
}

/** The expression to keep: only what the server accepts (PLN-16). */
function storedExpression(): string | null {
  const text = expression.value;
  return text && EXPRESSION_PATTERN.test(text) ? text : null;
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  nameError.value = '';
  const body = {
    name: name.value.trim(),
    amount: amount.value.toString(),
    expression: storedExpression(),
    currency: currencyCode.value,
    categoryId: categoryId.value || null,
    note: note.value.trim() || null,
  };
  try {
    if (wish.value) {
      await callApi(
        'PATCH',
        `/api/wishes/${wish.value.id}`,
        wishResponseSchema,
        body,
      );
      goBack();
    } else {
      await callApi('POST', '/api/wishes', wishResponseSchema, {
        ...body,
        month: month.value,
      });
      pendingWishMessage.value = {
        text: `${body.name} added to ${monthName(month.value)}.`,
        undo: null,
        month: month.value,
      };
      goBack();
    }
  } catch (cause) {
    if (cause instanceof ApiError && cause.fields.name) {
      nameError.value = cause.fields.name;
    } else {
      error.value = messageFor(cause);
    }
  } finally {
    saving.value = false;
  }
}

/** Leaves for Wishes at the wish's month, past the wish's own page. */
async function leave(item: Wish): Promise<void> {
  await leaveToPast('/wishes', `/wishes/${item.id}`);
}

/** Sets the state of the wish; Undo sets the previous one back. */
async function changeState(next: WishState, text: string): Promise<void> {
  const item = wish.value;
  if (!item || saving.value) return;
  const previous = item.state;
  saving.value = true;
  error.value = '';
  try {
    await callApi('PATCH', `/api/wishes/${item.id}`, wishResponseSchema, {
      state: next,
      expect: { state: previous },
    });
    pendingWishMessage.value = {
      text,
      month: item.month,
      undo: async () => {
        await callApi('PATCH', `/api/wishes/${item.id}`, wishResponseSchema, {
          state: previous,
          expect: { state: next },
        });
      },
    };
    await leave(item);
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status === 409
        ? CHANGED
        : messageFor(cause);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const item = wish.value;
  if (!item || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await callApi('DELETE', `/api/wishes/${item.id}`, {
      parse: (value: unknown) => value,
    });
    pendingWishMessage.value = {
      text: 'Wish deleted.',
      month: item.month,
      undo: async () => {
        await callApi(
          'POST',
          `/api/wishes/${item.id}/restore`,
          restoreWishResponseSchema,
        );
      },
    };
    await leave(item);
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="screen app-screen wish-form-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="wf-title">
        <h1 class="t-title">{{ title }}</h1>
        <span v-if="subtitle" class="t-sub">{{ subtitle }}</span>
      </div>
    </header>
    <div class="content wf-body scroll">
      <p v-if="loading" role="status">Loading…</p>
      <div v-else-if="loadError" role="alert">
        <p class="error">{{ loadError }}</p>
        <BbButton variant="text" @click="load">Try again</BbButton>
      </div>
      <template v-else>
        <div class="wf-field">
          <label class="lbl" for="wish-name">Name</label>
          <input
            id="wish-name"
            v-model="name"
            class="text"
            type="text"
            autocomplete="off"
            placeholder="e.g. Winter tyres"
            :maxlength="NAME_MAX"
            :aria-invalid="Boolean(nameError)"
            @focus="keypadOpen = false"
          />
          <span v-if="nameError" class="error" role="alert">{{
            nameError
          }}</span>
        </div>

        <div class="wf-field">
          <span id="wish-lbl-amount" class="lbl">Amount</span>
          <button
            class="amt"
            :class="{ 'amt-on': keypadOpen }"
            type="button"
            aria-labelledby="wish-lbl-amount"
            :aria-pressed="keypadOpen"
            @click="toggleKeypad"
          >
            <span class="amt-main">
              <span class="num amt-v" :class="{ muted: amount === 0n }">{{
                amountText
              }}</span>
              <span v-if="expressionText" class="num amt-x">{{
                expressionText
              }}</span>
            </span>
            <span class="amt-c">{{ currency.code }}</span>
          </button>
        </div>

        <div class="wf-field">
          <span id="wish-lbl-currency" class="lbl">Currency</span>
          <BbChipGroup
            v-model="currencyCode"
            :options="currencyChips"
            label="Currency"
            wrap
          >
            <template #trailing>
              <BbChip
                variant="ghost"
                aria-haspopup="dialog"
                aria-label="Other currency"
                @click="currencySheet = true"
                >Other…</BbChip
              >
            </template>
          </BbChipGroup>
        </div>

        <div class="wf-field">
          <span class="lbl">Category · optional</span>
          <BbChipGroup
            v-model="categoryId"
            label="Category"
            wrap
            :options="categoryChips"
          >
            <template #trailing>
              <BbChip
                variant="ghost"
                aria-haspopup="dialog"
                aria-label="All categories"
                @click="categorySheet = true"
                >All…</BbChip
              >
            </template>
          </BbChipGroup>
        </div>

        <div class="wf-field">
          <label class="lbl" for="wish-note">Note · optional</label>
          <input
            id="wish-note"
            v-model="note"
            class="text"
            type="text"
            autocomplete="off"
            placeholder="e.g. Before the first snow"
            :maxlength="NOTE_MAX"
            @focus="keypadOpen = false"
          />
        </div>

        <div v-if="editing" class="wf-danger">
          <span class="wf-hint">{{ dangerHint }}</span>
          <div class="wf-danger-row">
            <BbButton
              variant="secondary-sm"
              needs-server
              :disabled="saving"
              @click="
                dropped
                  ? changeState('open', 'Brought back.')
                  : changeState('dropped', 'Dropped.')
              "
              >{{ dropped ? 'Bring back' : 'Drop' }}</BbButton
            >
            <BbButton
              variant="secondary-sm"
              needs-server
              :disabled="saving"
              @click="remove"
              >Delete</BbButton
            >
          </div>
        </div>
      </template>
    </div>

    <footer class="bottombar wf-footer">
      <BbAmountInput
        v-if="keypadOpen && !loading && !loadError"
        class="wf-keys"
        bare
        :currency="currency"
        label="Amount"
        @change="onAmountChange"
      />
      <p v-if="typed?.error" class="error" role="alert">{{ typed.error }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <BbButton needs-server :disabled="!canSave" @click="save">{{
        saveLabel
      }}</BbButton>
    </footer>
  </main>

  <CurrencyPickerSheet
    v-if="currencySheet"
    :options="currencies"
    :in-use="quickCodes"
    :selected="currencyCode"
    @pick="pickCurrency"
    @close="currencySheet = false"
  />
  <CategoryPickerSheet
    v-if="categorySheet"
    :categories="activeCategories"
    :selected-id="categoryId || null"
    @pick="pickCategory"
    @close="categorySheet = false"
  />
</template>

<style scoped>
.wish-form-screen {
  height: var(--app-h, 100dvh);
}
.wf-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.wf-body {
  min-height: 0;
  overflow-y: auto;
  gap: 14px;
}
.wf-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wf-hint {
  font-size: 13px;
  color: var(--muted);
}
.amt {
  width: 100%;
  min-height: 52px;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  text-align: left;
}
.amt-on {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}
.amt-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.amt-v {
  font-size: 18px;
  font-weight: 600;
}
.amt-v.muted {
  color: var(--muted);
}
.amt-x {
  font-size: 13px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.amt-c {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.wf-danger {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.wf-danger-row {
  display: flex;
  gap: 8px;
}
.wf-danger-row :deep(.secondary) {
  flex: 1;
  height: 44px;
  padding: 0 16px;
  border-radius: 22px;
  background: var(--surface);
  font-size: 14px;
}
.wf-keys :deep(.key) {
  height: 46px;
}
</style>
