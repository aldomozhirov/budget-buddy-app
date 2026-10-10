<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  accountsResponseSchema,
  currenciesResponseSchema,
  formatDate,
  formatMoney,
  getCurrency,
  membersResponseSchema,
  settingsResponseSchema,
  type Account,
  type CoinSetting,
  type ManagedMember,
} from '@budget-buddy/shared';
import BbAmount from '../../components/BbAmount.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import BbTag from '../../components/BbTag.vue';
import { useBack } from '../../composables/useBack.js';
import { authState, setAuthState } from '../../stores/auth.js';

/** Lists family accounts with owner, type, currency and active-state filters. */
defineOptions({ name: 'AccountsScreen' });

type OwnerSelection = 'everyone' | 'you' | `member:${number}`;
type FilterSheet = 'type' | 'currency' | null;

const ACCOUNT_TYPES = [
  { label: 'Bank', value: 'bank' },
  { label: 'Cash', value: 'cash' },
  { label: 'Investment', value: 'investment' },
  { label: 'Crypto', value: 'crypto' },
  { label: 'Money we owe', value: 'we_owe' },
  { label: 'Money owed to us', value: 'owed_to_us' },
] as const;

const router = useRouter();
const { label: backLabel, goBack } = useBack();
const currentMemberId = computed(() => authState.value?.member?.id ?? null);
const members = ref<ManagedMember[]>([]);
const coins = ref<CoinSetting[]>([]);
const timeZone = ref('Europe/Berlin');
const accounts = ref<Account[]>([]);
const ownerSelection = ref<OwnerSelection>('everyone');
const selectedType = ref<string | null>(null);
const selectedCurrency = ref<string | null>(null);
const showInactive = ref(false);
const balancesVisible = ref(true);
const loading = ref(true);
const error = ref('');
const filterSheet = ref<FilterSheet>(null);
let loadVersion = 0;

const ownerOptions = computed(() => [
  { label: 'Everyone', value: 'everyone' as const },
  { label: 'You', value: 'you' as const },
  ...members.value
    .filter((member) => member.id !== currentMemberId.value)
    .map((member) => ({
      label: member.name,
      value: `member:${member.id}` as const,
    })),
]);

const filteredAccounts = computed(() =>
  accounts.value.filter(
    (account) =>
      (selectedType.value === null || account.type === selectedType.value) &&
      (selectedCurrency.value === null ||
        account.currency === selectedCurrency.value),
  ),
);

const currencyOptions = computed(() =>
  [...new Set(accounts.value.map((account) => account.currency))].sort(),
);

const groups = computed(() => {
  const grouped = new Map<
    string,
    { key: string; title: string; accounts: Account[] }
  >();
  for (const account of filteredAccounts.value) {
    const key =
      account.ownerMemberId === null ? 'shared' : String(account.ownerMemberId);
    let group = grouped.get(key);
    if (!group) {
      const title =
        account.ownerMemberId === null
          ? 'Shared'
          : account.ownerMemberId === currentMemberId.value
            ? 'Yours'
            : `${account.ownerName ?? 'Unknown profile'}’s`;
      group = { key, title, accounts: [] };
      grouped.set(key, group);
    }
    group.accounts.push(account);
  }
  return [...grouped.values()].sort((left, right) => {
    const rank = (group: { key: string }) =>
      group.key === String(currentMemberId.value)
        ? 0
        : group.key === 'shared'
          ? 2
          : 1;
    return rank(left) - rank(right) || left.title.localeCompare(right.title);
  });
});

function matchingAccountCount(type: string | null, currency: string | null) {
  return accounts.value.filter(
    (account) =>
      (type === null || account.type === type) &&
      (currency === null || account.currency === currency),
  ).length;
}

const typeLabel = (value: string | null) =>
  ACCOUNT_TYPES.find((option) => option.value === value)?.label ?? 'Type';

async function loadAccounts(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  const params = new URLSearchParams();
  if (ownerSelection.value === 'you' && currentMemberId.value !== null) {
    params.set('owner', String(currentMemberId.value));
  } else if (ownerSelection.value.startsWith('member:')) {
    params.set('owner', ownerSelection.value.slice('member:'.length));
  }
  if (showInactive.value) params.set('inactive', 'true');
  const query = params.size > 0 ? `?${params.toString()}` : '';

  try {
    const response = await fetch(`/api/accounts${query}`);
    if (response.status === 401) {
      setAuthState(null);
      await router.replace('/sign-in');
      return;
    }
    if (!response.ok) throw new Error('Could not load accounts. Try again.');
    const result = accountsResponseSchema.parse(await response.json());
    if (version === loadVersion) accounts.value = result.accounts;
  } catch {
    if (version === loadVersion) {
      accounts.value = [];
      error.value =
        'Could not load accounts. Check your connection and try again.';
    }
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function loadOptions(): Promise<void> {
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
      throw new Error('Could not load account options.');
    }
    const [memberData, currencyData, settingsData] = await Promise.all([
      memberResponse.json(),
      currencyResponse.json(),
      settingsResponse.json(),
    ]);
    members.value = membersResponseSchema
      .parse(memberData)
      .members.filter((member) => member.active);
    coins.value = currenciesResponseSchema.parse(currencyData).coins;
    timeZone.value = settingsResponseSchema.parse(settingsData).timeZone;
    await loadAccounts();
  } catch {
    error.value =
      'Could not load accounts. Check your connection and try again.';
    loading.value = false;
  }
}

function amountFor(account: Account): string {
  const currency = getCurrency(account.currency, coins.value);
  return currency
    ? formatMoney(BigInt(account.balance), currency)
    : `${account.balance} ${account.currency}`;
}

function maskFor(account: Account): string {
  const currency = getCurrency(account.currency, coins.value);
  return `${currency?.symbol ?? account.currency} • • • • •`;
}

function balanceMeta(account: Account): string {
  const type =
    account.type === 'bank'
      ? ''
      : account.type === 'we_owe'
        ? 'We owe'
        : account.type === 'owed_to_us'
          ? 'Owed to us'
          : (ACCOUNT_TYPES.find((option) => option.value === account.type)
              ?.label ?? '');
  if (account.balanceTakenAt === null || account.balanceSource === null) {
    return type ? `${type} · No balance yet` : 'No balance yet';
  }
  const source = {
    opening: 'Opening',
    manual: 'By hand',
    checkin: 'Check-in',
    carried_forward: 'Wasn’t changed',
    photo: 'Photo',
    statement: 'Statement',
    connector: 'Connector',
  }[account.balanceSource];
  const date = formatDate(new Date(account.balanceTakenAt), timeZone.value);
  const detail = `${source} ${date}`;
  return type ? `${type} · ${detail}` : detail;
}

function openAccountFilter(sheet: Exclude<FilterSheet, null>): void {
  filterSheet.value = sheet;
}

watch([ownerSelection, showInactive], () => void loadAccounts());
onMounted(() => void loadOptions());
</script>

<template>
  <main class="screen app-screen accounts-screen">
    <header class="topbar accounts-topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <h1 class="t-title">Accounts</h1>
      <button
        class="icon-btn accounts-eye"
        type="button"
        :aria-label="balancesVisible ? 'Hide balances' : 'Show balances'"
        :aria-pressed="balancesVisible"
        @click="balancesVisible = !balancesVisible"
      >
        <BbIcon :name="balancesVisible ? 'eye' : 'eye-off'" />
      </button>
      <RouterLink
        class="icon-btn icon-btn-ink"
        to="/accounts/new"
        aria-label="New account"
      >
        <BbIcon name="plus" />
      </RouterLink>
    </header>

    <div class="accounts-controls">
      <div class="segmented accounts-owners" role="tablist" aria-label="Owner">
        <button
          v-for="option in ownerOptions"
          :key="option.value"
          class="seg"
          type="button"
          role="tab"
          :aria-selected="ownerSelection === option.value"
          @click="ownerSelection = option.value"
        >
          <span class="accounts-owner-label">{{ option.label }}</span>
        </button>
      </div>
      <div class="hrow accounts-filters" role="group" aria-label="Filters">
        <button
          class="fchip"
          type="button"
          :aria-pressed="selectedType !== null"
          @click="openAccountFilter('type')"
        >
          {{ selectedType ? typeLabel(selectedType) : 'Type' }}
          <BbIcon name="down" :size="16" />
        </button>
        <button
          class="fchip"
          type="button"
          :aria-pressed="selectedCurrency !== null"
          @click="openAccountFilter('currency')"
        >
          {{ selectedCurrency ?? 'Currency' }}
          <BbIcon name="down" :size="16" />
        </button>
        <button
          class="fchip"
          :class="{ 'fchip-on': showInactive }"
          type="button"
          :aria-pressed="showInactive"
          @click="showInactive = !showInactive"
        >
          Show inactive
        </button>
      </div>
    </div>

    <div class="accounts-content scroll" aria-live="polite">
      <p v-if="loading" class="accounts-message" role="status">
        Loading accounts…
      </p>
      <div v-else-if="error" class="accounts-message accounts-error">
        <p role="alert">{{ error }}</p>
        <button
          class="secondary secondary-sm"
          type="button"
          @click="loadOptions"
        >
          Try again
        </button>
      </div>
      <template v-else-if="filteredAccounts.length">
        <section
          v-for="group in groups"
          :key="group.key"
          class="accounts-group"
        >
          <div class="accounts-group-heading">
            <h2 class="h">{{ group.title }}</h2>
            <span class="accounts-count"
              >{{ group.accounts.length }}
              {{ group.accounts.length === 1 ? 'account' : 'accounts' }}</span
            >
          </div>
          <div class="card accounts-list">
            <RouterLink
              v-for="account in group.accounts"
              :key="account.id"
              class="row accounts-row"
              :class="{ 'accounts-row-inactive': !account.active }"
              :to="`/accounts/${account.id}`"
            >
              <span class="row-l accounts-row-label">
                <span class="accounts-name"
                  >{{ account.name }} · {{ account.currency }}</span
                >
                <span class="t-sub accounts-meta">{{
                  balanceMeta(account)
                }}</span>
              </span>
              <span class="accounts-row-value">
                <BbAmount
                  :value="amountFor(account)"
                  :visible="balancesVisible"
                  :masked-value="maskFor(account)"
                  :class="{
                    'accounts-negative':
                      balancesVisible && BigInt(account.balance) < 0n,
                  }"
                />
                <span class="accounts-tags">
                  <BbTag v-if="account.stale" tone="warn">Stale</BbTag>
                  <BbTag v-if="!account.active">Inactive</BbTag>
                </span>
              </span>
            </RouterLink>
          </div>
        </section>
        <p class="accounts-footnote">
          Stale means the balance is older than the monthly check-in.
        </p>
      </template>
      <p v-else class="accounts-message">No accounts match these filters.</p>
    </div>

    <BbSheet
      v-if="filterSheet === 'type'"
      title="Type"
      @close="filterSheet = null"
    >
      <div class="accounts-filter-options" role="radiogroup" aria-label="Type">
        <button
          class="accounts-filter-option"
          type="button"
          role="radio"
          :aria-checked="selectedType === null"
          @click="
            selectedType = null;
            filterSheet = null;
          "
        >
          <span>All types</span>
          <span
            >{{ matchingAccountCount(null, selectedCurrency) }} accounts</span
          >
        </button>
        <button
          v-for="option in ACCOUNT_TYPES"
          :key="option.value"
          class="accounts-filter-option"
          type="button"
          role="radio"
          :aria-checked="selectedType === option.value"
          @click="
            selectedType = option.value;
            filterSheet = null;
          "
        >
          <span>{{ option.label }}</span>
          <span>
            {{ matchingAccountCount(option.value, selectedCurrency) }} accounts
          </span>
        </button>
      </div>
    </BbSheet>

    <BbSheet
      v-if="filterSheet === 'currency'"
      title="Currency"
      @close="filterSheet = null"
    >
      <div
        class="accounts-filter-options"
        role="radiogroup"
        aria-label="Currency"
      >
        <button
          class="accounts-filter-option"
          type="button"
          role="radio"
          :aria-checked="selectedCurrency === null"
          @click="
            selectedCurrency = null;
            filterSheet = null;
          "
        >
          <span>All currencies</span>
          <span>{{ matchingAccountCount(selectedType, null) }} accounts</span>
        </button>
        <button
          v-for="currency in currencyOptions"
          :key="currency"
          class="accounts-filter-option"
          type="button"
          role="radio"
          :aria-checked="selectedCurrency === currency"
          @click="
            selectedCurrency = currency;
            filterSheet = null;
          "
        >
          <span>{{ currency }}</span>
          <span>
            {{ matchingAccountCount(selectedType, currency) }} accounts
          </span>
        </button>
      </div>
    </BbSheet>
  </main>
</template>

<style scoped>
.accounts-screen {
  height: 100dvh;
}
.accounts-topbar {
  padding-bottom: 12px;
}
.accounts-topbar h1 {
  flex: 1;
}
.accounts-eye[aria-pressed='true'] {
  background: var(--surface);
}
.accounts-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px 10px;
}
.accounts-owners {
  flex: none;
  height: 42px;
  box-sizing: border-box;
}
.accounts-owners .seg {
  position: relative;
  height: 44px;
  margin-block: -4px;
}
.accounts-owner-label {
  position: relative;
  z-index: 1;
}
.accounts-owners .seg[aria-selected='true'] {
  background: transparent;
  box-shadow: none;
}
.accounts-owners .seg::before {
  position: absolute;
  inset: 4px 0;
  z-index: 0;
  content: '';
  pointer-events: none;
}
.accounts-owners .seg[aria-selected='true']::before {
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.accounts-filters {
  margin-right: -16px;
}
.fchip-on {
  background: var(--ink);
  color: var(--on-ink);
  border-color: var(--ink);
}
.accounts-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
  padding: 4px 16px max(28px, var(--safe-area-bottom));
}
.accounts-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.accounts-group-heading {
  display: flex;
  justify-content: space-between;
  padding: 0 4px;
}
.accounts-group-heading .h {
  margin: 0;
}
.accounts-count {
  color: var(--muted);
  font-size: 13px;
}
.accounts-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 14px;
}
.accounts-row {
  position: relative;
  min-height: 64px;
  gap: 12px;
}
.accounts-row-inactive {
  opacity: 0.68;
}
.accounts-row-label {
  gap: 1px;
}
.accounts-name,
.accounts-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.accounts-name {
  font-weight: 500;
}
.accounts-negative {
  color: var(--warn);
}
.accounts-row-value {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-weight: 500;
}
.accounts-tags {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
.accounts-footnote,
.accounts-message {
  margin: 0 4px;
  color: var(--muted);
  font-size: 13px;
}
.accounts-error {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.accounts-error .secondary {
  padding: 0 16px;
}
.accounts-filter-options {
  max-height: 60vh;
  overflow-y: auto;
  padding: 0 16px max(24px, env(safe-area-inset-bottom));
}
.accounts-filter-option {
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line) !important;
  text-align: left;
}
.accounts-filter-option span:last-child {
  color: var(--muted);
  font-size: 13px;
}
.accounts-filter-option[aria-checked='true'] span:first-child {
  font-weight: 600;
}
</style>
