<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  checkinResponseSchema,
  currentCheckinResponseSchema,
  currenciesResponseSchema,
  formatChange,
  formatDate,
  formatMoney,
  formatRecentDate,
  getCurrency,
  settingsResponseSchema,
  type Checkin,
  type CoinSetting,
} from '@budget-buddy/shared';
import BbAmountInput from '../../components/BbAmountInput.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import { useBack } from '../../composables/useBack.js';
import { navigationStack } from '../../router/index.js';
import { authState, setAuthState } from '../../stores/auth.js';

/** Lets every profile enter, review and close the family's open check-in. */
defineOptions({ name: 'CheckinScreen' });

type CheckinAccount = Checkin['members'][number]['accountList'][number];
type SavePayload = { amount: string } | { same: true };

const router = useRouter();
const { label: backLabel, goBack } = useBack();
const checkin = ref<Checkin | null>(null);
const coins = ref<CoinSetting[]>([]);
const timeZone = ref('Europe/Berlin');
const loading = ref(true);
const loadError = ref('');
const actionError = ref('');
const selectedMemberId = ref<number | null>(null);
const selectedAccountId = ref<number | null>(null);
const editingInitialAmount = ref<bigint | null>(null);
const closeConfirmationOpen = ref(false);
const saving = ref(false);
const retryPayloads = ref<Record<number, SavePayload>>({});
let loadVersion = 0;
let selectionInitialized = false;

const currentMemberId = computed(() => authState.value?.member?.id ?? null);
const selectedMember = computed(
  () =>
    checkin.value?.members.find(
      (member) => member.memberId === selectedMemberId.value,
    ) ?? null,
);
const selectedAccount = computed(
  () =>
    selectedMember.value?.accountList.find(
      (account) => account.id === selectedAccountId.value,
    ) ?? null,
);
const pendingAccounts = computed(
  () =>
    selectedMember.value?.accountList.filter((account) => !account.value) ?? [],
);
const doneAccounts = computed(
  () =>
    selectedMember.value?.accountList.filter((account) => account.value) ?? [],
);
const missingAccountCount = computed(
  () =>
    checkin.value?.members.reduce(
      (count, member) =>
        count + member.accountList.filter((account) => !account.value).length,
      0,
    ) ?? 0,
);
const selectedIsCurrentMember = computed(
  () => selectedMemberId.value === currentMemberId.value,
);
const currentMemberProgress = computed(
  () =>
    checkin.value?.members.find(
      (member) => member.memberId === currentMemberId.value,
    ) ?? null,
);
const nextMember = computed(
  () =>
    checkin.value?.members.find(
      (member) =>
        member.memberId !== currentMemberId.value &&
        member.accountList.some((account) => !account.value),
    ) ?? null,
);
const progressPercent = computed(() => {
  const round = checkin.value;
  if (!round || round.totalAccounts === 0) return 0;
  return (round.completedAccounts / round.totalAccounts) * 100;
});
const checkinTitle = computed(() =>
  checkin.value?.scheduleSlot ? 'Monthly check-in' : 'Check-in',
);
const openingCopy = computed(() => {
  const round = checkin.value;
  if (!round) return '';
  const scheduled = round.scheduleSlot !== null;
  const date = scheduled
    ? (round.scheduleSlot?.slice(0, 10) ?? '')
    : new Date(round.openedAt);
  const time = scheduled
    ? (round.scheduleSlot?.slice(11, 16) ?? '')
    : new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: timeZone.value,
      }).format(new Date(round.openedAt));
  const when = formatRecentDate(date, new Date(), timeZone.value).toLowerCase();
  if (scheduled) return `Opened by schedule ${when}, ${time}`;
  const name = round.openedBy?.name;
  return `Started by ${name ?? 'a family member'} ${when}, ${time}`;
});

function currencyFor(account: CheckinAccount) {
  return getCurrency(account.currency, coins.value);
}

function displayAmount(account: CheckinAccount, amount: string): string {
  const currency = currencyFor(account);
  return currency
    ? formatMoney(BigInt(amount), currency)
    : 'Amount unavailable';
}

function changeDescription(account: CheckinAccount): string {
  const change = BigInt(account.value?.amount ?? '0') - BigInt(account.balance);
  const currency = currencyFor(account);
  if (currency) return formatChange(change, currency);
  return 'Change unavailable';
}

function balanceDescription(account: CheckinAccount): string {
  const amount = displayAmount(account, account.balance);
  if (account.balanceTakenAt === null) return `Last ${amount}`;
  return `Last ${amount} on ${formatDate(new Date(account.balanceTakenAt), timeZone.value)}`;
}

function memberTabName(member: Checkin['members'][number]): string {
  if (member.memberId === currentMemberId.value) return 'You';
  if (member.memberId === null) return 'Unassigned';
  return member.name ?? 'Profile';
}

function memberTabStatus(member: Checkin['members'][number]): string {
  const left = member.accounts - member.completed;
  return left === 0 ? 'Done' : `${left} left`;
}

function initializeSelection(round: Checkin): void {
  const selectedStillExists = round.members.some(
    (member) => member.memberId === selectedMemberId.value,
  );
  if (selectionInitialized && selectedStillExists) return;
  const ownMember = round.members.find(
    (member) => member.memberId === currentMemberId.value,
  );
  selectedMemberId.value =
    ownMember?.memberId ?? round.members[0]?.memberId ?? null;
  selectionInitialized = true;
}

async function handleUnauthorized(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  setAuthState(null);
  await router.replace('/sign-in');
  return true;
}

async function load(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const [checkinResponse, currenciesResponse, settingsResponse] =
      await Promise.all([
        fetch('/api/checkins/current'),
        fetch('/api/currencies'),
        fetch('/api/settings'),
      ]);
    if (await handleUnauthorized(checkinResponse)) return;
    if (!checkinResponse.ok) throw new Error('Could not load the check-in.');
    const parsed = currentCheckinResponseSchema.parse(
      await checkinResponse.json(),
    );
    if (!currenciesResponse.ok || !settingsResponse.ok)
      throw new Error('Could not load check-in options.');
    const currencyOptions = currenciesResponseSchema.parse(
      await currenciesResponse.json(),
    );
    const settings = settingsResponseSchema.parse(
      await settingsResponse.json(),
    );
    if (
      parsed.checkin?.members.some((member) =>
        member.accountList.some(
          (account) => !getCurrency(account.currency, currencyOptions.coins),
        ),
      )
    ) {
      throw new Error('Currency details are unavailable.');
    }
    if (version !== loadVersion) return;
    checkin.value = parsed.checkin;
    if (parsed.checkin) initializeSelection(parsed.checkin);
    coins.value = currencyOptions.coins;
    timeZone.value = settings.timeZone;
  } catch {
    if (version === loadVersion) {
      loadError.value =
        'Could not load the check-in. Check your connection and try again.';
    }
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function refreshCheckin(): Promise<void> {
  const round = checkin.value;
  if (!round || round.closedAt !== null || loading.value || saving.value)
    return;
  const version = ++loadVersion;
  try {
    const [response, currenciesResponse] = await Promise.all([
      fetch(`/api/checkins/${round.id}`),
      fetch('/api/currencies'),
    ]);
    if (await handleUnauthorized(response)) return;
    if (!response.ok || !currenciesResponse.ok)
      throw new Error('Could not refresh the check-in.');
    const updated = checkinResponseSchema.parse(await response.json()).checkin;
    const currencyOptions = currenciesResponseSchema.parse(
      await currenciesResponse.json(),
    );
    if (
      updated.members.some((member) =>
        member.accountList.some(
          (account) => !getCurrency(account.currency, currencyOptions.coins),
        ),
      )
    ) {
      throw new Error('Currency details are unavailable.');
    }
    if (version !== loadVersion) return;
    checkin.value = updated;
    coins.value = currencyOptions.coins;
    initializeSelection(updated);
    if (updated.closedAt !== null) {
      selectedAccountId.value = null;
      editingInitialAmount.value = null;
    }
  } catch {
    // The next focus or manual reload can recover without losing local state.
  }
}

function onWindowFocus(): void {
  void refreshCheckin();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') void refreshCheckin();
}

function openAccount(account: CheckinAccount): void {
  selectedAccountId.value = account.id;
  editingInitialAmount.value = account.value
    ? BigInt(account.value.amount)
    : null;
  actionError.value = '';
}

function closeAmountSheet(): void {
  if (saving.value) return;
  selectedAccountId.value = null;
  editingInitialAmount.value = null;
  actionError.value = '';
}

function nextPendingAccount(
  updated: Checkin,
  previousAccountId: number,
): CheckinAccount | null {
  const member = updated.members.find(
    (item) => item.memberId === selectedMemberId.value,
  );
  const accounts = member?.accountList ?? [];
  const currentIndex = accounts.findIndex(
    (account) => account.id === previousAccountId,
  );
  for (let offset = 1; offset < accounts.length; offset += 1) {
    const account = accounts[(currentIndex + offset) % accounts.length];
    if (account && account.value === null) return account;
  }
  return null;
}

async function saveValue(
  account: CheckinAccount,
  payload: SavePayload,
  advance: boolean,
): Promise<void> {
  const round = checkin.value;
  if (!round || saving.value || round.closedAt !== null) return;
  loadVersion += 1;
  saving.value = true;
  actionError.value = '';
  try {
    const response = await fetch(
      `/api/checkins/${round.id}/values/${account.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (await handleUnauthorized(response)) return;
    if (!response.ok)
      throw new Error('Could not save this balance. Try again.');
    const updated = checkinResponseSchema.parse(await response.json()).checkin;
    checkin.value = updated;
    delete retryPayloads.value[account.id];
    if (updated.closedAt !== null) {
      selectedAccountId.value = null;
      editingInitialAmount.value = null;
      closeConfirmationOpen.value = false;
      return;
    }
    if (advance) {
      const next = nextPendingAccount(updated, account.id);
      selectedAccountId.value = next?.id ?? null;
      editingInitialAmount.value = next?.value
        ? BigInt(next.value.amount)
        : null;
    } else if (selectedAccountId.value === account.id) {
      selectedAccountId.value = null;
      editingInitialAmount.value = null;
    }
  } catch {
    retryPayloads.value[account.id] = payload;
    actionError.value = 'Could not save this balance. Try again.';
    if (advance) {
      selectedAccountId.value = null;
      editingInitialAmount.value = null;
    }
  } finally {
    saving.value = false;
  }
}

function saveTypedAmount(amount: bigint): void {
  if (selectedAccount.value) {
    void saveValue(selectedAccount.value, { amount: amount.toString() }, true);
  }
}

function saveSame(account: CheckinAccount, advance = false): void {
  void saveValue(account, { same: true }, advance);
}

function retrySave(account: CheckinAccount): void {
  const payload = retryPayloads.value[account.id];
  if (payload) void saveValue(account, payload, false);
}

async function closeCheckin(): Promise<void> {
  const round = checkin.value;
  if (!round || saving.value) return;
  loadVersion += 1;
  saving.value = true;
  actionError.value = '';
  try {
    const response = await fetch(`/api/checkins/${round.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (await handleUnauthorized(response)) return;
    if (!response.ok)
      throw new Error('Could not close the check-in. Try again.');
    checkin.value = checkinResponseSchema.parse(await response.json()).checkin;
    closeConfirmationOpen.value = false;
    selectedAccountId.value = null;
    editingInitialAmount.value = null;
  } catch {
    actionError.value = 'Could not close the check-in. Try again.';
  } finally {
    saving.value = false;
  }
}

async function seeSummary(): Promise<void> {
  const round = checkin.value;
  if (!round) return;
  await router.replace('/');
  await router.push(`/check-ins/${round.id}`);
  navigationStack.value = ['/'];
}

async function backHome(): Promise<void> {
  await router.replace('/');
  navigationStack.value = [];
}

onMounted(() => {
  void load();
  window.addEventListener('focus', onWindowFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onBeforeUnmount(() => {
  loadVersion += 1;
  window.removeEventListener('focus', onWindowFocus);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <main class="screen app-screen checkin-screen">
    <template v-if="checkin && checkin.closedAt === null">
      <header class="topbar checkin-topbar">
        <BbBackButton :label="backLabel" @click="goBack" />
        <div class="checkin-heading">
          <h1 class="t-title">{{ checkinTitle }}</h1>
          <span class="t-sub">{{ openingCopy }}</span>
        </div>
        <span class="checkin-total num">
          {{ checkin.completedAccounts }} of {{ checkin.totalAccounts }}
        </span>
      </header>

      <div
        class="progress checkin-progress"
        role="progressbar"
        aria-label="Check-in progress"
        :aria-valuemin="0"
        :aria-valuemax="checkin.totalAccounts"
        :aria-valuenow="checkin.completedAccounts"
      >
        <span :style="{ width: `${progressPercent}%` }" />
      </div>

      <div class="checkin-tabs" role="tablist" aria-label="Whose accounts">
        <button
          v-for="member in checkin.members"
          :id="`checkin-tab-${member.memberId ?? 'unassigned'}`"
          :key="member.memberId ?? 'unassigned'"
          class="checkin-tab"
          type="button"
          role="tab"
          :aria-selected="selectedMemberId === member.memberId"
          :aria-controls="`checkin-panel-${member.memberId ?? 'unassigned'}`"
          @click="selectedMemberId = member.memberId"
        >
          <span class="checkin-tab-name">
            {{ memberTabName(member) }}
            <span v-if="member.active === false" class="checkin-inactive">
              (inactive)
            </span>
          </span>
          <span class="checkin-tab-progress">{{
            memberTabStatus(member)
          }}</span>
        </button>
      </div>

      <section
        v-if="selectedMember"
        :id="`checkin-panel-${selectedMember.memberId ?? 'unassigned'}`"
        class="scroll checkin-content"
        role="tabpanel"
        :aria-labelledby="`checkin-tab-${selectedMember.memberId ?? 'unassigned'}`"
        tabindex="0"
      >
        <div
          v-if="checkin.needsAccounts && selectedIsCurrentMember"
          class="checkin-empty"
        >
          <h2>No accounts yet</h2>
          <p>Add an account to take part in the check-in.</p>
          <RouterLink class="primary" to="/accounts/new">
            Create an account
          </RouterLink>
        </div>
        <template v-else>
          <h2 class="h checkin-section-title">
            {{
              selectedIsCurrentMember
                ? `Your accounts to check · ${pendingAccounts.length}`
                : `${selectedMember.name ?? 'Unassigned'}’s accounts to check · ${pendingAccounts.length}`
            }}
          </h2>

          <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
          <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
          <button
            v-if="loadError"
            class="secondary checkin-reload"
            type="button"
            @click="load"
          >
            Try again
          </button>

          <div
            v-for="account in pendingAccounts"
            :key="account.id"
            class="checkin-pending-row"
          >
            <button
              class="checkin-account-open"
              type="button"
              :aria-label="`Enter new balance for ${account.name} ${account.currency}`"
              @click="openAccount(account)"
            >
              <span class="checkin-account-name">
                {{ account.name }} · {{ account.currency }}
              </span>
              <span class="t-sub num">{{ balanceDescription(account) }}</span>
            </button>
            <button
              v-if="retryPayloads[account.id]"
              class="checkin-same"
              type="button"
              :disabled="saving"
              @click="retrySave(account)"
            >
              Try again
            </button>
            <button
              v-else
              class="checkin-same"
              type="button"
              :aria-label="`${account.name} ${account.currency} unchanged`"
              :disabled="saving"
              @click="saveSame(account)"
            >
              <BbIcon name="check" :size="18" />
              Same
            </button>
          </div>

          <div v-if="doneAccounts.length" class="checkin-done-list">
            <h2 class="h checkin-section-title">Done · tap to change</h2>
            <div
              v-for="account in doneAccounts"
              :key="account.id"
              class="checkin-done-row-wrap"
            >
              <button
                class="checkin-done-row"
                type="button"
                :aria-label="`Change balance of ${account.name} ${account.currency}`"
                :disabled="checkin.closedAt !== null"
                @click="openAccount(account)"
              >
                <span class="checkin-done-name">
                  <span class="checkin-account-name">{{ account.name }}</span>
                  <span class="t-sub">{{ account.currency }}</span>
                </span>
                <span class="checkin-done-amount">
                  <span class="num">{{
                    displayAmount(account, account.value?.amount ?? '0')
                  }}</span>
                  <span class="t-sub num">{{
                    retryPayloads[account.id]
                      ? 'Not saved'
                      : changeDescription(account)
                  }}</span>
                </span>
              </button>
              <button
                v-if="retryPayloads[account.id]"
                class="checkin-same checkin-done-retry"
                type="button"
                :disabled="saving"
                @click="retrySave(account)"
              >
                Try again
              </button>
            </div>
          </div>

          <div
            v-if="
              selectedIsCurrentMember &&
              currentMemberProgress?.done &&
              currentMemberProgress.accounts > 0 &&
              nextMember
            "
            class="checkin-member-done"
          >
            <p>Your accounts are in</p>
            <BbButton
              variant="secondary"
              @click="selectedMemberId = nextMember.memberId"
            >
              Fill in {{ nextMember.name ?? 'their' }}’s
            </BbButton>
          </div>
          <p
            v-else-if="!pendingAccounts.length && !doneAccounts.length"
            class="t-sub checkin-no-accounts"
          >
            No accounts to check.
          </p>
        </template>
      </section>

      <footer class="checkin-footer">
        <span
          >Closes by itself when everyone is in. Next reminder in 2 days.</span
        >
        <button
          class="checkin-close-button"
          type="button"
          :disabled="saving"
          @click="closeConfirmationOpen = true"
        >
          Close now
        </button>
      </footer>
    </template>

    <section
      v-else-if="checkin && checkin.closedAt !== null"
      class="checkin-closed"
    >
      <BbBackButton label="Back to home" @click="backHome" />
      <div class="checkin-closed-content">
        <span class="checkin-closed-icon"
          ><BbIcon name="check" :size="28"
        /></span>
        <h1 class="t-title">Check-in complete</h1>
        <p class="t-sub">Everyone’s balances are in.</p>
        <BbButton @click="seeSummary">See summary</BbButton>
        <BbButton variant="secondary" @click="backHome">Back home</BbButton>
      </div>
    </section>

    <section v-else class="checkin-loading" aria-live="polite">
      <p v-if="loading">Loading check-in…</p>
      <template v-else-if="loadError">
        <p class="error" role="alert">{{ loadError }}</p>
        <BbButton variant="secondary" @click="load">Try again</BbButton>
      </template>
      <template v-else>
        <h1 class="t-title">No check-in is open</h1>
        <p class="t-sub">Start or join one from Check-ins.</p>
        <RouterLink class="primary" to="/check-ins">Go to Check-ins</RouterLink>
      </template>
    </section>

    <BbSheet
      v-if="
        selectedAccount &&
        checkin?.closedAt === null &&
        currencyFor(selectedAccount)
      "
      :title="`New balance for ${selectedAccount.name}`"
      :closable="!saving"
      @close="closeAmountSheet"
    >
      <div class="checkin-amount-sheet">
        <BbAmountInput
          :key="selectedAccount.id"
          :currency="currencyFor(selectedAccount)!"
          :allow-negative="true"
          :initial-amount="editingInitialAmount"
          :last-amount="BigInt(selectedAccount.balance)"
          :saving="saving"
          :label="`New balance for ${selectedAccount.name}`"
          save-label="Save & next"
          @save="saveTypedAmount"
        />
        <BbButton
          variant="secondary"
          :disabled="saving"
          @click="saveSame(selectedAccount, true)"
        >
          Unchanged
        </BbButton>
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      </div>
    </BbSheet>

    <BbSheet
      v-if="closeConfirmationOpen && checkin?.closedAt === null"
      title="Close the check-in now?"
      :closable="!saving"
      @close="closeConfirmationOpen = false"
    >
      <p class="t-sub checkin-close-copy">
        {{ missingAccountCount }}
        {{ missingAccountCount === 1 ? 'account' : 'accounts' }} without a value
        will keep the last balance, marked as “wasn’t changed”.
      </p>
      <BbButton :disabled="saving" @click="closeCheckin">
        {{ saving ? 'Closing…' : 'Close check-in' }}
      </BbButton>
      <BbButton
        variant="text"
        :disabled="saving"
        @click="closeConfirmationOpen = false"
      >
        Keep it open
      </BbButton>
      <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
    </BbSheet>
  </main>
</template>

<style scoped>
.checkin-screen {
  height: 100dvh;
  min-height: 100dvh;
}

.checkin-topbar {
  padding-bottom: 12px;
}

.checkin-heading {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.checkin-heading .t-sub {
  white-space: nowrap;
}

.checkin-total {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}

.checkin-progress {
  margin: 0 var(--gutter) 14px;
}

.checkin-tabs {
  display: flex;
  gap: 2px;
  margin: 0 var(--gutter) 14px;
  padding: 3px;
  border-radius: 15px;
  background: var(--soft);
}

.checkin-tab {
  min-width: 0;
  min-height: 52px;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: var(--muted) !important;
}

.checkin-tab[aria-selected='true'] {
  background: var(--surface);
  color: var(--ink) !important;
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.checkin-tab-name {
  max-width: 100%;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checkin-inactive {
  font-size: 11px;
  font-weight: 400;
}

.checkin-tab-progress {
  font-size: 12px;
}

.checkin-content {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px var(--gutter) 16px;
}

.checkin-section-title {
  margin: 4px 4px 0;
}

.checkin-pending-row {
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 4px;
  border-radius: 16px;
  background: var(--surface);
}

.checkin-account-open {
  min-width: 0;
  min-height: 56px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 6px 4px 6px 12px !important;
  text-align: left;
}

.checkin-account-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checkin-account-open .t-sub {
  overflow: hidden;
  white-space: nowrap;
}

.checkin-same {
  min-height: var(--touch);
  padding: 0 14px !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line) !important;
  border-radius: 22px;
  background: var(--bg) !important;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.checkin-same:disabled,
.checkin-close-button:disabled {
  opacity: 0.55;
}

.checkin-done-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.checkin-done-row-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkin-done-list .checkin-section-title {
  margin-top: 4px;
  margin-bottom: 2px;
}

.checkin-done-row {
  min-width: 0;
  min-height: 56px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px !important;
  border: 1px solid var(--line) !important;
  border-radius: 16px;
  text-align: left;
}

.checkin-done-retry {
  flex: none;
}

.checkin-done-name,
.checkin-done-amount {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.checkin-done-name {
  flex: 1;
}

.checkin-done-name .checkin-account-name {
  font-weight: 500;
}

.checkin-done-amount {
  align-items: flex-end;
  white-space: nowrap;
}

.checkin-footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px var(--gutter) max(30px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}

.checkin-footer > span {
  flex: 1;
}

.checkin-close-button {
  min-height: 44px;
  flex: none;
  padding: 0 16px !important;
  border-radius: 22px;
  background: var(--surface) !important;
  color: var(--ink) !important;
  font-size: 14px;
  font-weight: 600;
}

.checkin-empty,
.checkin-member-done,
.checkin-loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkin-empty h2,
.checkin-empty p,
.checkin-member-done p,
.checkin-loading p {
  margin: 0;
}

.checkin-empty h2 {
  font-size: 18px;
}

.checkin-member-done {
  padding: 8px 4px;
}

.checkin-member-done p,
.checkin-no-accounts {
  color: var(--muted);
}

.checkin-reload {
  min-height: 44px;
}

.checkin-amount-sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkin-amount-sheet .error,
.checkin-close-copy {
  margin: 0;
}

.checkin-closed {
  min-height: 0;
  flex: 1;
  box-sizing: border-box;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: max(48px, var(--safe-area-top)) var(--gutter)
    max(24px, var(--safe-area-bottom));
}

.checkin-closed-content {
  width: 100%;
  max-width: 420px;
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  text-align: center;
}

.checkin-closed-content h1,
.checkin-closed-content p {
  margin: 0;
}

.checkin-closed-icon {
  width: 56px;
  height: 56px;
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 28px;
  background: var(--accent-soft);
  color: var(--accent);
}

.checkin-loading {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: max(48px, calc(var(--safe-area-top) + 24px)) var(--gutter)
    max(24px, var(--safe-area-bottom));
}

@media (prefers-reduced-motion: reduce) {
  .checkin-screen,
  .checkin-screen * {
    scroll-behavior: auto;
  }
}
</style>
