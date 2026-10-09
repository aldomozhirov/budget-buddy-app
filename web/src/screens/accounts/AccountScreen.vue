<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  accountResponseSchema,
  currenciesResponseSchema,
  formatDate,
  formatMoney,
  getCurrency,
  membersResponseSchema,
  settingsResponseSchema,
  snapshotRevisionsResponseSchema,
  snapshotsResponseSchema,
  todayInTimeZone,
  type Account,
  type CoinSetting,
  type ManagedMember,
  type Snapshot,
} from '@budget-buddy/shared';
import BbAmountInput from '../../components/BbAmountInput.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import LineChart from '../../components/charts/LineChart.vue';
import { useBack } from '../../composables/useBack.js';
import { setAuthState } from '../../stores/auth.js';

/** Shows an account's latest balance, history and editable settings. */
defineOptions({ name: 'AccountScreen' });

type Sheet =
  | 'balance'
  | 'balance-date'
  | 'correction'
  | 'settings'
  | 'deactivate'
  | 'relabel'
  | 'delete'
  | null;
type Range = '3 M' | '1 Y' | 'All';

const TYPES = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'we_owe', label: 'Money we owe' },
  { value: 'owed_to_us', label: 'Money owed to us' },
] as const;

const route = useRoute();
const router = useRouter();
const { label: backLabel, goBack } = useBack();
const accountId = computed(() => String(route.params.id));
const account = ref<Account | null>(null);
const snapshots = ref<Snapshot[]>([]);
const members = ref<ManagedMember[]>([]);
const coins = ref<CoinSetting[]>([]);
const currencies = ref<{ code: string; name: string }[]>([]);
const timeZone = ref('Europe/Berlin');
const loading = ref(true);
const error = ref('');
const actionError = ref('');
const sheet = ref<Sheet>(null);
const selectedSnapshot = ref<Snapshot | null>(null);
const revisionsBySnapshot = ref<Record<number, string>>({});
const selectedRange = ref<Range>('1 Y');
const balanceDate = ref('');
const correctionDate = ref('');
const name = ref('');
const ownerMemberId = ref<number | null>(null);
const type = ref<Account['type']>('bank');
const currencyCode = ref('EUR');
const relabelExample = ref<{ before: string; after: string } | null>(null);
const relabelPending = ref(false);
const saving = ref(false);

const currency = computed(() =>
  getCurrency(account.value?.currency ?? currencyCode.value, coins.value),
);
const sourceLabels: Record<Snapshot['source'], string> = {
  opening: 'Opening',
  manual: 'By hand',
  checkin: 'Check-in',
  carried_forward: 'Wasn’t changed',
  photo: 'Photo',
  statement: 'Statement',
  connector: 'Connector',
};
const chartPoints = computed(() => {
  const accountCurrency = currency.value;
  if (!accountCurrency) return [];
  const cutoff =
    selectedRange.value === '3 M'
      ? Date.now() - 92 * 24 * 60 * 60 * 1000
      : selectedRange.value === '1 Y'
        ? Date.now() - 366 * 24 * 60 * 60 * 1000
        : Number.NEGATIVE_INFINITY;
  return [...snapshots.value]
    .filter((snapshot) => snapshot.takenAt >= cutoff)
    .reverse()
    .map((snapshot) => {
      const takenAt = new Date(snapshot.takenAt);
      return {
        date: formatDate(takenAt, timeZone.value),
        tick: new Intl.DateTimeFormat('en', {
          month: 'short',
          year: '2-digit',
          timeZone: timeZone.value,
        }).format(takenAt),
        value: BigInt(snapshot.amount),
        label: formatMoney(BigInt(snapshot.amount), accountCurrency),
      };
    });
});
const chartSummary = computed(
  () =>
    `Account balance from ${chartPoints.value[0]?.date ?? 'the first date'} to ${chartPoints.value.at(-1)?.date ?? 'the latest date'}`,
);
const today = computed(() => todayInTimeZone(new Date(), timeZone.value));
const formattedBalance = computed(() => {
  if (!account.value || !currency.value) return '';
  return formatMoney(BigInt(account.value.balance), currency.value);
});
const typeLabel = computed(
  () => TYPES.find((item) => item.value === account.value?.type)?.label ?? '',
);
const latestMeta = computed(() => {
  const latest = snapshots.value[0];
  if (!latest) return 'No balance yet';
  return `${sourceLabels[latest.source]} · ${formatDate(new Date(latest.takenAt), timeZone.value)} · ${latest.updatedByName}`;
});
const deletionReason = computed(() =>
  snapshots.value.length
    ? 'This account has balance history and cannot be deleted. Deactivate it to keep its history.'
    : 'This account cannot be deleted while it has transactions. Deactivate it instead.',
);

onMounted(() => void load());

async function request(
  path: string,
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const response = await fetch(path, init);
  if (response.status === 401) {
    setAuthState(null);
    await router.replace('/sign-in');
  }
  return response;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [
      accountResponse,
      historyResponse,
      membersResponse,
      currenciesResponse,
      settingsResponse,
    ] = await Promise.all([
      request(`/api/accounts/${accountId.value}`),
      request(`/api/accounts/${accountId.value}/snapshots`),
      request('/api/members'),
      request('/api/currencies'),
      request('/api/settings'),
    ]);
    if (
      [
        accountResponse,
        historyResponse,
        membersResponse,
        currenciesResponse,
        settingsResponse,
      ].some((response) => !response.ok)
    ) {
      throw new Error('Could not load this account. Try again.');
    }
    const [accountData, historyData, membersData, currencyData, settingsData] =
      await Promise.all([
        accountResponse.json(),
        historyResponse.json(),
        membersResponse.json(),
        currenciesResponse.json(),
        settingsResponse.json(),
      ]);
    account.value = accountResponseSchema.parse(accountData).account;
    snapshots.value = snapshotsResponseSchema.parse(historyData).snapshots;
    members.value = membersResponseSchema.parse(membersData).members;
    const parsedCurrencies = currenciesResponseSchema.parse(currencyData);
    currencies.value = parsedCurrencies.currencies;
    coins.value = parsedCurrencies.coins;
    timeZone.value = settingsResponseSchema.parse(settingsData).timeZone;
    copySettings();
    await loadRevisions();
  } catch {
    error.value =
      'Could not load this account. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

function copySettings(): void {
  if (!account.value) return;
  name.value = account.value.name;
  ownerMemberId.value = account.value.ownerMemberId;
  type.value = account.value.type;
  currencyCode.value = account.value.currency;
}

async function loadRevisions(): Promise<void> {
  const entries = await Promise.all(
    snapshots.value.map(async (snapshot) => {
      try {
        const response = await request(
          `/api/snapshots/${snapshot.id}/revisions`,
        );
        if (!response.ok) return [snapshot.id, ''] as const;
        const parsed = snapshotRevisionsResponseSchema.parse(
          await response.json(),
        );
        return [snapshot.id, parsed.revisions[0]?.changedByName ?? ''] as const;
      } catch {
        return [snapshot.id, ''] as const;
      }
    }),
  );
  revisionsBySnapshot.value = Object.fromEntries(entries);
}

function openBalance(): void {
  balanceDate.value = today.value;
  actionError.value = '';
  sheet.value = 'balance';
}

async function saveBalance(amount: bigint): Promise<void> {
  saving.value = true;
  actionError.value = '';
  try {
    const response = await request(
      `/api/accounts/${accountId.value}/snapshots`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount.toString(),
          ...(balanceDate.value === today.value
            ? {}
            : { date: balanceDate.value }),
        }),
      },
    );
    if (!response.ok)
      throw new Error('Could not save this balance. Try again.');
    sheet.value = null;
    await load();
  } catch (cause) {
    actionError.value =
      cause instanceof Error
        ? cause.message
        : 'Could not save this balance. Try again.';
  } finally {
    saving.value = false;
  }
}

async function openCorrection(snapshot: Snapshot): Promise<void> {
  selectedSnapshot.value = snapshot;
  correctionDate.value = todayInTimeZone(
    new Date(snapshot.takenAt),
    timeZone.value,
  );
  actionError.value = '';
  sheet.value = 'correction';
}

async function saveCorrection(amount: bigint): Promise<void> {
  if (!selectedSnapshot.value) return;
  saving.value = true;
  actionError.value = '';
  try {
    const response = await request(
      `/api/snapshots/${selectedSnapshot.value.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount.toString(),
          date: correctionDate.value,
        }),
      },
    );
    if (!response.ok)
      throw new Error('Could not save this correction. Try again.');
    sheet.value = null;
    await load();
    selectedSnapshot.value = null;
  } catch (cause) {
    actionError.value =
      cause instanceof Error
        ? cause.message
        : 'Could not save this correction. Try again.';
  } finally {
    saving.value = false;
  }
}

async function deleteSnapshot(): Promise<void> {
  if (!selectedSnapshot.value) return;
  const response = await request(
    `/api/snapshots/${selectedSnapshot.value.id}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    actionError.value = 'Could not delete this balance. Try again.';
    return;
  }
  sheet.value = null;
  selectedSnapshot.value = null;
  await load();
}

async function saveSettings(): Promise<void> {
  if (!account.value) return;
  saving.value = true;
  actionError.value = '';
  try {
    const response = await request(`/api/accounts/${accountId.value}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value.trim(),
        ownerMemberId: ownerMemberId.value,
        type: type.value,
      }),
    });
    if (!response.ok)
      throw new Error('Could not save account settings. Try again.');
    account.value = accountResponseSchema.parse(await response.json()).account;
    sheet.value = null;
  } catch (cause) {
    actionError.value =
      cause instanceof Error
        ? cause.message
        : 'Could not save account settings. Try again.';
  } finally {
    saving.value = false;
  }
}

async function previewRelabel(): Promise<void> {
  if (!account.value || currencyCode.value === account.value.currency) return;
  actionError.value = '';
  try {
    const response = await request(
      `/api/accounts/${accountId.value}/currency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: currencyCode.value }),
      },
    );
    const payload = (await response.json()) as {
      example?: { beforeAmount: string; afterAmount: string } | null;
      requiresConfirmation?: boolean;
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(
        payload.error?.message ?? 'Could not preview this currency change.',
      );
    const target = getCurrency(currencyCode.value, coins.value);
    relabelExample.value =
      payload.example && currency.value && target
        ? {
            before: formatMoney(
              BigInt(payload.example.beforeAmount),
              currency.value,
            ),
            after: formatMoney(BigInt(payload.example.afterAmount), target),
          }
        : null;
    relabelPending.value = true;
    sheet.value = 'relabel';
  } catch (cause) {
    actionError.value =
      cause instanceof Error
        ? cause.message
        : 'Could not preview this currency change.';
  }
}

async function confirmRelabel(): Promise<void> {
  if (!account.value) return;
  saving.value = true;
  actionError.value = '';
  try {
    const response = await request(
      `/api/accounts/${accountId.value}/currency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: currencyCode.value, confirm: true }),
      },
    );
    if (!response.ok)
      throw new Error('Could not relabel this account. Try again.');
    sheet.value = null;
    relabelPending.value = false;
    await load();
  } catch (cause) {
    actionError.value =
      cause instanceof Error
        ? cause.message
        : 'Could not relabel this account. Try again.';
  } finally {
    saving.value = false;
  }
}

async function setActive(active: boolean): Promise<void> {
  const response = await request(
    `/api/accounts/${accountId.value}/${active ? 'reactivate' : 'deactivate'}`,
    { method: 'POST' },
  );
  if (!response.ok) {
    actionError.value = 'Could not update this account. Try again.';
    return;
  }
  account.value = accountResponseSchema.parse(await response.json()).account;
  sheet.value = null;
}

async function deleteAccount(): Promise<void> {
  const response = await request(`/api/accounts/${accountId.value}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    actionError.value =
      'This account cannot be deleted. Deactivate it instead.';
    return;
  }
  await router.replace('/accounts');
}
</script>

<template>
  <main class="screen app-screen account-screen">
    <header class="topbar account-topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="account-heading">
        <h1 class="t-title">{{ account?.name ?? 'Account' }}</h1>
        <p class="t-sub">
          {{ account?.ownerName ?? 'Shared' }} · {{ typeLabel }} ·
          {{ account?.currency }}
        </p>
      </div>
      <button
        class="icon-btn"
        type="button"
        aria-label="Account settings"
        @click="
          copySettings();
          sheet = 'settings';
        "
      >
        <BbIcon name="settings" />
      </button>
    </header>

    <div class="account-content scroll">
      <p v-if="loading" class="account-message" role="status">
        Loading account…
      </p>
      <div v-else-if="error" class="account-message" role="alert">
        {{ error }}
        <BbButton variant="secondary-sm" @click="load">Try again</BbButton>
      </div>
      <template v-else-if="account && currency">
        <section class="card account-hero" aria-label="Current balance">
          <BbTag v-if="!account.active">Inactive</BbTag>
          <BbTag v-if="account.stale" tone="warn">Stale</BbTag>
          <div class="account-balance num">{{ formattedBalance }}</div>
          <p class="t-sub account-latest">{{ latestMeta }}</p>
          <LineChart :points="chartPoints" :summary="chartSummary" />
          <div
            class="segmented account-ranges"
            role="tablist"
            aria-label="Chart range"
          >
            <button
              v-for="range in ['3 M', '1 Y', 'All'] as const"
              :key="range"
              class="seg"
              type="button"
              role="tab"
              :aria-selected="selectedRange === range"
              @click="selectedRange = range"
            >
              {{ range }}
            </button>
          </div>
        </section>

        <div class="account-actions">
          <BbButton @click="openBalance">Set balance</BbButton>
          <RouterLink class="secondary account-transactions" to="/transactions"
            >Transactions</RouterLink
          >
        </div>
        <section class="account-history-section">
          <h2 class="t-sub account-history-title">
            Balance history · tap to correct
          </h2>
          <div v-if="snapshots.length" class="card account-history">
            <button
              v-for="(snapshot, index) in snapshots"
              :key="snapshot.id"
              class="account-history-row"
              type="button"
              @click="openCorrection(snapshot)"
            >
              <span class="history-left">
                <span class="num">{{
                  formatDate(new Date(snapshot.takenAt), timeZone)
                }}</span>
                <span class="t-sub"
                  >{{ sourceLabels[snapshot.source] }} ·
                  {{ snapshot.updatedByName
                  }}<template v-if="revisionsBySnapshot[snapshot.id]">
                    · Changed by
                    {{ revisionsBySnapshot[snapshot.id] }}</template
                  ></span
                >
              </span>
              <span class="history-right num">{{
                formatMoney(BigInt(snapshot.amount), currency)
              }}</span>
              <span
                v-if="index < snapshots.length - 1"
                class="account-divider"
                aria-hidden="true"
              />
            </button>
          </div>
          <p v-else class="t-sub">No balance history yet.</p>
        </section>
        <p class="account-delete-note">{{ deletionReason }}</p>
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </template>
    </div>

    <BbSheet
      v-if="sheet === 'balance' && currency"
      title="Set balance"
      @close="sheet = null"
    >
      <div class="account-sheet-body">
        <button
          class="account-date-choice"
          type="button"
          @click="sheet = 'balance-date'"
        >
          {{
            balanceDate === today ? 'Today' : formatDate(balanceDate, timeZone)
          }}
          · Change date
        </button>
        <BbAmountInput
          :currency="currency"
          :allow-negative="true"
          :last-amount="account ? BigInt(account.balance) : null"
          label="Account balance"
          save-label="Save balance"
          @save="saveBalance"
        />
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </div>
    </BbSheet>

    <BbSheet
      v-if="sheet === 'balance-date'"
      title="Balance date"
      @close="sheet = 'balance'"
    >
      <div class="account-sheet-body">
        <button
          class="account-date-choice"
          type="button"
          @click="
            balanceDate = today;
            sheet = 'balance';
          "
        >
          Today
        </button>
        <label class="lbl" for="balance-date">Earlier date…</label>
        <input
          id="balance-date"
          v-model="balanceDate"
          class="text"
          type="date"
          :max="today"
        />
        <BbButton @click="sheet = 'balance'">Done</BbButton>
      </div>
    </BbSheet>

    <BbSheet
      v-if="sheet === 'correction' && selectedSnapshot && currency"
      title="Correct balance"
      @close="sheet = null"
    >
      <div class="account-sheet-body">
        <p class="t-sub">
          {{ sourceLabels[selectedSnapshot.source] }} ·
          {{ selectedSnapshot.updatedByName }}
        </p>
        <label class="lbl" for="correction-date">Date</label>
        <input
          id="correction-date"
          v-model="correctionDate"
          class="text"
          type="date"
          :max="today"
        />
        <BbAmountInput
          :key="selectedSnapshot.id"
          :currency="currency"
          :allow-negative="true"
          :initial-amount="BigInt(selectedSnapshot.amount)"
          label="Corrected balance"
          save-label="Save correction"
          @save="saveCorrection"
        />
        <p v-if="revisionsBySnapshot[selectedSnapshot.id]" class="t-sub">
          Changed by {{ revisionsBySnapshot[selectedSnapshot.id] }}
        </p>
        <BbButton variant="danger" @click="deleteSnapshot">Delete</BbButton>
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </div>
    </BbSheet>

    <BbSheet
      v-if="sheet === 'settings'"
      title="Account settings"
      @close="sheet = null"
    >
      <div class="account-sheet-body scroll">
        <label class="lbl" for="account-name">Name</label>
        <input id="account-name" v-model="name" class="text" />
        <label class="lbl" for="account-owner">Owner</label>
        <select id="account-owner" v-model="ownerMemberId" class="text">
          <option :value="null">Shared</option>
          <option v-for="member in members" :key="member.id" :value="member.id">
            {{ member.name }}
          </option>
        </select>
        <label class="lbl" for="account-type">Type</label>
        <select id="account-type" v-model="type" class="text">
          <option
            v-for="option in TYPES"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <label class="lbl" for="account-currency">Currency</label>
        <select id="account-currency" v-model="currencyCode" class="text">
          <option
            v-for="option in currencies"
            :key="option.code"
            :value="option.code"
          >
            {{ option.code }} · {{ option.name }}
          </option>
          <option v-for="coin in coins" :key="coin.code" :value="coin.code">
            {{ coin.code }} · {{ coin.name }}
          </option>
        </select>
        <BbButton @click="saveSettings">Save settings</BbButton>
        <BbButton
          v-if="currencyCode !== account?.currency"
          variant="secondary"
          @click="previewRelabel"
          >Change currency</BbButton
        >
        <p class="account-delete-note">{{ deletionReason }}</p>
        <BbButton
          v-if="snapshots.length === 0"
          variant="danger"
          @click="sheet = 'delete'"
          >Delete account</BbButton
        >
        <BbButton
          v-if="account?.active"
          variant="danger"
          @click="sheet = 'deactivate'"
          >Deactivate account</BbButton
        >
        <BbButton v-else variant="secondary" @click="setActive(true)"
          >Reactivate account</BbButton
        >
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </div>
    </BbSheet>

    <BbSheet
      v-if="sheet === 'deactivate'"
      title="Deactivate account?"
      @close="sheet = 'settings'"
    >
      <div class="account-sheet-body">
        <p class="t-sub">
          This account will become inactive. Its balance history stays, and its
          balance becomes zero from today.
        </p>
        <BbButton variant="danger" @click="setActive(false)"
          >Deactivate account</BbButton
        ><BbButton variant="text" @click="sheet = 'settings'"
          >Keep account active</BbButton
        >
      </div>
    </BbSheet>

    <BbSheet
      v-if="sheet === 'relabel' && account"
      :title="`Relabel as ${currencyCode}?`"
      @close="
        sheet = 'settings';
        relabelPending = false;
      "
    >
      <div class="account-sheet-body">
        <p class="t-sub">
          All {{ snapshots.length }} stored amounts are relabelled, not
          converted<template v-if="relabelExample"
            >: {{ relabelExample.before }} becomes
            {{ relabelExample.after }}</template
          >. Use this only to fix a wrong currency.
        </p>
        <p v-if="relabelPending" class="t-sub">
          Stored history and revisions will use the new currency label.
        </p>
        <BbButton @click="confirmRelabel"
          >Relabel as {{ currencyCode }}</BbButton
        ><BbButton variant="text" @click="sheet = 'settings'">Cancel</BbButton>
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </div>
    </BbSheet>

    <BbSheet
      v-if="sheet === 'delete'"
      title="Delete account?"
      @close="sheet = 'settings'"
    >
      <div class="account-sheet-body">
        <p class="t-sub">{{ deletionReason }}</p>
        <BbButton variant="danger" @click="deleteAccount"
          >Delete account</BbButton
        ><BbButton variant="text" @click="sheet = 'settings'"
          >Keep account</BbButton
        >
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </div>
    </BbSheet>
  </main>
</template>

<style scoped>
.account-screen {
  height: 100dvh;
}
.account-topbar {
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
}
.account-heading {
  flex: 1;
  min-width: 0;
}
.account-heading .t-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-heading .t-sub {
  margin: 2px 0 0;
}
.account-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 8px 16px max(28px, env(safe-area-inset-bottom));
}
.account-hero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 16px 14px;
}
.account-balance {
  font-size: clamp(30px, 9vw, 40px);
  font-weight: 600;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.account-latest {
  margin: 0;
}
.account-ranges {
  margin-top: 6px;
}
.account-ranges .seg {
  min-height: 40px;
}
.account-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.account-transactions {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-card);
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
}
.account-history-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.account-history-title {
  margin: 0 4px;
}
.account-history {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 14px;
}
.account-history-row {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
  font: inherit;
}
.history-left {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.history-left .t-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-right {
  flex: none;
  font-weight: 500;
}
.account-divider {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--line);
}
.account-delete-note,
.account-message {
  margin: 0 4px;
  color: var(--muted);
  font-size: 13px;
}
.account-sheet-body {
  display: flex;
  max-height: 68vh;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 0 16px max(24px, env(safe-area-inset-bottom));
}
.account-date-choice {
  min-height: 48px;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.account-sheet-body .lbl {
  margin-bottom: -8px;
}
@media (prefers-reduced-motion: reduce) {
  .account-screen,
  .account-screen * {
    scroll-behavior: auto;
    transition: none !important;
    animation: none !important;
  }
}
</style>
