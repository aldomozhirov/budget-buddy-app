<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  accountResponseSchema,
  currenciesResponseSchema,
  formatMoney,
  getCurrency,
  membersResponseSchema,
  settingsResponseSchema,
  todayInTimeZone,
  type CurrencyOption,
  type CoinSetting,
  type ManagedMember,
} from '@budget-buddy/shared';
import BbAmountInput from '../../components/BbAmountInput.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbSheet from '../../components/BbSheet.vue';
import { useBack } from '../../composables/useBack.js';
import { authState, setAuthState } from '../../stores/auth.js';

/** Creates an account and its optional opening balance. */
defineOptions({ name: 'NewAccountScreen' });

const router = useRouter();
const { label: backLabel, goBack } = useBack();
const members = ref<ManagedMember[]>([]);
const currencies = ref<CurrencyOption[]>([]);
const coins = ref<CoinSetting[]>([]);
const timeZone = ref('Europe/Berlin');
const name = ref('');
const ownerId = ref<number>(authState.value?.member?.id ?? 1);
const type = ref('bank');
const currencyCode = ref('EUR');
const openingAmount = ref<bigint | null>(null);
const openingDate = ref('');
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const nameError = ref('');
const currenciesOpen = ref(false);
const amountOpen = ref(false);
const dateOpen = ref(false);
const currencySearch = ref('');

const currency = computed(() => getCurrency(currencyCode.value, coins.value));
const visibleCurrencies = computed(() =>
  currencies.value.filter((item) =>
    `${item.code} ${item.name}`
      .toLocaleLowerCase()
      .includes(currencySearch.value.toLocaleLowerCase()),
  ),
);
const previewBalance = computed(() =>
  formatMoney(openingAmount.value ?? 0n, currency.value ?? getCurrency('EUR')!),
);
const quickCurrencies = computed(() => {
  const preferred = ['EUR', 'USD', 'RUB', 'BTC'];
  return preferred
    .map((code) => currencies.value.find((item) => item.code === code))
    .filter((item): item is CurrencyOption => item !== undefined);
});
const canSave = computed(
  () => name.value.trim().length > 0 && !loading.value && !saving.value,
);

onMounted(() => void loadFormOptions());

async function loadFormOptions(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [memberResponse, currencyResponse, settingsResponse] =
      await Promise.all([
        fetch('/api/members'),
        fetch('/api/currencies'),
        fetch('/api/settings'),
      ]);
    if (
      [memberResponse, currencyResponse, settingsResponse].some(
        (response) => response.status === 401,
      )
    ) {
      setAuthState(null);
      await router.replace('/sign-in');
      return;
    }
    if (!memberResponse.ok || !currencyResponse.ok || !settingsResponse.ok) {
      throw new Error('Could not load account options. Try again.');
    }
    const [memberData, currencyData, settingsData] = await Promise.all([
      memberResponse.json(),
      currencyResponse.json(),
      settingsResponse.json(),
    ]);
    members.value = membersResponseSchema
      .parse(memberData)
      .members.filter((member) => member.active);
    const parsedCurrencies = currenciesResponseSchema.parse(currencyData);
    currencies.value = parsedCurrencies.currencies;
    coins.value = parsedCurrencies.coins;
    timeZone.value = settingsResponseSchema.parse(settingsData).timeZone;
    openingDate.value = todayInTimeZone(new Date(), timeZone.value);
    if (!members.value.some((member) => member.id === ownerId.value)) {
      ownerId.value = members.value[0]?.id ?? ownerId.value;
    }
    if (!currencies.value.some((item) => item.code === currencyCode.value)) {
      currencyCode.value = currencies.value[0]?.code ?? 'EUR';
    }
  } catch {
    error.value =
      'Could not load account options. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

function selectCurrency(code: string): void {
  currencyCode.value = code;
  currenciesOpen.value = false;
  currencySearch.value = '';
}

async function saveAccount(): Promise<void> {
  nameError.value = '';
  error.value = '';
  if (!name.value.trim()) {
    nameError.value = 'Enter an account name.';
    return;
  }
  if (!currency.value) {
    error.value = 'Choose a currency from the list.';
    return;
  }
  saving.value = true;
  try {
    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value.trim(),
        ownerMemberId: ownerId.value,
        type: type.value,
        currency: currencyCode.value,
        ...(openingAmount.value === null
          ? {}
          : {
              openingBalance: (type.value === 'we_owe'
                ? -openingAmount.value
                : openingAmount.value
              ).toString(),
              openingDate: openingDate.value,
            }),
      }),
    });
    const payload: unknown = await response.json();
    if (response.status === 401) {
      setAuthState(null);
      await router.replace('/sign-in');
      return;
    }
    if (!response.ok) {
      const message = (payload as { error?: { message?: string } }).error
        ?.message;
      throw new Error(message ?? 'Could not save this account. Try again.');
    }
    const { account } = accountResponseSchema.parse(payload);
    await router.push(`/accounts/${account.id}`);
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : 'Could not save this account. Try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="screen app-screen new-account-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <h1 class="t-title">New account</h1>
    </header>
    <div class="content new-account-content scroll">
      <p v-if="loading" role="status">Loading account options…</p>
      <template v-else>
        <div class="new-account-field">
          <label class="lbl" for="account-name">Name</label>
          <input
            id="account-name"
            v-model="name"
            class="text"
            autocomplete="off"
            placeholder="e.g. ING Girokonto"
            :aria-invalid="Boolean(nameError)"
          />
          <span v-if="nameError" class="error" role="alert">{{
            nameError
          }}</span>
        </div>
        <div class="new-account-field">
          <span class="lbl">Owner</span>
          <BbChipGroup
            v-model="ownerId"
            :options="
              members.map((member) => ({
                label: member.name,
                value: member.id,
              }))
            "
            label="Owner"
          />
        </div>
        <div class="new-account-field">
          <span class="lbl">Type</span>
          <div class="account-type-grid" role="radiogroup" aria-label="Type">
            <button
              v-for="option in [
                { label: 'Bank', value: 'bank' },
                { label: 'Cash', value: 'cash' },
                { label: 'Investment', value: 'investment' },
                { label: 'Crypto', value: 'crypto' },
                { label: 'Money we owe', value: 'we_owe' },
                { label: 'Money owed to us', value: 'owed_to_us' },
              ]"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="type === option.value"
              :class="[
                'account-type-option',
                { selected: type === option.value },
              ]"
              @click="type = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <p v-if="type === 'we_owe'" class="new-account-hint">
            Type what you owe as a positive number. It’s stored as a negative
            balance.
          </p>
        </div>
        <div class="new-account-field">
          <span class="lbl">Currency or coin</span>
          <div
            class="new-account-currencies"
            role="group"
            aria-label="Currency or coin"
          >
            <BbChip
              v-for="option in quickCurrencies"
              :key="option.code"
              variant="choice"
              :selected="currencyCode === option.code"
              @click="selectCurrency(option.code)"
              >{{ option.code }}</BbChip
            >
            <BbChip
              variant="ghost"
              aria-label="Other currency or coin"
              @click="currenciesOpen = true"
              >Other…</BbChip
            >
          </div>
        </div>
        <div class="new-account-field">
          <span class="lbl">Opening balance</span>
          <div class="opening-balance-control">
            <button
              class="opening-balance-button"
              type="button"
              aria-label="Opening balance"
              @click="amountOpen = true"
            >
              {{ previewBalance }}
            </button>
            <button
              class="opening-date-button"
              type="button"
              aria-label="Opening balance date"
              @click="dateOpen = true"
            >
              {{
                openingDate === todayInTimeZone(new Date(), timeZone)
                  ? 'Today'
                  : openingDate
              }}
              ▾
            </button>
          </div>
          <span class="new-account-hint"
            >Optional. Becomes the first balance in its history.</span
          >
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </template>
    </div>
    <footer class="new-account-footer">
      <BbButton :disabled="!canSave" @click="saveAccount">{{
        saving ? 'Saving…' : name.trim() ? 'Save' : 'Name the account'
      }}</BbButton>
    </footer>
    <BbSheet
      v-if="currenciesOpen"
      title="Currency or coin"
      @close="currenciesOpen = false"
    >
      <div class="new-account-picker scroll">
        <label class="sr" for="currency-search"
          >Search currencies and coins</label
        >
        <input
          id="currency-search"
          v-model="currencySearch"
          class="text"
          placeholder="Search currencies and coins"
        />
        <button
          v-for="option in visibleCurrencies"
          :key="option.code"
          class="new-account-currency-row"
          type="button"
          :aria-pressed="currencyCode === option.code"
          @click="selectCurrency(option.code)"
        >
          <span>{{ option.code }} · {{ option.name }}</span
          ><span v-if="currencyCode === option.code">Selected</span>
        </button>
      </div>
    </BbSheet>
    <BbSheet
      v-if="amountOpen && currency"
      title="Opening balance"
      @close="amountOpen = false"
    >
      <BbAmountInput
        :currency="currency"
        :allow-negative="true"
        label="Opening balance"
        @save="
          (amount) => {
            openingAmount = amount;
            amountOpen = false;
          }
        "
      />
    </BbSheet>
    <BbSheet
      v-if="dateOpen"
      title="Opening balance date"
      @close="dateOpen = false"
    >
      <div class="new-account-date-sheet">
        <label class="lbl" for="opening-date">Date</label>
        <input
          id="opening-date"
          v-model="openingDate"
          class="text"
          type="date"
          :max="todayInTimeZone(new Date(), timeZone)"
        />
        <BbButton @click="dateOpen = false">Done</BbButton>
      </div>
    </BbSheet>
  </main>
</template>

<style scoped>
.new-account-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 8px;
  min-height: 0;
}
.new-account-screen {
  height: 100dvh;
}
.new-account-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.account-type-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.account-type-option {
  min-height: 52px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  background: var(--surface);
  color: var(--ink);
  text-align: left;
  font: inherit;
}
.account-type-option[aria-checked='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--on-ink);
}
.new-account-currencies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.opening-balance-control {
  display: flex;
  min-height: 64px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  background: var(--surface);
}
.opening-balance-button {
  display: flex;
  align-items: center;
  flex: 1;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: var(--muted);
  text-align: left;
  font: inherit;
  font-size: 26px;
  font-weight: 600;
}
.opening-date-button {
  min-width: 90px;
  padding: 0 12px;
  background: transparent;
  color: var(--muted);
  font: inherit;
}
.new-account-hint {
  margin: 0;
  color: var(--muted);
}
.new-account-footer {
  padding: 10px 16px max(24px, env(safe-area-inset-bottom));
}
.new-account-footer :deep(button) {
  width: 100%;
  min-height: 56px;
}
.new-account-picker {
  max-height: 65vh;
  overflow-y: auto;
  padding: 0 16px 24px;
}
.new-account-date-sheet {
  display: grid;
  gap: 12px;
  padding: 0 16px 24px;
}
.new-account-currency-row {
  display: flex;
  justify-content: space-between;
  width: 100%;
  min-height: 48px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  text-align: left;
  font: inherit;
}
</style>
