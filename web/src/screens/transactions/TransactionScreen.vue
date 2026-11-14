<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  accountOwnedName,
  accountsResponseSchema,
  addOptionsResponseSchema,
  categoriesResponseSchema,
  currenciesResponseSchema,
  deleteTransactionResponseSchema,
  envelopesResponseSchema,
  getCurrency,
  matchRule,
  membersResponseSchema,
  ruleResponseSchema,
  todayInTimeZone,
  transactionResponseSchema,
  wishResponseSchema,
  wishesResponseSchema,
  type AddOptionsAccount,
  type AddOptionsResponse,
  type Category,
  type CoinSetting,
  type Currency,
  type Envelope,
  type Transaction,
  type TransactionRevision,
  type UpdateTransactionRequest,
  type Wish,
  type KnownMerchant,
} from '@budget-buddy/shared';
import AccountPickerSheet from '../../components/AccountPickerSheet.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbConfirmSheet from '../../components/BbConfirmSheet.vue';
import BbIcon from '../../components/BbIcon.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { useBack } from '../../composables/useBack.js';
import { accountCurrency } from '../add/addForm.js';
import DateSheet from '../add/DateSheet.vue';
import MerchantSheet, { type MerchantOption } from '../add/MerchantSheet.vue';
import NoteSheet from '../add/NoteSheet.vue';
import PayerSheet from '../add/PayerSheet.vue';
import AmountSheet from './AmountSheet.vue';
import CountsAsPanel from './CountsAsPanel.vue';
import CountsForSheet from './CountsForSheet.vue';
import { money } from './transactionsFormat.js';
import {
  amountsToRetype,
  carryAmount,
  countsAsText,
  countsForRowText,
  countsHint,
  countsInOtherCurrency,
  deleteText,
  headerAmount,
  longDate,
  monthName,
  PAGE_WORDS,
  recordLines,
  slashDate,
  wishInOtherCurrency,
  type PageNames,
  type RetypedAmount,
} from './transactionPage.js';

/**
 * One transaction (TXN-6, MEM-5, UI-TXN-4 to UI-TXN-8): the signed amount,
 * who and when, a detail row per field in the order of the Add form that
 * opens the Add form's own sheet, the rule offer after a category change,
 * the Record and Delete. Each change is saved as it is made. The account
 * rows open the account sheet; an account in another currency asks for the
 * amount first. Split and "Attach receipt" are left out (O12).
 */
defineOptions({ name: 'TransactionScreen' });

type SheetName =
  | 'account'
  | 'toAccount'
  | 'accountAmount'
  | 'amount'
  | 'toAmount'
  | 'merchant'
  | 'category'
  | 'countsFor'
  | 'date'
  | 'payer'
  | 'note';

const RECENT_CATEGORIES = 3;

const route = useRoute();
const { label: backLabel, goBack } = useBack();

const transaction = ref<Transaction | null>(null);
const revisions = ref<TransactionRevision[]>([]);
const options = ref<AddOptionsResponse | null>(null);
const members = ref(new Map<number, string>());
const accounts = ref(new Map<number, { name: string; currency: string }>());
const categories = ref<Category[]>([]);
const envelopes = ref<Envelope[]>([]);
const archivedEnvelopes = ref<Envelope[]>([]);
const coins = ref<CoinSetting[]>([]);
/** The wishes of the transaction's month that can be linked to. */
const monthWishes = ref<Wish[]>([]);
/** The wishes the Record names that still exist, by id. */
const wishNames = ref(new Map<number, { name: string; currency: string }>());
const loading = ref(true);
const loadError = ref('');

const sheet = ref<SheetName | null>(null);
const confirmingDelete = ref(false);
const saving = ref(false);
const actionError = ref('');
/** The category the rule offer is about (UI-TXN-6), until answered. */
const offerCategoryId = ref<number | null>(null);
const savedRule = ref('');
/** Remounts the envelope sheet's keypad after each saved amount. */
const countsKey = ref(0);

/** An account pick that waits for amounts in its currency. */
interface AccountChange {
  /** The change so far: the account id, then each amount typed. */
  change: UpdateTransactionRequest;
  /** The amounts still to type, the next one first. */
  steps: { field: RetypedAmount; currency: Currency; amount: bigint }[];
}
const accountChange = ref<AccountChange | null>(null);
const accountStep = computed(() => accountChange.value?.steps[0]);

const id = computed(() => Number(route.params.id));
const today = computed(() =>
  options.value
    ? todayInTimeZone(new Date(), options.value.timeZone)
    : '1970-01-01',
);
const timeZone = computed(() => options.value?.timeZone ?? 'UTC');

const names = computed<PageNames>(() => ({
  member: members.value,
  account: accounts.value,
  category: new Map(categories.value.map((item) => [item.id, item.name])),
  envelope: new Map(
    [...envelopes.value, ...archivedEnvelopes.value].map((item) => [
      item.id,
      { name: item.name, currency: item.currency },
    ]),
  ),
  wish: wishNames.value,
}));

const words = computed(() =>
  transaction.value ? PAGE_WORDS[transaction.value.kind] : PAGE_WORDS.expense,
);
const amountView = computed(() =>
  transaction.value ? headerAmount(transaction.value, coins.value) : null,
);
const account = computed(() =>
  transaction.value ? accounts.value.get(transaction.value.accountId) : null,
);
const toAccount = computed(() =>
  transaction.value?.toAccountId
    ? accounts.value.get(transaction.value.toAccountId)
    : null,
);
const categoryName = computed(() =>
  transaction.value?.categoryId
    ? names.value.category.get(transaction.value.categoryId)
    : undefined,
);
const envelopeName = computed(() =>
  transaction.value?.envelopeId
    ? names.value.envelope.get(transaction.value.envelopeId)?.name
    : undefined,
);
const payerName = computed(() =>
  transaction.value
    ? (members.value.get(transaction.value.memberId) ?? '')
    : '',
);
const crossCurrencyTransfer = computed(
  () =>
    transaction.value?.kind === 'transfer' &&
    transaction.value.toCurrency !== null &&
    transaction.value.toCurrency !== transaction.value.currency,
);
const arrivesText = computed(() =>
  transaction.value?.toCurrency
    ? money(
        transaction.value.toAmount ?? '0',
        transaction.value.toCurrency,
        coins.value,
      )
    : '',
);
const fx = computed(
  () =>
    transaction.value !== null &&
    (countsInOtherCurrency(transaction.value) ||
      wishInOtherCurrency(transaction.value)),
);
const forWish = computed(() => transaction.value?.countsFor.type === 'wish');

const title = computed(() => {
  const value = transaction.value;
  if (!value) return words.value.title;
  if (value.kind === 'transfer') {
    return `${account.value?.name ?? ''} → ${toAccount.value?.name ?? ''}`;
  }
  return value.merchant ?? categoryName.value ?? words.value.title;
});
const dateLine = computed(() =>
  transaction.value
    ? `${longDate(transaction.value.date, today.value)} · ${words.value.by} ${payerName.value}`
    : '',
);
const countsForText = computed(() =>
  transaction.value
    ? countsForRowText(transaction.value, envelopeName.value, coins.value)
    : '',
);
const wishLinks = computed(() =>
  monthWishes.value.filter((wish) => wish.state !== 'dropped'),
);
const record = computed(() =>
  transaction.value
    ? recordLines(
        transaction.value,
        revisions.value,
        names.value,
        coins.value,
        timeZone.value,
        today.value,
      )
    : [],
);

const categoryKind = computed(() =>
  transaction.value?.kind === 'income' ? 'income' : 'expense',
);
const pickableCategories = computed(() =>
  categories.value
    .filter((item) => item.kind === categoryKind.value && !item.archived)
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const recentCategoryIds = computed(() =>
  (options.value?.categories ?? [])
    .filter((item) => item.kind === categoryKind.value)
    .slice(0, RECENT_CATEGORIES)
    .map((item) => item.id),
);
const payers = computed(() => {
  const active = options.value?.profiles ?? [];
  const current = transaction.value?.memberId;
  return current === undefined || active.some((item) => item.id === current)
    ? active
    : [...active, { id: current, name: payerName.value }];
});

/** Maps known merchants to the sheet's rows with what their rule fills. */
function toOptions(list: KnownMerchant[]): MerchantOption[] {
  const data = options.value;
  if (!data) return [];
  const byId = names.value;
  return list.map((item) => {
    const match = matchRule(
      item.merchant,
      transaction.value?.accountId ?? null,
      data.rules,
    );
    const ruleCategory = match ? byId.category.get(match.categoryId) : null;
    const ruleEnvelope = match?.envelopeId
      ? byId.envelope.get(match.envelopeId)?.name
      : null;
    const detail = ruleCategory
      ? `Rule: ${ruleCategory}${
          ruleEnvelope && ruleEnvelope !== ruleCategory
            ? ` · ${ruleEnvelope}`
            : ''
        }`
      : 'Used before';
    return { ...item, detail };
  });
}

const merchants = computed(() => toOptions(options.value?.merchants ?? []));
const recentMerchants = computed(() =>
  toOptions(options.value?.recentMerchants ?? []),
);

const offerText = computed(() => {
  const merchant = transaction.value?.merchant;
  const category =
    offerCategoryId.value !== null
      ? names.value.category.get(offerCategoryId.value)
      : undefined;
  return merchant && category
    ? { question: `Always label ${merchant} as ${category}?`, merchant }
    : null;
});

/** The currency of the amount a sheet edits, when it is known. */
const amountCurrency = computed<Currency | undefined>(() =>
  transaction.value
    ? getCurrency(transaction.value.currency, coins.value)
    : undefined,
);
const arrivesCurrency = computed<Currency | undefined>(() =>
  transaction.value?.toCurrency
    ? getCurrency(transaction.value.toCurrency, coins.value)
    : undefined,
);
/** The active accounts a sheet offers, without the other side's. */
const pickableAccounts = computed<AddOptionsAccount[]>(() => {
  const now = transaction.value;
  const all = options.value?.accounts ?? [];
  if (!now || now.kind !== 'transfer') return all;
  const other = sheet.value === 'toAccount' ? now.accountId : now.toAccountId;
  return all.filter((item) => item.id !== other);
});
/** The currency of the amount "counts as" types: the wish's or envelope's. */
const countsCurrency = computed<Currency | undefined>(() => {
  const now = transaction.value;
  const code = forWish.value
    ? now?.countsFor.linkCurrency
    : now?.envelopeCurrency;
  return code ? getCurrency(code, coins.value) : undefined;
});

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0
    ? cause.message
    : fallback;
}

/**
 * Reads the wishes of the transaction's month for the sheet, and the wishes
 * the Record names, for today's names. A failure leaves them as they were:
 * the page works without them.
 */
async function loadWishes(): Promise<void> {
  const now = transaction.value;
  if (!now || now.kind !== 'expense') return;
  try {
    const answer = await callApi(
      'GET',
      `/api/wishes?month=${now.date.slice(0, 7)}`,
      wishesResponseSchema,
    );
    monthWishes.value = answer.wishes;
  } catch {
    monthWishes.value = [];
  }
  const known = new Map<number, { name: string; currency: string }>();
  for (const wish of monthWishes.value) {
    known.set(wish.id, { name: wish.name, currency: wish.currency });
  }
  const wanted = new Set<number>();
  for (const revision of revisions.value) {
    for (const link of revision.changes.link ?? []) {
      if (link) wanted.add(link.wishId);
    }
    if (revision.changes.linkWish) wanted.add(revision.changes.linkWish.wishId);
  }
  await Promise.all(
    [...wanted]
      .filter((wishId) => !known.has(wishId))
      .map(async (wishId) => {
        try {
          const { wish } = await callApi(
            'GET',
            `/api/wishes/${wishId}`,
            wishResponseSchema,
          );
          known.set(wish.id, { name: wish.name, currency: wish.currency });
        } catch {
          // A deleted wish stays named by the snapshot in the Record.
        }
      }),
  );
  wishNames.value = known;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [
      found,
      addOptions,
      membersAnswer,
      accountsAnswer,
      categoriesAnswer,
      active,
      archived,
      money,
    ] = await Promise.all([
      callApi(
        'GET',
        `/api/transactions/${id.value}`,
        transactionResponseSchema,
      ),
      callApi('GET', '/api/add-options', addOptionsResponseSchema),
      callApi('GET', '/api/members', membersResponseSchema),
      callApi('GET', '/api/accounts?inactive=true', accountsResponseSchema),
      callApi('GET', '/api/categories', categoriesResponseSchema),
      callApi('GET', '/api/envelopes', envelopesResponseSchema),
      callApi('GET', '/api/envelopes?archived=true', envelopesResponseSchema),
      callApi('GET', '/api/currencies', currenciesResponseSchema),
    ]);
    transaction.value = found.transaction;
    revisions.value = found.revisions;
    options.value = addOptions;
    members.value = new Map(membersAnswer.members.map((m) => [m.id, m.name]));
    accounts.value = new Map(
      accountsAnswer.accounts.map((item) => [
        item.id,
        {
          name: accountOwnedName(item, addOptions.profileId),
          currency: item.currency,
        },
      ]),
    );
    categories.value = categoriesAnswer.categories;
    envelopes.value = active.envelopes;
    archivedEnvelopes.value = archived.envelopes;
    coins.value = money.coins;
    await loadWishes();
  } catch (cause) {
    loadError.value = errorText(
      cause,
      'Could not load the transaction. Check your connection and try again.',
    );
  } finally {
    loading.value = false;
  }
}

/**
 * Saves a change as it is made. The answer replaces the transaction and its
 * Record; a refusal is shown above the rows and nothing changes.
 * @returns whether the change was saved.
 */
async function save(change: UpdateTransactionRequest): Promise<boolean> {
  saving.value = true;
  actionError.value = '';
  try {
    const answer = await callApi(
      'PATCH',
      `/api/transactions/${id.value}`,
      transactionResponseSchema,
      change,
    );
    transaction.value = answer.transaction;
    revisions.value = answer.revisions;
    countsKey.value += 1;
    void loadWishes();
    return true;
  } catch (cause) {
    actionError.value = errorText(
      cause,
      'Could not save the change. Check your connection and try again.',
    );
    return false;
  } finally {
    saving.value = false;
  }
}

function openSheet(name: SheetName): void {
  actionError.value = '';
  sheet.value = name;
  if (name === 'countsFor') void loadWishes();
}

/**
 * Saves a picked account at once, or first asks for the amounts its
 * currency needs (amountsToRetype), each filled with the number now.
 */
async function pickAccount(
  side: 'from' | 'to',
  picked: AddOptionsAccount | null,
): Promise<void> {
  const now = transaction.value;
  sheet.value = null;
  if (!now || !picked) return;
  if (picked.id === (side === 'from' ? now.accountId : now.toAccountId)) {
    return;
  }
  const change: UpdateTransactionRequest =
    side === 'from' ? { accountId: picked.id } : { toAccountId: picked.id };
  const fields = amountsToRetype(now, side, picked.currency);
  if (!fields.length) {
    await save(change);
    return;
  }
  const pickedCurrency = accountCurrency(picked);
  const fromCurrency = side === 'from' ? pickedCurrency : amountCurrency.value;
  const toCurrency = side === 'to' ? pickedCurrency : arrivesCurrency.value;
  const steps: AccountChange['steps'] = [];
  for (const field of fields) {
    const currency = field === 'amount' ? fromCurrency : toCurrency;
    const old =
      field === 'amount' ? amountCurrency.value : arrivesCurrency.value;
    if (!currency) return;
    const value = BigInt(
      field === 'amount' ? now.amount : (now.toAmount ?? now.amount),
    );
    steps.push({
      field,
      currency,
      amount: old ? carryAmount(value, old.decimals, currency.decimals) : value,
    });
  }
  accountChange.value = { change, steps };
  openSheet('accountAmount');
}

/** Keeps a typed amount; the last one saves the account change. */
async function saveAccountAmount(amount: bigint): Promise<void> {
  const pending = accountChange.value;
  const step = pending?.steps[0];
  if (!pending || !step) return;
  const change = { ...pending.change, [step.field]: amount.toString() };
  const steps = pending.steps.slice(1);
  if (steps.length) {
    accountChange.value = { change, steps };
    return;
  }
  // A refusal shows on the page; the stored transaction stays as it was.
  await save(change);
  closeAccountChange();
}

function closeAccountChange(): void {
  sheet.value = null;
  accountChange.value = null;
}

async function pickMerchant(merchant: string): Promise<void> {
  sheet.value = null;
  const now = transaction.value;
  if (!now || merchant === (now.merchant ?? '')) return;
  offerCategoryId.value = null;
  savedRule.value = '';
  await save({ merchant });
}

async function pickCategory(picked: Category): Promise<void> {
  sheet.value = null;
  const now = transaction.value;
  if (!categories.value.some((item) => item.id === picked.id)) {
    // A category added in the sheet joins the lookups.
    categories.value = [...categories.value, picked];
  }
  if (!now || picked.id === now.categoryId) return;
  savedRule.value = '';
  if (await save({ categoryId: picked.id })) offerRule(picked.id);
}

/** Offers a rule unless one already gives this merchant that category. */
function offerRule(categoryId: number): void {
  const now = transaction.value;
  const data = options.value;
  if (!now || !data || !now.merchant) {
    offerCategoryId.value = null;
    return;
  }
  const match = matchRule(now.merchant, now.accountId, data.rules);
  offerCategoryId.value = match?.categoryId === categoryId ? null : categoryId;
}

async function saveRule(): Promise<void> {
  const now = transaction.value;
  const data = options.value;
  const categoryId = offerCategoryId.value;
  if (!now?.merchant || !data || categoryId === null) return;
  saving.value = true;
  actionError.value = '';
  try {
    // Commas separate a rule's words, so a comma in a name is a space.
    const pattern = now.merchant.replace(/,/gu, ' ').replace(/\s+/gu, ' ');
    const answer = await callApi('POST', '/api/rules', ruleResponseSchema, {
      pattern: pattern.trim(),
      categoryId,
      placement: 'first',
    });
    data.rules = [answer.rule, ...data.rules];
    savedRule.value = `Rule saved: ${now.merchant} → ${
      names.value.category.get(categoryId) ?? ''
    }`;
    offerCategoryId.value = null;
  } catch (cause) {
    actionError.value = errorText(
      cause,
      'Could not save the rule. Check your connection and try again.',
    );
  } finally {
    saving.value = false;
  }
}

/**
 * Picks an envelope, which also removes a wish link (PLN-14). Another
 * currency keeps the sheet open for the "counts as" keypad.
 */
async function pickEnvelope(picked: Envelope): Promise<void> {
  const now = transaction.value;
  if (!now) return;
  if (picked.id === now.envelopeId) {
    if (picked.currency === now.currency) sheet.value = null;
    return;
  }
  if (picked.currency === now.currency) sheet.value = null;
  const saved = await save({ envelopeId: picked.id });
  if (!saved) sheet.value = null;
}

/**
 * Picks a wish of the month, which takes the expense out of its envelope.
 * Another currency keeps the sheet open for "Counts for the wish as".
 */
async function pickWish(picked: Wish): Promise<void> {
  const now = transaction.value;
  if (!now) return;
  const sameCurrency = picked.currency === now.currency;
  if (now.countsFor.type === 'wish' && now.countsFor.id === picked.id) {
    if (sameCurrency) sheet.value = null;
    return;
  }
  if (sameCurrency) sheet.value = null;
  const saved = await save({ wishId: picked.id });
  if (!saved) sheet.value = null;
}

/** Picks "Unplanned": no envelope and no wish. */
async function pickNeither(): Promise<void> {
  const now = transaction.value;
  sheet.value = null;
  if (!now) return;
  const change: UpdateTransactionRequest = {};
  if (now.countsFor.type === 'wish') change.wishId = null;
  if (now.envelopeId !== null) change.envelopeId = null;
  if (Object.keys(change).length) await save(change);
}

async function saveCounts(amount: bigint): Promise<void> {
  const now = transaction.value;
  if (!now) return;
  const sign = BigInt(now.amount) < 0n ? -1n : 1n;
  const typed = (sign * amount).toString();
  const saved = await save(
    forWish.value ? { linkAmount: typed } : { envelopeAmount: typed },
  );
  if (saved) sheet.value = null;
}

async function saveAmount(amount: bigint): Promise<void> {
  const kept = sheet.value;
  const saved = await save(
    kept === 'toAmount'
      ? { toAmount: amount.toString() }
      : { amount: amount.toString() },
  );
  if (saved) sheet.value = null;
}

async function pickDate(date: string): Promise<void> {
  sheet.value = null;
  if (date !== transaction.value?.date) await save({ date });
}

async function pickPayer(memberId: number): Promise<void> {
  sheet.value = null;
  if (memberId !== transaction.value?.memberId) await save({ memberId });
}

async function saveNote(note: string): Promise<void> {
  sheet.value = null;
  if (note !== (transaction.value?.note ?? '')) await save({ note });
}

async function remove(): Promise<void> {
  saving.value = true;
  actionError.value = '';
  try {
    await callApi(
      'DELETE',
      `/api/transactions/${id.value}`,
      deleteTransactionResponseSchema,
    );
    goBack();
  } catch (cause) {
    confirmingDelete.value = false;
    actionError.value = errorText(
      cause,
      'Could not delete the transaction. Check your connection and try again.',
    );
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <main class="screen app-screen transaction-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <h1 class="t-title transaction-heading">{{ words.title }}</h1>
    </header>

    <div class="content app-content">
      <p v-if="loading" role="status">Loading transaction…</p>
      <div v-else-if="loadError" role="alert">
        <p class="error">{{ loadError }}</p>
        <button class="text-btn" type="button" @click="load">Try again</button>
      </div>
      <template v-else-if="transaction && amountView">
        <div class="transaction-hero">
          <button
            class="num transaction-amount"
            :class="`tone-${amountView.tone}`"
            type="button"
            aria-label="Change amount"
            aria-haspopup="dialog"
            @click="openSheet('amount')"
          >
            {{ amountView.text }}
          </button>
          <span class="transaction-title">{{ title }}</span>
          <span class="t-sub">{{ dateLine }}</span>
        </div>

        <div v-if="offerText" class="banner">
          <span class="transaction-offer">{{ offerText.question }}</span>
          <span class="t-sub"
            >New {{ offerText.merchant }} expenses will get this category
            automatically. You can edit rules in Settings.</span
          >
          <div class="transaction-offer-buttons">
            <button
              class="chip chip-sm chip-on"
              type="button"
              :disabled="saving"
              @click="saveRule"
            >
              Save rule
            </button>
            <button
              class="chip chip-sm"
              type="button"
              @click="offerCategoryId = null"
            >
              Just this once
            </button>
          </div>
        </div>
        <p v-if="savedRule" class="banner transaction-saved" role="status">
          <BbIcon name="check" :size="16" />{{ savedRule }}
        </p>
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>

        <div class="card">
          <button
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('account')"
          >
            <span class="field-l">{{ words.fromLabel }}</span>
            <span class="field-v"
              >{{ account?.name }} · {{ account?.currency }}</span
            >
          </button>
          <button
            v-if="transaction.kind === 'transfer' && transaction.toAccountId"
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('toAccount')"
          >
            <span class="field-l">To</span>
            <span class="field-v"
              >{{ toAccount?.name }} · {{ toAccount?.currency }}</span
            >
          </button>
          <button
            v-if="transaction.kind === 'expense'"
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('merchant')"
          >
            <span class="field-l">Merchant</span>
            <span
              class="field-v"
              :class="{ 'is-empty': transaction.merchant === null }"
              >{{ transaction.merchant ?? 'Add a merchant' }}</span
            >
          </button>
          <button
            v-if="transaction.kind !== 'transfer'"
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('category')"
          >
            <span class="field-l">Category</span>
            <span
              class="field-v"
              :class="{ 'is-empty': transaction.categoryId === null }"
              >{{ categoryName ?? 'No category' }}</span
            >
          </button>
          <button
            v-if="transaction.kind === 'expense'"
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('countsFor')"
          >
            <span class="field-l">Counts for</span>
            <span
              class="field-v num"
              :class="{ 'is-wrapped': fx }"
              data-testid="counts-for-value"
              >{{ countsForText }}</span
            >
          </button>
          <template v-if="transaction.kind === 'transfer'">
            <button
              class="field"
              data-testid="detail-row"
              type="button"
              aria-haspopup="dialog"
              @click="openSheet('amount')"
            >
              <span class="field-l">Amount</span>
              <span class="field-v num">{{ amountView.text }}</span>
            </button>
            <button
              v-if="crossCurrencyTransfer"
              class="field"
              data-testid="detail-row"
              type="button"
              aria-haspopup="dialog"
              @click="openSheet('toAmount')"
            >
              <span class="field-l">Arrives</span>
              <span class="field-v num">{{ arrivesText }}</span>
            </button>
          </template>
          <button
            v-if="transaction.kind === 'transfer'"
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('payer')"
          >
            <span class="field-l">{{ words.payerLabel }}</span>
            <span class="field-v">{{ payerName }}</span>
          </button>
          <button
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('date')"
          >
            <span class="field-l">Date</span>
            <span class="field-v num">{{ slashDate(transaction.date) }}</span>
          </button>
          <button
            v-if="transaction.kind !== 'transfer'"
            class="field"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('payer')"
          >
            <span class="field-l">{{ words.payerLabel }}</span>
            <span class="field-v">{{ payerName }}</span>
          </button>
          <button
            class="field transaction-last"
            data-testid="detail-row"
            type="button"
            aria-haspopup="dialog"
            @click="openSheet('note')"
          >
            <span class="field-l">Note</span>
            <span
              class="field-v"
              :class="{ 'is-empty': transaction.note === null }"
              >{{ transaction.note ?? 'Add a note' }}</span
            >
          </button>
        </div>

        <section class="transaction-record" aria-labelledby="record-title">
          <h2 id="record-title" class="transaction-record-title">Record</h2>
          <div class="card">
            <div v-for="line in record" :key="line.key" class="row">
              <BbIcon name="note" :size="18" />
              <span class="row-l transaction-record-text">{{ line.text }}</span>
              <span class="num t-sub">{{ line.when }}</span>
            </div>
          </div>
        </section>

        <BbButton
          variant="secondary"
          class="danger"
          needs-server
          @click="confirmingDelete = true"
          >Delete</BbButton
        >
      </template>
    </div>

    <template v-if="transaction && options">
      <AccountPickerSheet
        v-if="sheet === 'account'"
        :accounts="pickableAccounts"
        :selected-id="transaction.accountId"
        :profile-id="options.profileId"
        :title="words.fromSheet"
        @pick="pickAccount('from', $event)"
        @close="sheet = null"
      />
      <AccountPickerSheet
        v-if="sheet === 'toAccount'"
        :accounts="pickableAccounts"
        :selected-id="transaction.toAccountId"
        :profile-id="options.profileId"
        title="Transfer to"
        @pick="pickAccount('to', $event)"
        @close="sheet = null"
      />
      <AmountSheet
        v-if="sheet === 'accountAmount' && accountStep"
        :key="accountStep.field"
        :title="
          accountStep.field === 'amount' ? 'Amount' : 'Amount that arrives'
        "
        :currency="accountStep.currency"
        :amount="accountStep.amount"
        :allow-negative="
          transaction.kind === 'expense' && accountStep.field === 'amount'
        "
        :saving="saving"
        @save="saveAccountAmount"
        @close="closeAccountChange"
      />
      <MerchantSheet
        v-if="sheet === 'merchant'"
        :merchants="merchants"
        :recent="recentMerchants"
        :selected="transaction.merchant ?? ''"
        @pick="pickMerchant"
        @close="sheet = null"
      />
      <CategoryPickerSheet
        v-if="sheet === 'category'"
        :categories="pickableCategories"
        :selected-id="transaction.categoryId"
        :recent-ids="recentCategoryIds"
        :kind="categoryKind"
        @pick="pickCategory"
        @close="sheet = null"
      />
      <CountsForSheet
        v-if="sheet === 'countsFor'"
        :envelopes="envelopes"
        :wishes="wishLinks"
        :coins="coins"
        :month-name="monthName(transaction.date)"
        :envelope-id="transaction.envelopeId"
        :wish-id="
          transaction.countsFor.type === 'wish'
            ? (transaction.countsFor.id ?? null)
            : null
        "
        :wish-name="transaction.countsFor.name"
        @envelope="pickEnvelope"
        @wish="pickWish"
        @none="pickNeither"
        @close="sheet = null"
      >
        <template v-if="fx && countsCurrency" #after>
          <CountsAsPanel
            :key="countsKey"
            :label="
              forWish ? 'Counts for the wish as' : 'Counts in the envelope as'
            "
            :currency="countsCurrency"
            :current="countsAsText(transaction, coins)"
            :hint="countsHint(transaction, coins, today)"
            :saving="saving"
            @save="saveCounts"
          />
        </template>
      </CountsForSheet>
      <DateSheet
        v-if="sheet === 'date'"
        :date="transaction.date"
        :today="today"
        @pick="pickDate"
        @close="sheet = null"
      />
      <PayerSheet
        v-if="sheet === 'payer'"
        :title="words.payerLabel"
        :hint="words.payerHint"
        :profiles="payers"
        :profile-id="options.profileId"
        :selected-id="transaction.memberId"
        @pick="pickPayer"
        @close="sheet = null"
      />
      <NoteSheet
        v-if="sheet === 'note'"
        :note="transaction.note ?? ''"
        @save="saveNote"
        @close="sheet = null"
      />
      <AmountSheet
        v-if="sheet === 'amount' && amountCurrency"
        title="Amount"
        :currency="amountCurrency"
        :amount="BigInt(transaction.amount)"
        :allow-negative="transaction.kind === 'expense'"
        :saving="saving"
        @save="saveAmount"
        @close="sheet = null"
      />
      <AmountSheet
        v-if="sheet === 'toAmount' && arrivesCurrency"
        title="Amount that arrives"
        :currency="arrivesCurrency"
        :amount="BigInt(transaction.toAmount ?? '0')"
        :allow-negative="false"
        :saving="saving"
        @save="saveAmount"
        @close="sheet = null"
      />
      <BbConfirmSheet
        v-if="confirmingDelete"
        :title="`Delete this ${words.noun}?`"
        :message="deleteText(transaction, envelopeName, coins)"
        confirm-label="Delete"
        cancel-label="Keep it"
        danger
        @confirm="remove"
        @cancel="confirmingDelete = false"
      />
    </template>
  </main>
</template>

<style scoped>
.transaction-screen .app-content {
  gap: 14px;
}
.transaction-heading {
  flex: 1;
  min-width: 0;
}
.transaction-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 0 8px;
}
.transaction-amount {
  font-size: 44px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.tone-in {
  color: var(--accent);
}
.transaction-title {
  font-size: 17px;
  font-weight: 500;
  text-align: center;
}
.transaction-offer {
  font-weight: 600;
}
.transaction-offer-buttons {
  display: flex;
  gap: 8px;
}
.transaction-saved {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
}
.is-empty {
  color: var(--muted);
  font-weight: 400;
}
/* The amount it counts as is the point of the row: it wraps, not clips. */
.is-wrapped {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  padding: 8px 0;
}
.transaction-last {
  border-bottom: 0;
}
.transaction-record {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.transaction-record-title {
  margin: 0 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}
.transaction-record-text {
  font-size: 14px;
}
</style>
