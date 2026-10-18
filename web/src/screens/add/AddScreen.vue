<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  accountChipLabels,
  addOptionsResponseSchema,
  categorySuggestionsResponseSchema,
  convert,
  createTransactionResponseSchema,
  deleteTransactionResponseSchema,
  fillOnSave,
  formatMoney,
  matchRule,
  pickAccountChips,
  ratePairResponseSchema,
  todayInTimeZone,
  type AddOptionsAccount,
  type AddOptionsResponse,
  type DatedRate,
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
import { isOnline } from '../../composables/useOnline.js';
import {
  storeAddOptions,
  storedOptions,
  storedOptionsReady,
} from '../../offline/addOptions.js';
import {
  outbox,
  postTransaction,
  type OutboxItem,
  type SendOutcome,
} from '../../offline/outbox.js';
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
  kindWords,
  merchantHint,
  pairLookup,
  parseKind,
  pickLabel,
  savedSummary,
  toggleChip,
  withFront,
  type FormKind,
  type FormPick,
} from './addForm.js';

/**
 * Add expense, income or transfer (UI-ADD-1 to UI-ADD-15): amount on the
 * app's keypad, account chips, merchant, category and envelope chips, and
 * the Date, Paid by and Note tiles, all on one iPhone screen; then the saved
 * view with Undo. A transfer has From and To rows and, between two
 * currencies, a second amount that arrives (O11). The outbox is task 17, so
 * saving needs the server for now.
 */
defineOptions({ name: 'AddScreen' });

type CategoryOption = AddOptionsResponse['categories'][number];
type EnvelopeOption = AddOptionsResponse['envelopes'][number];
type SheetName =
  | 'account'
  | 'toAccount'
  | 'merchant'
  | 'category'
  | 'envelope'
  | 'date'
  | 'payer'
  | 'note';

/** Chips before "All…" for suggested categories and envelopes. */
const CATEGORY_CHIPS = 4;
const ENVELOPE_CHIPS = 5;
const RECENT_CATEGORIES = 3;

const { goBack } = useBack();
const route = useRoute();

const options = ref<AddOptionsResponse | null>(null);
const loading = ref(true);
const loadError = ref('');

const kind = ref<FormKind>(parseKind(route.query.kind));
const words = computed(() => kindWords(kind.value));
const accountId = ref<number | null>(null);
/** An account picked from the sheet, kept at the front of the row. */
const extraAccountId = ref<number | null>(null);
/** The account a transfer goes to; never the one it leaves. */
const toAccountId = ref<number | null>(null);
const extraToAccountId = ref<number | null>(null);
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

/** What the second amount of a two-currency transfer has been given. */
const arriveTyped = ref<AmountChange | null>(null);
const arrivePreview = ref<bigint | null>(null);
/** The keypad types the second amount (O11). */
const arriveEdit = ref(false);
/** Remounts the second keypad to clear what was typed. */
const arriveKey = ref(0);
/** The date's rate between the two accounts' currencies. */
const rate = ref<DatedRate | null>(null);
const rateLoading = ref(false);

const saving = ref(false);
const saveError = ref('');
const saved = ref<{
  /** The server's id; null while it is on the phone. */
  id: number | null;
  clientId: string;
  /** It waits in the outbox: "Expense saved on this phone" (UI-ADD-13). */
  onPhone: boolean;
  /** "Expense", "Income" or "Transfer", for the title. */
  noun: string;
  summary: string;
  filled: string;
  noCategory: boolean;
} | null>(null);
const undoing = ref(false);
const savedHeading = ref<HTMLElement>();
const amountGroup = ref<HTMLElement>();

/**
 * Moves focus into the saved view or back to the form: the side that is
 * left turns inert or goes away, so focus would fall to the page.
 */
function focusAfter(target: typeof savedHeading): void {
  void nextTick(() => target.value?.focus());
}
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

/** The accounts of one chip row: the usual five, a sheet pick, the choice. */
function accountRow(
  pool: AddOptionsAccount[],
  extra: number | null,
  selected: number | null,
): AddOptionsAccount[] {
  const data = options.value;
  if (!data) return [];
  const base = pickAccountChips(pool, data.profileId).map((item) => item.id);
  return withFront(withFront(base, extra), selected)
    .map((id) => pool.find((item) => item.id === id))
    .filter((item): item is AddOptionsAccount => item !== undefined);
}
const fromRow = computed(() =>
  accountRow(
    options.value?.accounts ?? [],
    extraAccountId.value,
    accountId.value,
  ),
);
const toRow = computed(() =>
  kind.value === 'transfer'
    ? accountRow(toPool.value, extraToAccountId.value, toAccountId.value)
    : [],
);
/** Chip labels are worked out over both rows, so one account reads alike. */
const chipLabels = computed(() => {
  const data = options.value;
  const labels = new Map<number, string>();
  if (!data) return labels;
  const unique = [
    ...new Map(
      [...fromRow.value, ...toRow.value].map((item) => [item.id, item]),
    ).values(),
  ];
  for (const chip of accountChipLabels(
    unique,
    data.profileId,
    data.commonCurrency,
  )) {
    labels.set(chip.account.id, chip.label);
  }
  return labels;
});
function chipsOf(row: AddOptionsAccount[]) {
  return row.map((item) => ({
    account: item,
    label: chipLabels.value.get(item.id) ?? item.name,
  }));
}
const accountChips = computed(() => chipsOf(fromRow.value));
const accountLabel = computed(
  () =>
    accountChips.value.find((chip) => chip.account.id === accountId.value)
      ?.label ??
    account.value?.name ??
    '',
);

/** The accounts a transfer can go to: all but the one it leaves. */
const toPool = computed(() =>
  (options.value?.accounts ?? []).filter((item) => item.id !== accountId.value),
);
const toChips = computed(() => chipsOf(toRow.value));
const toAccount = computed(() =>
  options.value?.accounts.find((item) => item.id === toAccountId.value),
);
const toLabel = computed(
  () =>
    toChips.value.find((chip) => chip.account.id === toAccountId.value)
      ?.label ??
    toAccount.value?.name ??
    '',
);
const toCurrency = computed(() =>
  toAccount.value ? accountCurrency(toAccount.value) : currency.value,
);
/** A transfer between two currencies has a second amount (O11). */
const fx = computed(
  () =>
    kind.value === 'transfer' &&
    toAccount.value !== undefined &&
    account.value !== undefined &&
    account.value.currency !== toAccount.value.currency,
);

/** Income takes income categories, an expense expense ones. */
const categoryKind = computed(() =>
  kind.value === 'income' ? 'income' : 'expense',
);
const kindCategories = computed(
  () =>
    options.value?.categories.filter(
      (item) => item.kind === categoryKind.value,
    ) ?? [],
);
const categoryChips = computed(() => {
  const base = suggestedIds.value.length
    ? suggestedIds.value
    : kindCategories.value.slice(0, CATEGORY_CHIPS).map((item) => item.id);
  return withFront(withFront(base, extraCategoryId.value), category.value.id)
    .map((id) => categoryById(id))
    .filter((item): item is CategoryOption => item?.kind === categoryKind.value)
    .map((item) => ({ label: item.name, value: item.id }));
});
const recentCategoryIds = computed(() =>
  kindCategories.value.slice(0, RECENT_CATEGORIES).map((item) => item.id),
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
      kind: kind.value,
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
/** Only an expense can be negative (a refund, TXN-8). */
const amountOk = computed(
  () =>
    amount.value !== null &&
    (kind.value === 'expense' ? amount.value !== 0n : amount.value > 0n),
);

/** What arrives, from the date's rate (O11); null without one. */
const autoArrive = computed<bigint | null>(() => {
  if (!fx.value || !rate.value || !account.value || !toAccount.value) {
    return null;
  }
  if (amount.value === null || amount.value <= 0n) return null;
  const result = convert(
    amount.value,
    currency.value,
    toCurrency.value,
    date.value,
    pairLookup(account.value.currency, toAccount.value.currency, rate.value),
  );
  return 'value' in result && result.value > 0n ? result.value : null;
});
/** The second amount: typed once the member types it, else the rate's. */
const arriveValue = computed<bigint | null>(() => {
  if (!fx.value) return null;
  if (arriveTyped.value === null) return autoArrive.value;
  return arriveTyped.value.empty ? null : arriveTyped.value.amount;
});
const arriveOk = computed(
  () => arriveValue.value !== null && arriveValue.value > 0n,
);
const arriveText = computed(() => {
  const typedNow = arriveTyped.value !== null && !arriveTyped.value.empty;
  const shown = typedNow ? arrivePreview.value : arriveValue.value;
  if (shown !== null && shown > 0n) {
    return `Arrives as ${formatMoney(shown, toCurrency.value)}`;
  }
  if (rateLoading.value && arriveTyped.value === null) {
    return 'Checking the rate…';
  }
  return `Type what arrives in ${toLabel.value}`;
});
/** The pill is in the warning colour while the member has to type it. */
const arriveWarn = computed(
  () => !arriveOk.value && !arriveEdit.value && !rateLoading.value,
);
/** The expression error of whichever amount the keypad is typing. */
const keypadError = computed(
  () => (arriveEdit.value ? arriveTyped.value : typed.value)?.error ?? '',
);

const canSave = computed(
  () =>
    account.value !== undefined &&
    amountOk.value &&
    (kind.value !== 'transfer' ||
      (toAccount.value !== undefined && (!fx.value || arriveOk.value))) &&
    !saving.value,
);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (!amountOk.value || amount.value === null) return 'Enter an amount';
  if (fx.value && !arriveOk.value) return 'Type what arrives';
  const sent = formatMoney(amount.value, currency.value);
  return fx.value && arriveValue.value !== null
    ? `Save ${sent} → ${formatMoney(arriveValue.value, toCurrency.value)}`
    : `Save ${sent}`;
});

function onAmountChange(change: AmountChange): void {
  typed.value = change;
  if (change.amount !== null || change.empty) preview.value = change.amount;
}

function onArriveChange(change: AmountChange): void {
  arriveTyped.value = change;
  if (change.amount !== null || change.empty) {
    arrivePreview.value = change.amount;
  }
}

/** Applies the merchant's rule again after the merchant or account moved. */
function reapplyRule(): void {
  const data = options.value;
  if (!data || kind.value !== 'expense') return;
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
  const query = new URLSearchParams({ kind: categoryKind.value });
  if (kind.value === 'expense' && merchant.value) {
    query.set('merchant', merchant.value);
  }
  if (kind.value === 'expense' && envelope.value.id !== null) {
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
  [
    () => kind.value,
    () => merchant.value,
    () => envelope.value.id,
    () => accountId.value,
  ],
  () => void loadSuggestions(),
);

/** Asks for the date's rate between the two currencies; latest wins. */
async function loadRate(): Promise<void> {
  const from = account.value?.currency;
  const to = toAccount.value?.currency;
  if (!fx.value || !from || !to || !date.value) {
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
    if (asked === rateKey()) rate.value = answer.rate;
  } catch {
    // No rate: the member types what arrives.
  } finally {
    if (asked === rateKey()) rateLoading.value = false;
  }
}
function rateKey(): string {
  return `${account.value?.currency}>${toAccount.value?.currency}@${date.value}`;
}
watch([fx, rateKey], () => void loadRate());

/** Forgets a typed second amount, e.g. after another account is picked. */
function resetArrive(): void {
  arriveTyped.value = null;
  arrivePreview.value = null;
  arriveEdit.value = false;
  arriveKey.value += 1;
}

/** A transfer never goes to the account it leaves. */
function ensureTo(): void {
  if (toAccountId.value !== null && toAccountId.value !== accountId.value) {
    return;
  }
  toAccountId.value = toChips.value[0]?.account.id ?? null;
}

/** Switches the kind; category and envelope start over (UI-ADD-8). */
function setKind(next: FormKind): void {
  if (next === kind.value) return;
  kind.value = next;
  category.value = EMPTY_PICK;
  envelope.value = EMPTY_PICK;
  extraCategoryId.value = null;
  extraEnvelopeId.value = null;
  suggestedIds.value = [];
  resetArrive();
  ensureTo();
  if (next === 'expense') reapplyRule();
  // Only an expense can be a refund: drop a negative amount.
  if (next !== 'expense' && amount.value !== null && amount.value < 0n) {
    amount.value = null;
    typed.value = null;
    preview.value = null;
    keypadKey.value += 1;
  }
}

// Follows a link to another kind while the form is open.
watch(
  () => route.query.kind,
  (next) => setKind(parseKind(next)),
);

function resetForm(): void {
  const data = options.value;
  amount.value = null;
  typed.value = null;
  preview.value = null;
  keypadKey.value += 1;
  merchant.value = '';
  resetArrive();
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

/**
 * The options for the form: the server's, which are then kept on the phone,
 * or those already on the phone when there is no connection (Design 4).
 */
async function fetchOptions(): Promise<AddOptionsResponse> {
  await storedOptionsReady();
  const stored = storedOptions.value;
  // A copy: adding a category online changes the form's list, not the store.
  if (!isOnline.value && stored) return { ...stored };
  try {
    const data = await callApi(
      'GET',
      '/api/add-options',
      addOptionsResponseSchema,
    );
    void storeAddOptions(data);
    return data;
  } catch (cause) {
    if (stored && cause instanceof ApiError && cause.status === 0) {
      return { ...stored };
    }
    throw cause;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await fetchOptions();
    options.value = data;
    accountId.value = data.accounts[0]?.id ?? null;
    toAccountId.value = null;
    resetForm();
    ensureTo();
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
  ensureTo();
  resetArrive();
  reapplyRule();
}

function pickAccountFromSheet(picked: AddOptionsAccount | null): void {
  sheet.value = null;
  if (!picked) return;
  extraAccountId.value = picked.id;
  pickAccount(picked.id);
}

function pickTo(id: number): void {
  toAccountId.value = id;
  resetArrive();
}

function pickToFromSheet(picked: AddOptionsAccount | null): void {
  sheet.value = null;
  if (!picked) return;
  extraToAccountId.value = picked.id;
  pickTo(picked.id);
}

/** A tap on "Arrives as" moves the keypad to the second amount. */
function editArrive(): void {
  arriveEdit.value = true;
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
        kind: categoryKind.value,
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
  const common = {
    kind: kind.value,
    date: date.value,
    accountId: accountId.value,
    amount: value.toString(),
    memberId: payerId.value,
    ...(note.value ? { note: note.value } : {}),
  };
  const form =
    kind.value === 'transfer'
      ? {
          ...common,
          toAccountId: toAccountId.value,
          ...(fx.value && arriveValue.value !== null
            ? { toAmount: arriveValue.value.toString() }
            : {}),
        }
      : kind.value === 'income'
        ? { ...common, categoryId: category.value.id }
        : {
            ...common,
            ...(merchant.value ? { merchant: merchant.value } : {}),
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
  const item = outboxItem({
    ...form,
    clientId: pending.clientId,
    enteredAt: pending.enteredAt,
  });
  try {
    const outcome = await keepAndSend(item);
    if (outcome.kind === 'failed') {
      // Refused on the spot: the member fixes it here, so it does not wait
      // on the phone as "Couldn't send".
      await outbox.remove(item.clientId).catch(() => undefined);
      saveError.value = outcome.message;
      return;
    }
    pending = null;
    const answer =
      outcome.kind === 'sent'
        ? createTransactionResponseSchema.safeParse(outcome.payload)
        : null;
    if (answer?.success) {
      const { transaction, filled } = answer.data;
      const categoryName = categoryById(transaction.categoryId)?.name ?? null;
      const envelopeName = envelopeById(transaction.envelopeId)?.name ?? null;
      const sent = formatMoney(BigInt(transaction.amount), currency.value);
      saved.value = {
        id: transaction.id,
        clientId: item.clientId,
        onPhone: false,
        noun: words.value.noun,
        summary: summaryOf({
          amount:
            transaction.toAmount !== null &&
            transaction.toCurrency !== transaction.currency
              ? `${sent} → ${formatMoney(BigInt(transaction.toAmount), toCurrency.value)}`
              : sent,
          merchant: transaction.merchant,
          date: transaction.date,
          memberId: transaction.memberId,
          envelope: envelopeName,
          category: categoryName,
        }),
        filled: filledText(filled, categoryName, envelopeName),
        noCategory:
          transaction.kind !== 'transfer' && transaction.categoryId === null,
      };
    } else {
      // On the phone, or sent by a locked session that only learns the id:
      // the summary comes from the form.
      const sent = formatMoney(BigInt(item.body.amount), currency.value);
      saved.value = {
        id: outcome.kind === 'sent' ? outcome.id : null,
        clientId: item.clientId,
        onPhone: outcome.kind === 'waiting',
        noun: words.value.noun,
        summary: summaryOf({
          amount:
            item.body.toAmount != null && fx.value
              ? `${sent} → ${formatMoney(BigInt(item.body.toAmount), toCurrency.value)}`
              : sent,
          merchant: item.body.merchant ?? null,
          date: item.body.date,
          memberId: item.body.memberId ?? profileId.value,
          envelope: item.names.envelope,
          category: item.names.category,
        }),
        filled: '',
        noCategory:
          item.body.kind !== 'transfer' && item.body.categoryId == null,
      };
    }
    undoError.value = '';
    focusAfter(savedHeading);
  } catch {
    saveError.value = `Could not save the ${words.value.noun.toLowerCase()}. Try again.`;
  } finally {
    saving.value = false;
  }
}

/** The outbox record of what the form is about to save (Design 4). */
function outboxItem(body: OutboxItem['body']): OutboxItem {
  const profileName =
    options.value?.profiles.find((item) => item.id === profileId.value)?.name ??
    '';
  return {
    clientId: body.clientId,
    body,
    profileId: profileId.value,
    profileName,
    enteredAt: body.enteredAt,
    names: {
      account: account.value?.name ?? accountLabel.value,
      currency: currency.value.code,
      toAccount:
        body.kind === 'transfer' ? (toAccount.value?.name ?? null) : null,
      toCurrency:
        body.kind === 'transfer' ? (toAccount.value?.currency ?? null) : null,
      category: categoryById(body.categoryId ?? null)?.name ?? null,
      envelope: envelopeById(body.envelopeId ?? null)?.name ?? null,
      member: payerName.value,
    },
    state: 'waiting',
    error: null,
  };
}

/**
 * Writes the item to the outbox, then sends what waits (Design 4). Without
 * a device store (IndexedDB refused) it is sent straight away, as before.
 */
async function keepAndSend(item: OutboxItem): Promise<SendOutcome> {
  try {
    await outbox.add(item);
  } catch {
    return postTransaction(item.body);
  }
  const outcomes = await outbox.flush();
  return outcomes.get(item.clientId) ?? { kind: 'waiting', reason: 'offline' };
}

/** The saved screen's line, with the date and payer only when they differ. */
function summaryOf(parts: {
  amount: string;
  merchant: string | null;
  date: string;
  memberId: number;
  envelope: string | null;
  category: string | null;
}): string {
  return savedSummary({
    amount: parts.amount,
    merchant: parts.merchant,
    date: parts.date === today.value ? null : dayLabel(parts.date, today.value),
    payer: parts.memberId === profileId.value ? null : payerName.value,
    payerLabel: words.value.payerLabel,
    account:
      kind.value === 'transfer'
        ? `${accountLabel.value} → ${toLabel.value}`
        : accountLabel.value,
    envelope: parts.envelope,
    category: parts.category,
  });
}

/** Deletes the saved expense and returns to the form as it was. */
async function undo(): Promise<void> {
  const current = saved.value;
  if (!current || undoing.value) return;
  undoing.value = true;
  undoError.value = '';
  try {
    let id = current.id;
    if (current.onPhone) {
      const result = await outbox.remove(current.clientId);
      // It may have been sent in the meantime: then it is deleted there.
      id = result.removed ? null : result.sentId;
      if (!result.removed && id === null) {
        throw new ApiError('It was sent already. Delete it from the list.', 0);
      }
    }
    if (id !== null) {
      await callApi(
        'DELETE',
        `/api/transactions/${id}`,
        deleteTransactionResponseSchema,
      );
    }
    saved.value = null;
    focusAfter(amountGroup);
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
  focusAfter(amountGroup);
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

    <div v-else class="add-form" :inert="saved !== null">
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
          :model-value="kind"
          label="Kind"
          :options="[
            { label: 'Expense', value: 'expense' },
            { label: 'Income', value: 'income' },
            { label: 'Transfer', value: 'transfer' },
          ]"
          @update:model-value="setKind($event as FormKind)"
        />
      </header>

      <p v-if="!isOnline" class="add-offline" role="status">
        <!-- The design's slashed cloud, as in OfflineNote. -->
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 3l18 18" />
          <path d="M9 19h8a4 4 0 0 0 1.6-7.7" />
          <path d="M6 9.6A5 5 0 0 0 7 19" />
        </svg>
        Offline. It stays on this phone and sends itself later.
      </p>

      <div
        ref="amountGroup"
        class="add-amount"
        role="group"
        aria-label="Amount"
        tabindex="-1"
      >
        <span class="num amount-expr add-expr">{{ expression }}</span>
        <div class="add-amount-line">
          <component
            :is="fx ? 'button' : 'span'"
            class="num amount"
            :class="{
              'add-amount-empty': typed === null || typed.empty,
              'add-amount-dim': arriveEdit,
              'add-amount-btn': fx,
            }"
            :type="fx ? 'button' : undefined"
            :aria-label="
              fx
                ? arriveEdit
                  ? `Amount ${shownAmount}. Type it again`
                  : `Amount ${shownAmount}`
                : undefined
            "
            aria-live="polite"
            aria-atomic="true"
            @click="arriveEdit = false"
            >{{ shownAmount }}</component
          >
          <span class="add-currency">{{ currency.code }}</span>
        </div>
        <button
          v-if="fx"
          class="num add-arrive"
          :class="{
            'add-arrive-warn': arriveWarn,
            'add-arrive-edit': arriveEdit,
          }"
          type="button"
          :aria-pressed="arriveEdit"
          :aria-label="`${arriveText}. Change`"
          @click="editArrive"
        >
          <span class="add-arrive-t">{{ arriveText }}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 20h4L19 9l-4-4L4 16v4z" />
          </svg>
        </button>
        <span v-if="!fx || keypadError" class="add-error">
          <span v-if="keypadError" class="error" role="alert">{{
            keypadError
          }}</span>
        </span>
      </div>

      <div class="add-field">
        <span class="lbl">{{ words.fromLabel }}</span>
        <BbChipGroup
          :model-value="accountId ?? 0"
          :options="
            accountChips.map((chip) => ({
              label: chip.label,
              value: chip.account.id,
            }))
          "
          :label="words.fromLabel"
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

      <div v-if="kind === 'transfer'" class="add-field">
        <span class="lbl">To</span>
        <BbChipGroup
          :model-value="toAccountId ?? 0"
          :options="
            toChips.map((chip) => ({
              label: chip.label,
              value: chip.account.id,
            }))
          "
          label="To"
          @update:model-value="pickTo(Number($event))"
        >
          <template #trailing>
            <BbChip
              variant="ghost"
              aria-label="All accounts to send to"
              @click="sheet = 'toAccount'"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>

      <button
        v-if="kind === 'expense'"
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

      <div v-if="kind !== 'transfer'" class="add-field">
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

      <div v-if="kind === 'expense' && envelopes.length" class="add-field">
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
          :aria-label="`${words.payerLabel}: ${payerName}. Change`"
          @click="sheet = 'payer'"
        >
          <span class="meta-l"
            ><BbIcon name="person" :size="13" />{{ words.payerLabel }}</span
          >
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
        v-show="!arriveEdit"
        :key="keypadKey"
        v-model:amount="amount"
        bare
        :allow-negative="kind === 'expense'"
        :currency="currency"
        label="Amount"
        @change="onAmountChange"
      />
      <BbAmountInput
        v-if="fx"
        v-show="arriveEdit"
        :key="`arrive-${arriveKey}`"
        bare
        :currency="toCurrency"
        label="Amount that arrives"
        @change="onArriveChange"
      />
      <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>
      <BbButton class="num" :disabled="!canSave" @click="save">{{
        saveLabel
      }}</BbButton>
    </div>
    <section v-if="saved" class="add-saved" aria-labelledby="add-saved-title">
      <span class="add-saved-icon success-icon">
        <BbIcon name="check" :size="34" />
      </span>
      <h2
        id="add-saved-title"
        ref="savedHeading"
        class="add-saved-title"
        tabindex="-1"
      >
        {{ saved.noun }} saved{{ saved.onPhone ? ' on this phone' : '' }}
      </h2>
      <p class="num add-saved-summary">{{ saved.summary }}</p>
      <p v-if="saved.noCategory" class="add-saved-note">
        No category yet. It waits in
        <RouterLink class="add-saved-link" to="/transactions?tab=needs-category"
          >Needs a category</RouterLink
        >.
      </p>
      <p v-if="saved.filled" class="add-saved-note">{{ saved.filled }}</p>
      <p v-if="undoError" class="error" role="alert">{{ undoError }}</p>
      <div class="add-saved-actions">
        <BbButton @click="goBack">Done</BbButton>
        <BbButton variant="secondary" @click="addAnother">Add another</BbButton>
        <BbButton
          variant="text"
          :needs-server="!saved.onPhone"
          :disabled="undoing"
          @click="undo"
          >Undo</BbButton
        >
      </div>
    </section>

    <AccountPickerSheet
      v-if="sheet === 'account' && options"
      :accounts="options.accounts"
      :selected-id="accountId"
      :profile-id="profileId"
      :title="words.fromSheet"
      @pick="pickAccountFromSheet"
      @close="sheet = null"
    />
    <AccountPickerSheet
      v-if="sheet === 'toAccount' && options"
      :accounts="toPool"
      :selected-id="toAccountId"
      :profile-id="profileId"
      title="Transfer to"
      @pick="pickToFromSheet"
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
        [...kindCategories].sort((a, b) => a.name.localeCompare(b.name))
      "
      :selected-id="category.id"
      :recent-ids="recentCategoryIds"
      :kind="categoryKind"
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
      :title="words.payerLabel"
      :hint="words.payerHint"
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
.add-offline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 13px;
  font-weight: 500;
}
.add-offline svg {
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
.add-amount-dim {
  opacity: 0.45;
}
.add-amount-btn {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
}
.add-arrive {
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  margin-top: 2px;
  padding: 0 12px;
  border: 0;
  border-radius: 16px;
  background: var(--soft);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
}
.add-arrive svg {
  flex: none;
}
.add-arrive-t {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.add-arrive-warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.add-arrive-edit {
  background: var(--surface);
  box-shadow: inset 0 0 0 2px var(--ink);
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
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px;
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
