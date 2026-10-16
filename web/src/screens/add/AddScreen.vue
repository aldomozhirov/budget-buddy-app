<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  accountChipLabels,
  addOptionsResponseSchema,
  categorySuggestionsResponseSchema,
  createTransactionResponseSchema,
  deleteTransactionResponseSchema,
  fillOnSave,
  formatMoney,
  matchRule,
  pickAccountChips,
  todayInTimeZone,
  type AddOptionsAccount,
  type AddOptionsResponse,
  type Transaction,
} from '@budget-buddy/shared';
import AccountPickerSheet from '../../components/AccountPickerSheet.vue';
import BbButton from '../../components/BbButton.vue';
import BbAmountInput, {
  type AmountChange,
} from '../../components/BbAmountInput.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSegmented from '../../components/BbSegmented.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import EnvelopePickerSheet from '../../components/EnvelopePickerSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { useBack } from '../../composables/useBack.js';
import DateSheet from './DateSheet.vue';
import MerchantSheet, { type MerchantOption } from './MerchantSheet.vue';
import NoteSheet from './NoteSheet.vue';
import PayerSheet from './PayerSheet.vue';
import {
  accountCurrency,
  amountText,
  applyRule,
  dayLabel,
  EMPTY_PICK,
  filledText,
  merchantHint,
  pickLabel,
  savedSummary,
  toggleChip,
  withFront,
  type FormPick,
} from './addForm.js';

/**
 * Add expense (UI-ADD-1 to UI-ADD-13): amount on the app's keypad, account
 * chips, merchant, category and envelope chips, and the Date, Paid by and
 * Note tiles, all on one iPhone screen; then the saved view with Undo.
 * Income and Transfer arrive in task 11; the outbox in task 17, so saving
 * needs the server for now.
 */
defineOptions({ name: 'AddScreen' });

type CategoryOption = AddOptionsResponse['categories'][number];
type EnvelopeOption = AddOptionsResponse['envelopes'][number];
type SheetName =
  'account' | 'merchant' | 'category' | 'envelope' | 'date' | 'payer' | 'note';

/** Chips before "All…" for suggested categories and envelopes. */
const CATEGORY_CHIPS = 4;
const ENVELOPE_CHIPS = 5;
const RECENT_CATEGORIES = 3;

const { goBack } = useBack();

const options = ref<AddOptionsResponse | null>(null);
const loading = ref(true);
const loadError = ref('');

const accountId = ref<number | null>(null);
/** An account picked from the sheet, kept at the front of the row. */
const extraAccountId = ref<number | null>(null);
const amount = ref<bigint | null>(null);
const typed = ref<AmountChange | null>(null);
const preview = ref<bigint | null>(null);
/** Remounts the keypad to clear what was typed. */
const keypadKey = ref(0);
const merchant = ref('');
const category = ref<FormPick>(EMPTY_PICK);
const envelope = ref<FormPick>(EMPTY_PICK);
const extraCategoryId = ref<number | null>(null);
const extraEnvelopeId = ref<number | null>(null);
const suggestedIds = ref<number[]>([]);
const date = ref('');
const payerId = ref(0);
const note = ref('');
const sheet = ref<SheetName | null>(null);

const saving = ref(false);
const saveError = ref('');
const saved = ref<{
  transaction: Transaction;
  summary: string;
  filled: string;
  noCategory: boolean;
} | null>(null);
const undoing = ref(false);
const undoError = ref('');

/**
 * The client id of the last attempt and what it sent, so a retry of the
 * same expense after a lost answer is not saved twice (TXN-7).
 */
let pending: { signature: string; clientId: string; enteredAt: number } | null =
  null;

const today = computed(() =>
  options.value ? todayInTimeZone(new Date(), options.value.timeZone) : '',
);
const profileId = computed(() => options.value?.profileId ?? 0);
const account = computed<AddOptionsAccount | undefined>(() =>
  options.value?.accounts.find((item) => item.id === accountId.value),
);
const currency = computed(() =>
  account.value
    ? accountCurrency(account.value)
    : {
        code: 'EUR',
        name: 'EUR',
        decimals: 2,
        symbol: '€',
        kind: 'fiat' as const,
      },
);

function categoryById(id: number | null): CategoryOption | undefined {
  return options.value?.categories.find((item) => item.id === id);
}
function envelopeById(id: number | null): EnvelopeOption | undefined {
  return options.value?.envelopes.find((item) => item.id === id);
}

const accountChips = computed(() => {
  const data = options.value;
  if (!data) return [];
  const base = pickAccountChips(data.accounts, data.profileId).map(
    (item) => item.id,
  );
  const ids = withFront(withFront(base, extraAccountId.value), accountId.value);
  const accounts = ids
    .map((id) => data.accounts.find((item) => item.id === id))
    .filter((item): item is AddOptionsAccount => item !== undefined);
  return accountChipLabels(accounts, data.profileId, data.commonCurrency);
});
const accountLabel = computed(
  () =>
    accountChips.value.find((chip) => chip.account.id === accountId.value)
      ?.label ??
    account.value?.name ??
    '',
);

const expenseCategories = computed(
  () =>
    options.value?.categories.filter((item) => item.kind === 'expense') ?? [],
);
const categoryChips = computed(() => {
  const base = suggestedIds.value.length
    ? suggestedIds.value
    : expenseCategories.value.slice(0, CATEGORY_CHIPS).map((item) => item.id);
  return withFront(withFront(base, extraCategoryId.value), category.value.id)
    .map((id) => categoryById(id))
    .filter((item): item is CategoryOption => item?.kind === 'expense')
    .map((item) => ({ label: item.name, value: item.id }));
});
const recentCategoryIds = computed(() =>
  expenseCategories.value.slice(0, RECENT_CATEGORIES).map((item) => item.id),
);

const envelopes = computed(() => options.value?.envelopes ?? []);
const envelopeChips = computed(() => {
  const base = envelopes.value.slice(0, ENVELOPE_CHIPS).map((item) => item.id);
  return withFront(withFront(base, extraEnvelopeId.value), envelope.value.id)
    .map((id) => envelopeById(id))
    .filter((item): item is EnvelopeOption => item !== undefined)
    .map((item) => ({ label: item.name, value: item.id }));
});

const merchants = computed<MerchantOption[]>(() => {
  const data = options.value;
  if (!data) return [];
  return data.merchants.map((item) => {
    const match = matchRule(item.merchant, accountId.value, data.rules);
    const ruleCategory = match ? categoryById(match.categoryId)?.name : null;
    const ruleEnvelope = match ? envelopeById(match.envelopeId)?.name : null;
    const detail = ruleCategory
      ? `Rule: ${ruleCategory}${
          ruleEnvelope && ruleEnvelope !== ruleCategory
            ? ` · ${ruleEnvelope}`
            : ''
        }`
      : 'Used before';
    return { ...item, detail };
  });
});

/** What the server would fill on save, previewed in the labels. */
const fillPreview = computed(() =>
  fillOnSave(
    {
      kind: 'expense',
      categoryId: category.value.id,
      envelopeId: envelope.value.id,
    },
    (id) => {
      const item = categoryById(id);
      return (
        item && { defaultEnvelopeId: item.defaultEnvelopeId, archived: false }
      );
    },
    (id) => {
      const item = envelopeById(id);
      return (
        item && { defaultCategoryId: item.defaultCategoryId, archived: false }
      );
    },
  ),
);
const categoryLabel = computed(() =>
  pickLabel(
    'Category',
    category.value,
    merchant.value,
    fillPreview.value.filled.category
      ? (categoryById(fillPreview.value.categoryId)?.name ?? null)
      : null,
  ),
);
const envelopeLabel = computed(() =>
  pickLabel(
    'Envelope',
    envelope.value,
    merchant.value,
    fillPreview.value.filled.envelope
      ? (envelopeById(fillPreview.value.envelopeId)?.name ?? null)
      : null,
  ),
);
const hint = computed(() =>
  merchantHint(merchant.value, category.value, envelope.value),
);

const payerName = computed(
  () =>
    options.value?.profiles.find((item) => item.id === payerId.value)?.name ??
    '',
);
const dateText = computed(() =>
  date.value && today.value ? dayLabel(date.value, today.value) : 'Today',
);

const shownAmount = computed(() =>
  amountText(
    typed.value === null || typed.value.empty ? null : preview.value,
    currency.value,
  ),
);
const expression = computed(() =>
  typed.value && /[+−\-×÷*/%()]/.test(typed.value.text) ? typed.value.text : '',
);
const canSave = computed(
  () =>
    account.value !== undefined &&
    amount.value !== null &&
    amount.value !== 0n &&
    !saving.value,
);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (amount.value === null || amount.value === 0n) return 'Enter an amount';
  return `Save ${formatMoney(amount.value, currency.value)}`;
});

function onAmountChange(change: AmountChange): void {
  typed.value = change;
  if (change.amount !== null || change.empty) preview.value = change.amount;
}

/** Applies the merchant's rule again after the merchant or account moved. */
function reapplyRule(): void {
  const data = options.value;
  if (!data) return;
  const match = matchRule(merchant.value, accountId.value, data.rules);
  const usable = match && categoryById(match.categoryId) ? match : null;
  const next = applyRule(
    { category: category.value, envelope: envelope.value },
    usable && {
      categoryId: usable.categoryId,
      envelopeId: envelopeById(usable.envelopeId) ? usable.envelopeId : null,
    },
  );
  category.value = next.category;
  envelope.value = next.envelope;
}

/** The query of the category chips (Design 3.6) for the form as it is. */
function suggestionQuery(): string {
  const query = new URLSearchParams({ kind: 'expense' });
  if (merchant.value) query.set('merchant', merchant.value);
  if (envelope.value.id !== null) {
    query.set('envelopeId', String(envelope.value.id));
  }
  if (accountId.value !== null) query.set('accountId', String(accountId.value));
  return query.toString();
}

/** Asks for the category chips; a late answer to an old query is dropped. */
async function loadSuggestions(): Promise<void> {
  const asked = suggestionQuery();
  try {
    const { categoryIds } = await callApi(
      'GET',
      `/api/suggestions/categories?${asked}`,
      categorySuggestionsResponseSchema,
    );
    if (asked === suggestionQuery()) suggestedIds.value = categoryIds;
  } catch {
    // Keep the chips there are; the list order is a fine fallback.
  }
}
watch(
  () => [merchant.value, envelope.value.id, accountId.value] as const,
  () => void loadSuggestions(),
);

function resetForm(): void {
  const data = options.value;
  amount.value = null;
  typed.value = null;
  preview.value = null;
  keypadKey.value += 1;
  merchant.value = '';
  category.value = EMPTY_PICK;
  envelope.value = EMPTY_PICK;
  extraCategoryId.value = null;
  extraEnvelopeId.value = null;
  note.value = '';
  date.value = today.value;
  payerId.value = data?.profileId ?? 0;
  saveError.value = '';
  pending = null;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await callApi(
      'GET',
      '/api/add-options',
      addOptionsResponseSchema,
    );
    options.value = data;
    accountId.value = data.accounts[0]?.id ?? null;
    resetForm();
  } catch (cause) {
    loadError.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the form. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function pickAccount(id: number): void {
  accountId.value = id;
  reapplyRule();
}

function pickAccountFromSheet(picked: AddOptionsAccount | null): void {
  sheet.value = null;
  if (!picked) return;
  extraAccountId.value = picked.id;
  pickAccount(picked.id);
}

function pickMerchant(value: string): void {
  sheet.value = null;
  merchant.value = value;
  reapplyRule();
  if (category.value.source === 'rule')
    extraCategoryId.value = category.value.id;
  if (envelope.value.source === 'rule')
    extraEnvelopeId.value = envelope.value.id;
}

function tapCategory(value: string | number): void {
  category.value = toggleChip(category.value, Number(value));
}

function pickCategoryFromSheet(picked: { id: number; name: string }): void {
  sheet.value = null;
  const data = options.value;
  if (data && !categoryById(picked.id)) {
    // A category added in the sheet joins the form's list.
    data.categories = [
      ...data.categories,
      {
        id: picked.id,
        name: picked.name,
        kind: 'expense',
        defaultEnvelopeId: null,
      },
    ];
  }
  extraCategoryId.value = picked.id;
  category.value = { id: picked.id, source: 'hand' };
}

function tapEnvelope(value: string | number): void {
  envelope.value = toggleChip(envelope.value, Number(value));
}

function pickEnvelopeFromSheet(picked: EnvelopeOption | null): void {
  sheet.value = null;
  if (!picked) {
    envelope.value = EMPTY_PICK;
    return;
  }
  extraEnvelopeId.value = picked.id;
  envelope.value = { id: picked.id, source: 'hand' };
}

async function save(): Promise<void> {
  const value = amount.value;
  if (!canSave.value || value === null || accountId.value === null) return;
  const form = {
    kind: 'expense' as const,
    date: date.value,
    accountId: accountId.value,
    amount: value.toString(),
    memberId: payerId.value,
    ...(merchant.value ? { merchant: merchant.value } : {}),
    ...(note.value ? { note: note.value } : {}),
    categoryId: category.value.id,
    envelopeId: envelope.value.id,
  };
  const signature = JSON.stringify(form);
  if (pending?.signature !== signature) {
    pending = {
      signature,
      clientId: crypto.randomUUID(),
      enteredAt: Date.now(),
    };
  }
  saving.value = true;
  saveError.value = '';
  try {
    const { transaction, filled } = await callApi(
      'POST',
      '/api/transactions',
      createTransactionResponseSchema,
      { ...form, clientId: pending.clientId, enteredAt: pending.enteredAt },
    );
    pending = null;
    const categoryName = categoryById(transaction.categoryId)?.name ?? null;
    const envelopeName = envelopeById(transaction.envelopeId)?.name ?? null;
    saved.value = {
      transaction,
      summary: savedSummary({
        amount: formatMoney(BigInt(transaction.amount), currency.value),
        merchant: transaction.merchant,
        date:
          transaction.date === today.value
            ? null
            : dayLabel(transaction.date, today.value),
        payer:
          transaction.memberId === profileId.value ? null : payerName.value,
        account: accountLabel.value,
        envelope: envelopeName,
        category: categoryName,
      }),
      filled: filledText(filled, categoryName, envelopeName),
      noCategory: transaction.categoryId === null,
    };
    undoError.value = '';
  } catch (cause) {
    saveError.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not save the expense. Try again.';
  } finally {
    saving.value = false;
  }
}

/** Deletes the saved expense and returns to the form as it was. */
async function undo(): Promise<void> {
  const current = saved.value;
  if (!current || undoing.value) return;
  undoing.value = true;
  undoError.value = '';
  try {
    await callApi(
      'DELETE',
      `/api/transactions/${current.transaction.id}`,
      deleteTransactionResponseSchema,
    );
    saved.value = null;
  } catch (cause) {
    undoError.value =
      cause instanceof ApiError ? cause.message : 'Could not undo. Try again.';
  } finally {
    undoing.value = false;
  }
}

function addAnother(): void {
  saved.value = null;
  resetForm();
}
</script>

<template>
  <main class="screen app-screen add-screen">
    <div v-if="loading" class="add-state">
      <p role="status">Loading…</p>
    </div>
    <div v-else-if="loadError || !options" class="add-state">
      <header class="add-head">
        <button
          class="icon-btn add-close"
          type="button"
          aria-label="Close"
          @click="goBack"
        >
          <BbIcon name="close" :size="22" />
        </button>
      </header>
      <div role="alert">
        <p class="error">{{ loadError }}</p>
        <button class="text-btn" type="button" @click="load">Try again</button>
      </div>
    </div>

    <section
      v-else-if="saved"
      class="add-saved"
      aria-labelledby="add-saved-title"
    >
      <span class="add-saved-icon success-icon">
        <BbIcon name="check" :size="34" />
      </span>
      <h2 id="add-saved-title" class="add-saved-title">Expense saved</h2>
      <p class="num add-saved-summary">{{ saved.summary }}</p>
      <p v-if="saved.noCategory" class="add-saved-note">
        No category yet. It waits in
        <RouterLink class="add-saved-link" to="/transactions?tab=needs-category"
          >Needs a category</RouterLink
        >, with a suggestion.
      </p>
      <p v-if="saved.filled" class="add-saved-note">{{ saved.filled }}</p>
      <p v-if="undoError" class="error" role="alert">{{ undoError }}</p>
      <div class="add-saved-actions">
        <BbButton @click="goBack">Done</BbButton>
        <BbButton variant="secondary" @click="addAnother">Add another</BbButton>
        <BbButton variant="text" needs-server :disabled="undoing" @click="undo"
          >Undo</BbButton
        >
      </div>
    </section>

    <div v-else class="add-form">
      <header class="add-head">
        <button
          class="icon-btn add-close"
          type="button"
          aria-label="Close"
          @click="goBack"
        >
          <BbIcon name="close" :size="22" />
        </button>
        <BbSegmented
          class="add-kind"
          model-value="expense"
          label="Kind"
          :options="[
            { label: 'Expense', value: 'expense' },
            { label: 'Income', value: 'income', disabled: true },
            { label: 'Transfer', value: 'transfer', disabled: true },
          ]"
        />
      </header>

      <div class="add-amount" role="group" aria-label="Amount">
        <span class="num amount-expr add-expr">{{ expression }}</span>
        <div class="add-amount-line">
          <span
            class="num amount"
            :class="{ 'add-amount-empty': typed === null || typed.empty }"
            aria-live="polite"
            aria-atomic="true"
            >{{ shownAmount }}</span
          >
          <span class="add-currency">{{ currency.code }}</span>
        </div>
        <span class="add-error">
          <span v-if="typed?.error" class="error" role="alert">{{
            typed.error
          }}</span>
        </span>
      </div>

      <div class="add-field">
        <span class="lbl">Paid from</span>
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

      <button
        class="field-btn"
        type="button"
        :aria-label="
          merchant ? `Merchant: ${merchant}. Change` : 'Add merchant'
        "
        @click="sheet = 'merchant'"
      >
        <BbIcon name="merchant" :size="18" />
        <span class="add-merchant" :class="{ 'add-merchant-set': merchant }">{{
          merchant || 'Add merchant'
        }}</span>
        <span class="add-merchant-hint">{{ hint }}</span>
        <BbIcon name="forward" :size="16" />
      </button>

      <div class="add-field">
        <span class="lbl">{{ categoryLabel }}</span>
        <BbChipGroup
          :model-value="category.id ?? 0"
          :options="categoryChips"
          label="Category"
          @update:model-value="tapCategory"
        >
          <template #trailing>
            <BbChip
              variant="ghost"
              aria-label="All categories"
              @click="sheet = 'category'"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>

      <div v-if="envelopes.length" class="add-field">
        <span class="lbl">{{ envelopeLabel }}</span>
        <BbChipGroup
          :model-value="envelope.id ?? 0"
          :options="envelopeChips"
          label="Envelope"
          @update:model-value="tapEnvelope"
        >
          <template v-if="envelopes.length > ENVELOPE_CHIPS" #trailing>
            <BbChip
              variant="ghost"
              aria-label="All envelopes"
              @click="sheet = 'envelope'"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>

      <div class="add-tiles">
        <button
          class="meta"
          :class="{ 'meta-set': date !== today }"
          type="button"
          :aria-label="`Date: ${dateText}. Change`"
          @click="sheet = 'date'"
        >
          <span class="meta-l"><BbIcon name="calendar" :size="13" />Date</span>
          <span class="meta-v"
            ><span class="add-meta-t">{{ dateText }}</span
            ><BbIcon name="down" :size="14"
          /></span>
        </button>
        <button
          class="meta"
          :class="{ 'meta-set': payerId !== profileId }"
          type="button"
          :aria-label="`Paid by: ${payerName}. Change`"
          @click="sheet = 'payer'"
        >
          <span class="meta-l"><BbIcon name="person" :size="13" />Paid by</span>
          <span class="meta-v"
            ><span class="add-meta-t">{{ payerName }}</span
            ><BbIcon name="down" :size="14"
          /></span>
        </button>
        <button
          class="meta"
          :class="{ 'meta-set': note }"
          type="button"
          :aria-label="note ? `Note: ${note}. Change` : 'Add note'"
          @click="sheet = 'note'"
        >
          <span class="meta-l"><BbIcon name="note" :size="13" />Note</span>
          <span class="meta-v"
            ><span class="add-meta-t">{{ note || 'Add' }}</span
            ><BbIcon name="down" :size="14"
          /></span>
        </button>
      </div>

      <div class="add-spacer" />

      <BbAmountInput
        :key="keypadKey"
        v-model:amount="amount"
        bare
        allow-negative
        :currency="currency"
        label="Amount"
        @change="onAmountChange"
      />
      <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>
      <BbButton class="num" needs-server :disabled="!canSave" @click="save">{{
        saveLabel
      }}</BbButton>
    </div>

    <AccountPickerSheet
      v-if="sheet === 'account' && options"
      :accounts="options.accounts"
      :selected-id="accountId"
      :profile-id="profileId"
      title="Paid from"
      @pick="pickAccountFromSheet"
      @close="sheet = null"
    />
    <MerchantSheet
      v-if="sheet === 'merchant'"
      :merchants="merchants"
      :selected="merchant"
      @pick="pickMerchant"
      @close="sheet = null"
    />
    <CategoryPickerSheet
      v-if="sheet === 'category'"
      :categories="
        [...expenseCategories].sort((a, b) => a.name.localeCompare(b.name))
      "
      :selected-id="category.id"
      :recent-ids="recentCategoryIds"
      kind="expense"
      @pick="pickCategoryFromSheet"
      @close="sheet = null"
    />
    <EnvelopePickerSheet
      v-if="sheet === 'envelope'"
      :envelopes="envelopes"
      :coins="[]"
      :selected-id="envelope.id"
      @pick="pickEnvelopeFromSheet"
      @close="sheet = null"
    />
    <DateSheet
      v-if="sheet === 'date'"
      :date="date"
      :today="today"
      @pick="
        date = $event;
        sheet = null;
      "
      @close="sheet = null"
    />
    <PayerSheet
      v-if="sheet === 'payer' && options"
      title="Paid by"
      hint="Who paid. The account above stays as picked."
      :profiles="options.profiles"
      :profile-id="profileId"
      :selected-id="payerId"
      @pick="
        payerId = $event;
        sheet = null;
      "
      @close="sheet = null"
    />
    <NoteSheet
      v-if="sheet === 'note'"
      :note="note"
      @save="
        note = $event;
        sheet = null;
      "
      @close="sheet = null"
    />
  </main>
</template>

<style scoped>
.add-screen {
  box-sizing: border-box;
  height: var(--app-h, 100dvh);
  min-height: 0;
  padding: max(46px, var(--safe-area-top)) var(--gutter)
    max(20px, var(--safe-area-bottom));
}
/* Offline, the note above takes the status bar's place (UI-ADD-1). */
.is-offline .add-screen {
  padding-top: 8px;
}
.add-form,
.add-state {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.add-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.add-close {
  flex: none;
}
.add-kind {
  flex: 1;
}
.add-amount {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0 2px;
}
.add-expr {
  height: 18px;
}
.add-amount-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.add-amount-empty {
  color: var(--muted);
}
.add-currency {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--soft);
  font-size: 13px;
  font-weight: 600;
}
.add-error {
  height: 16px;
  font-size: 12px;
}
.add-error .error {
  font-size: 12px;
}
.add-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.add-merchant {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}
.add-merchant-set {
  font-weight: 600;
  color: var(--ink);
}
.add-merchant-hint {
  font-size: 12px;
  color: var(--muted);
}
.add-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.add-meta-t {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.add-spacer {
  flex: 1;
}
.add-saved {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 16px;
  text-align: center;
}
.add-saved-icon {
  width: 72px;
  height: 72px;
  border-radius: 36px;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.add-saved-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.add-saved-summary {
  margin: 0;
  color: var(--muted);
}
.add-saved-note {
  margin: 0;
  max-width: 280px;
  font-size: 13px;
  color: var(--muted);
}
.add-saved-link {
  color: var(--accent);
  font-weight: 500;
}
.add-saved-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 16px;
}
</style>
