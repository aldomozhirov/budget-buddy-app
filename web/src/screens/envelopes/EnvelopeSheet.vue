<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  accountsResponseSchema,
  addMonths,
  categoriesResponseSchema,
  currenciesResponseSchema,
  deleteEnvelopeResponseSchema,
  envelopeResponseSchema,
  formatMoney,
  settingsResponseSchema,
  type Category,
  type CoinSetting,
  type CreateEnvelopeRequest,
  type CurrencyOption,
  type Envelope,
  type UpdateEnvelopeRequest,
} from '@budget-buddy/shared';
import BbAmountInput, {
  type AmountChange,
} from '../../components/BbAmountInput.vue';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbConfirmSheet from '../../components/BbConfirmSheet.vue';
import BbSheet from '../../components/BbSheet.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import CurrencyPickerSheet from '../../components/CurrencyPickerSheet.vue';
import { callApi, EnvelopeApiError } from './envelopeApi.js';
import {
  envelopeCurrency,
  expenseCountText,
  monthName,
} from './envelopeFormat.js';

/**
 * The new and edit envelope sheet (UI-ENV-6): name, currency or coin,
 * monthly amount, mode, starting balance (new only) and default category,
 * with the keypad docked under the form while an amount is being typed.
 * The sheet reads what it needs (currencies, accounts, categories) itself.
 */
const props = defineProps<{
  /** The envelope to edit; left out for a new one. */
  envelope?: Envelope;
  /** The current month (`YYYY-MM`), for "Applies from the top-up on 1 …". */
  month: string;
}>();

const emit = defineEmits<{
  /** The envelope was created or changed. */
  saved: [envelope: Envelope];
  /** An unused envelope was deleted. */
  deleted: [id: number];
  /** The envelope was archived. */
  archived: [envelope: Envelope];
  /** Close button, scrim tap, swipe down, or after a save. */
  close: [];
}>();

type AmountField = 'monthly' | 'starting';
type Mode = 'carry_over' | 'reset';

const editing = props.envelope !== undefined;
const initialPlan = props.envelope?.pendingPlan ?? props.envelope?.plan;

const loading = ref(true);
const loadError = ref('');
const currencies = ref<CurrencyOption[]>([]);
const coins = ref<CoinSetting[]>([]);
const categories = ref<Category[]>([]);
const quickCodes = ref<string[]>([]);
const commonCurrency = ref('EUR');

const name = ref(props.envelope?.name ?? '');
const currencyCode = ref(props.envelope?.currency ?? '');
const monthly = ref(BigInt(initialPlan?.monthlyAmount ?? '0'));
const mode = ref<Mode>(initialPlan?.mode ?? 'reset');
/** Null while the starting balance is left to the proposal. */
const starting = ref<bigint | null>(null);
const categoryId = ref(props.envelope?.defaultCategoryId ?? 0);

const activeField = ref<AmountField | null>(editing ? null : 'monthly');
const typed = ref<AmountChange | null>(null);

const currencySheet = ref(false);
const categorySheet = ref(false);
const confirmDelete = ref(false);
const saving = ref(false);
const error = ref('');
const nameError = ref('');

const currency = computed(() =>
  envelopeCurrency(currencyCode.value || commonCurrency.value, coins.value),
);
const startingShown = computed(() => starting.value ?? monthly.value);
const currencyLocked = computed(() => props.envelope?.used === true);
const nextTopUp = computed(() => monthName(addMonths(props.month, 1)));
const showApplies = computed(() => {
  const plan = props.envelope?.plan;
  if (!editing || !plan) return false;
  return (
    monthly.value !== BigInt(plan.monthlyAmount) || mode.value !== plan.mode
  );
});
const keypadInvalid = computed(() => typed.value?.valid === false);
const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    !loading.value &&
    !saving.value &&
    !keypadInvalid.value,
);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (editing) return 'Save';
  return name.value.trim() ? 'Add envelope' : 'Name the envelope';
});

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

const modeHint = computed(() =>
  mode.value === 'reset'
    ? 'On the 1st it starts again from the monthly amount. What was left is dropped.'
    : 'On the 1st the monthly amount is added to what’s left, or to the overspend.',
);
const archiveHint = computed(() => {
  const count = props.envelope?.expenseCount ?? 0;
  if (count === 0) {
    return 'It has adjustments, so it can only be archived. They keep this envelope.';
  }
  return `It has ${expenseCountText(count)}, so it can only be archived. ${
    count === 1 ? 'It keeps' : 'They keep'
  } this envelope.`;
});

// An unfinished expression must not block Save once the keypad is away: the
// field then shows its last valid value.
watch(activeField, (field) => {
  if (field === null) typed.value = null;
});

onMounted(() => void load());

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [currencyData, settings, accounts, categoryData] = await Promise.all([
      callApi('GET', '/api/currencies', currenciesResponseSchema),
      callApi('GET', '/api/settings', settingsResponseSchema),
      callApi('GET', '/api/accounts', accountsResponseSchema),
      callApi('GET', '/api/categories', categoriesResponseSchema),
    ]);
    currencies.value = currencyData.currencies;
    coins.value = currencyData.coins;
    commonCurrency.value = settings.commonCurrency;
    categories.value = categoryData.categories;
    // The family's currencies: the common one first, then by use.
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
    if (!currencyCode.value) currencyCode.value = settings.commonCurrency;
  } catch (cause) {
    loadError.value =
      cause instanceof EnvelopeApiError
        ? cause.message
        : 'Could not load the envelope options. Try again.';
  } finally {
    loading.value = false;
  }
}

/**
 * Puts the keypad on a field, empty so that typing replaces the amount;
 * tapping the active field again puts it away.
 */
function activate(field: AmountField): void {
  if (activeField.value === field) {
    activeField.value = null;
    return;
  }
  activeField.value = field;
  typed.value = null;
}

function onAmountChange(change: AmountChange): void {
  typed.value = change;
  if (!change.valid) return;
  if (activeField.value === 'monthly') monthly.value = change.amount ?? 0n;
  else starting.value = change.amount;
}

function pickCurrency(code: string): void {
  currencyCode.value = code;
  currencySheet.value = false;
  // The amounts keep their numbers, so what was typed must be read again.
  typed.value = null;
}

function pickCategory(category: Category): void {
  if (!categories.value.some((item) => item.id === category.id)) {
    categories.value = [...categories.value, category];
  }
  categoryId.value = category.id;
  categorySheet.value = false;
}

function amountText(field: AmountField): string {
  if (activeField.value === field && typed.value) return typed.value.text;
  return formatMoney(
    field === 'monthly' ? monthly.value : startingShown.value,
    currency.value,
  );
}

function messageFor(cause: unknown): string {
  return cause instanceof EnvelopeApiError
    ? cause.message
    : 'Could not save the envelope. Try again.';
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  nameError.value = '';
  try {
    if (props.envelope) {
      const body: UpdateEnvelopeRequest = {};
      const before = props.envelope;
      if (name.value.trim() !== before.name) body.name = name.value.trim();
      if ((categoryId.value || null) !== before.defaultCategoryId) {
        body.defaultCategoryId = categoryId.value || null;
      }
      if (currencyCode.value !== before.currency) {
        body.currency = currencyCode.value;
        body.confirm = true;
      }
      if (monthly.value !== BigInt(initialPlan?.monthlyAmount ?? '0')) {
        body.monthlyAmount = monthly.value.toString();
      }
      if (mode.value !== (initialPlan?.mode ?? 'reset')) body.mode = mode.value;
      if (Object.keys(body).length === 0) {
        emit('close');
        return;
      }
      const { envelope } = await callApi(
        'PATCH',
        `/api/envelopes/${before.id}`,
        envelopeResponseSchema,
        body,
      );
      emit('saved', envelope);
    } else {
      const body: CreateEnvelopeRequest = {
        name: name.value.trim(),
        currency: currencyCode.value,
        monthlyAmount: monthly.value.toString(),
        mode: mode.value,
        startingBalance: startingShown.value.toString(),
        ...(categoryId.value ? { defaultCategoryId: categoryId.value } : {}),
      };
      const { envelope } = await callApi(
        'POST',
        '/api/envelopes',
        envelopeResponseSchema,
        body,
      );
      emit('saved', envelope);
    }
    emit('close');
  } catch (cause) {
    if (cause instanceof EnvelopeApiError && cause.fields.name) {
      nameError.value = cause.fields.name;
    } else {
      error.value = messageFor(cause);
    }
  } finally {
    saving.value = false;
  }
}

async function archive(): Promise<void> {
  if (!props.envelope || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const { envelope } = await callApi(
      'PATCH',
      `/api/envelopes/${props.envelope.id}`,
      envelopeResponseSchema,
      { archived: true },
    );
    emit('archived', envelope);
    emit('close');
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  if (!props.envelope || saving.value) return;
  confirmDelete.value = false;
  saving.value = true;
  error.value = '';
  try {
    await callApi(
      'DELETE',
      `/api/envelopes/${props.envelope.id}`,
      deleteEnvelopeResponseSchema,
    );
    emit('deleted', props.envelope.id);
    emit('close');
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BbSheet
    :title="editing ? 'Edit envelope' : 'New envelope'"
    tall
    @close="emit('close')"
  >
    <div class="env-body scroll">
      <p v-if="loading" role="status">Loading…</p>
      <div v-else-if="loadError" role="alert">
        <p class="error">{{ loadError }}</p>
        <BbButton variant="text" @click="load">Try again</BbButton>
      </div>
      <template v-else>
        <div class="env-field">
          <label class="lbl" for="env-name">Name</label>
          <input
            id="env-name"
            v-model="name"
            class="text"
            type="text"
            autocomplete="off"
            placeholder="e.g. Groceries"
            :aria-invalid="Boolean(nameError)"
            @focus="activeField = null"
          />
          <span v-if="nameError" class="error" role="alert">{{
            nameError
          }}</span>
        </div>

        <div class="env-field">
          <span id="env-lbl-currency" class="lbl">Currency or coin</span>
          <BbChipGroup
            v-model="currencyCode"
            :options="currencyChips"
            label="Currency or coin"
            :disabled="currencyLocked"
          >
            <template #trailing>
              <BbChip
                variant="ghost"
                aria-haspopup="dialog"
                aria-label="Other currency or coin"
                :disabled="currencyLocked"
                @click="currencySheet = true"
                >Other…</BbChip
              >
            </template>
          </BbChipGroup>
          <span v-if="currencyLocked" class="env-hint"
            >The currency stays: it has expenses.</span
          >
        </div>

        <div class="env-field">
          <span id="env-lbl-monthly" class="lbl">Monthly amount</span>
          <button
            class="amt"
            :class="{ 'amt-on': activeField === 'monthly' }"
            type="button"
            aria-labelledby="env-lbl-monthly"
            :aria-pressed="activeField === 'monthly'"
            @click="activate('monthly')"
          >
            <span class="num amt-v" :class="{ muted: monthly === 0n }">{{
              amountText('monthly')
            }}</span>
            <span class="amt-c">{{ currency.code }}</span>
          </button>
        </div>

        <div class="env-field">
          <span class="lbl">Each month</span>
          <BbChipGroup
            v-model="mode"
            class="env-mode"
            label="Each month"
            :options="[
              { label: 'Resets monthly', value: 'reset' },
              { label: 'Carries over', value: 'carry_over' },
            ]"
          />
          <span class="env-hint">{{ modeHint }}</span>
          <span v-if="showApplies" class="env-hint"
            >Applies from the top-up on 1 {{ nextTopUp }}.</span
          >
        </div>

        <div v-if="!editing" class="env-field">
          <span id="env-lbl-start" class="lbl"
            >Starting balance · what’s in it now</span
          >
          <button
            class="amt"
            :class="{ 'amt-on': activeField === 'starting' }"
            type="button"
            aria-labelledby="env-lbl-start"
            :aria-pressed="activeField === 'starting'"
            @click="activate('starting')"
          >
            <span class="num amt-v" :class="{ muted: starting === null }">{{
              amountText('starting')
            }}</span>
            <span v-if="starting === null" class="amt-c"
              >Proposed: the monthly amount</span
            >
          </button>
        </div>

        <div class="env-field">
          <span class="lbl"
            >Default category · used on save when an expense has none</span
          >
          <BbChipGroup
            v-model="categoryId"
            label="Default category"
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

        <div v-if="editing" class="env-danger">
          <span class="env-hint">{{
            envelope?.used ? archiveHint : 'Unused, so it can be deleted.'
          }}</span>
          <BbButton
            variant="secondary-sm"
            needs-server
            :disabled="saving"
            @click="envelope?.used ? archive() : (confirmDelete = true)"
            >{{ envelope?.used ? 'Archive' : 'Delete' }}</BbButton
          >
        </div>
      </template>
    </div>

    <BbAmountInput
      v-if="activeField"
      :key="activeField"
      class="env-keys"
      bare
      :allow-negative="activeField === 'starting'"
      :currency="currency"
      label="Amount"
      @change="onAmountChange"
    />
    <p v-if="typed?.error" class="error" role="alert">{{ typed.error }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <BbButton needs-server :disabled="!canSave" @click="save">{{
      saveLabel
    }}</BbButton>
  </BbSheet>

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
  <BbConfirmSheet
    v-if="confirmDelete"
    :title="`Delete ${envelope?.name ?? 'envelope'}?`"
    message="It has no expenses or adjustments. Its monthly plan goes with it."
    confirm-label="Delete"
    cancel-label="Keep it"
    danger
    @confirm="remove"
    @cancel="confirmDelete = false"
  />
</template>

<style scoped>
.env-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 4px;
}
.env-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.env-hint {
  font-size: 12px;
  color: var(--muted);
}
.env-mode :deep(.chip-target) {
  flex: 1;
}
.env-mode :deep(.chip) {
  flex: 1;
  justify-content: center;
}
.amt {
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
.amt-on {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}
.amt-v {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
}
.amt-v.muted {
  color: var(--muted);
}
.amt-c {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.env-danger {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.env-danger .env-hint {
  flex: 1;
  font-size: 13px;
}
.env-danger :deep(.secondary) {
  flex: none;
  height: 44px;
  padding: 0 16px;
  border-radius: 22px;
  background: var(--bg);
  font-size: 14px;
}
.env-keys :deep(.key) {
  height: 46px;
}
</style>
