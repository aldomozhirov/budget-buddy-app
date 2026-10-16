<script setup lang="ts">
import { goToSignIn } from '../../session/lock.js';
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  checkinsResponseSchema,
  currenciesResponseSchema,
  describeCadence,
  formatDate,
  formatSlotDay,
  formatRecentDate,
  settingsResponseSchema,
  startCheckinResponseSchema,
  wealthSeriesSchema,
  type Checkin,
  type CadenceSetting,
  type CoinSetting,
  type WealthSeries,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbAmount from '../../components/BbAmount.vue';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbProgress from '../../components/BbProgress.vue';
import { useBack } from '../../composables/useBack.js';
import { authState, setAuthState } from '../../stores/auth.js';
import {
  createMoneyFormatter,
  trendsFromSeries,
  trendText,
  type CheckinTrend,
} from '../summary/summaryFormat';

/** Lists the family's open and closed check-ins. */
defineOptions({ name: 'CheckInsScreen' });

const router = useRouter();
const { label: backLabel, goBack } = useBack();
const checkins = ref<Checkin[]>([]);
const timeZone = ref('Europe/Berlin');
const cadence = ref<CadenceSetting>({ kind: 'off' });
// Local date-time of the next scheduled check-in; null while the cadence is off.
const nextSlot = ref<string | null>(null);
const loading = ref(true);
const loadError = ref('');
const startError = ref('');
const starting = ref(false);
const series = ref<WealthSeries | null>(null);
const coins = ref<CoinSetting[]>([]);
// Totals are hidden on every visit and never stored (UI-SUM-1).
const totalsVisible = ref(false);

/** What sits under "Start a check-in now": no date while the schedule is off. */
const startNote = computed(() =>
  nextSlot.value
    ? `Everyone gets a notification. Next scheduled: ${formatSlotDay(nextSlot.value)}.`
    : 'Everyone gets a notification.',
);

const currentMemberId = computed(() => authState.value?.member?.id ?? null);
const openCheckin = computed(
  () => checkins.value.find((checkin) => checkin.closedAt === null) ?? null,
);
const closedCheckins = computed(() =>
  checkins.value
    .filter((checkin) => checkin.closedAt !== null)
    .sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0)),
);
const openProgressText = computed(() => {
  const checkin = openCheckin.value;
  if (!checkin) return '';
  const members = checkin.members.map((member) => {
    const name =
      member.memberId === currentMemberId.value
        ? 'you'
        : (member.name ?? 'Shared');
    const left = member.accounts - member.completed;
    const status = member.done ? 'done' : `${left} left`;
    return `${name} ${status}`;
  });
  return `${accountProgress(checkin.completedAccounts, checkin.totalAccounts)} · ${members.join(' · ')}`;
});

const trends = computed(() =>
  series.value ? trendsFromSeries(series.value) : new Map(),
);
const formatter = computed(() => createMoneyFormatter(coins.value));
const commonCurrency = computed(() => series.value?.currency ?? '');

/** The closed total, or null when a rate it needs is missing. */
function closedTotal(checkin: Checkin): string | null {
  const total = trends.value.get(checkin.id)?.total;
  return total == null
    ? null
    : formatter.value.money(total, commonCurrency.value);
}

function closedTrend(checkin: Checkin): CheckinTrend | undefined {
  return trends.value.get(checkin.id)?.trend;
}

/** The direction text; none when the row has no total to compare. */
function closedDirection(checkin: Checkin): string {
  if (closedTotal(checkin) === null) return '';
  return trendText(closedTrend(checkin) ?? null);
}

function closedLabel(checkin: Checkin): string {
  const base = `${closedDate(checkin)} · ${closedSummary(checkin)}`;
  if (!series.value || closedTrend(checkin) === undefined) return base;
  const total = closedTotal(checkin);
  const amount =
    total === null ? 'Rate missing' : totalsVisible.value ? total : 'Amount hidden';
  return [base, amount, closedDirection(checkin)].filter(Boolean).join(' · ');
}

function accountProgress(completed: number, total: number): string {
  const noun = total === 1 ? 'account' : 'accounts';
  return `${completed} of ${total} ${noun}`;
}

function openingTime(checkin: Checkin): string {
  if (checkin.scheduleSlot) return checkin.scheduleSlot.slice(11, 16);
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timeZone.value,
  }).format(new Date(checkin.openedAt));
}

function openingDate(checkin: Checkin): Date | string {
  return checkin.scheduleSlot
    ? checkin.scheduleSlot.slice(0, 10)
    : new Date(checkin.openedAt);
}

function sinceText(checkin: Checkin): string {
  const date = formatRecentDate(openingDate(checkin), new Date(), timeZone.value);
  return `Open now · since ${date.toLowerCase()}, ${openingTime(checkin)}`;
}

function closedDate(checkin: Checkin): string {
  if (checkin.closedAt === null) return '';
  return formatDate(new Date(checkin.closedAt), timeZone.value);
}

function carriedForwardCount(checkin: Checkin): number {
  return checkin.members.reduce(
    (count, member) =>
      count +
      member.accountList.filter(
        (account) => account.value?.source === 'carried_forward',
      ).length,
    0,
  );
}

function closedSummary(checkin: Checkin): string {
  const closer = checkin.closedBy
    ? `${checkin.closedBy.name} closed it`
    : 'Closed by itself';
  const carried = carriedForwardCount(checkin);
  const detail =
    carried === 0
      ? 'everyone in'
      : `${carried} ${carried === 1 ? 'wasn’t' : 'weren’t'} changed`;
  return `${closer} · ${detail}`;
}

async function handleUnauthorized(responses: Response[]): Promise<boolean> {
  if (!responses.some((response) => response.status === 401)) return false;
  setAuthState(null);
  await goToSignIn();
  return true;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [checkinsResponse, settingsResponse, seriesResponse, currenciesResponse] =
      await Promise.all([
        fetch('/api/checkins'),
        fetch('/api/settings'),
        fetch('/api/wealth/series?view=equivalent&rates=dated'),
        fetch('/api/currencies'),
      ]);
    if (
      await handleUnauthorized([
        checkinsResponse,
        settingsResponse,
        seriesResponse,
        currenciesResponse,
      ])
    )
      return;
    if (!checkinsResponse.ok || !settingsResponse.ok) {
      throw new Error('Could not load check-ins.');
    }
    // The totals are an extra: the list still works without them.
    series.value = null;
    if (seriesResponse.ok && currenciesResponse.ok) {
      try {
        series.value = wealthSeriesSchema.parse(await seriesResponse.json());
        coins.value = currenciesResponseSchema.parse(
          await currenciesResponse.json(),
        ).coins;
      } catch {
        series.value = null;
      }
    }
    const [checkinsData, settingsData] = await Promise.all([
      checkinsResponse.json(),
      settingsResponse.json(),
    ]);
    checkins.value = checkinsResponseSchema.parse(checkinsData).checkins;
    const settings = settingsResponseSchema.parse(settingsData);
    timeZone.value = settings.timeZone;
    cadence.value = settings.cadence;
    nextSlot.value = settings.nextSlot;
  } catch {
    loadError.value =
      'Could not load check-ins. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

async function startCheckin(): Promise<void> {
  if (starting.value) return;
  starting.value = true;
  startError.value = '';
  try {
    const response = await fetch('/api/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (await handleUnauthorized([response])) return;
    if (!response.ok) throw new Error('Could not start a check-in.');
    startCheckinResponseSchema.parse(await response.json());
    await router.push('/check-in');
  } catch {
    startError.value =
      'Could not start a check-in. Check your connection and try again.';
  } finally {
    starting.value = false;
  }
}

void load();
</script>

<template>
  <main class="screen app-screen">
    <header class="topbar checkins-topbar">
      <BbBackButton
        :label="backLabel"
        @click="goBack"
      />
      <div class="checkins-heading">
        <h1 class="t-title">Check-ins</h1>
        <span
          v-if="!loading && !loadError"
          class="t-sub"
        >{{ describeCadence(cadence) }}</span>
      </div>
      <button
        v-if="closedCheckins.length && series"
        class="icon-btn checkins-eye"
        type="button"
        :aria-label="totalsVisible ? 'Hide amounts' : 'Show amounts'"
        :aria-pressed="totalsVisible"
        @click="totalsVisible = !totalsVisible"
      >
        <BbIcon :name="totalsVisible ? 'eye' : 'eye-off'" />
      </button>
    </header>

    <div class="content app-content checkins-content">
      <p
        v-if="loading"
        class="checkins-state"
        role="status"
      >
        Loading check-ins…
      </p>
      <div
        v-else-if="loadError"
        class="checkins-state checkins-error-state"
      >
        <p role="alert">{{ loadError }}</p>
        <BbButton
          variant="secondary"
          @click="load"
        >
          Try again
        </BbButton>
      </div>
      <template v-else>
        <RouterLink
          v-if="openCheckin"
          class="open-checkin-card"
          to="/check-in"
        >
          <span class="open-checkin-title">
            <span>{{ sinceText(openCheckin) }}</span>
            <span class="open-checkin-continue">Continue</span>
          </span>
          <BbProgress
            :value="openCheckin.completedAccounts"
            :max="Math.max(1, openCheckin.totalAccounts)"
            label="Check-in progress"
            :value-text="accountProgress(openCheckin.completedAccounts, openCheckin.totalAccounts)"
          />
          <span class="open-checkin-meta">{{ openProgressText }}</span>
        </RouterLink>

        <section
          v-else
          class="start-checkin"
          aria-label="Start a check-in"
        >
          <BbButton
            needs-server
            :disabled="starting"
            :aria-busy="starting"
            @click="startCheckin"
          >
            {{ starting ? 'Starting…' : 'Start a check-in now' }}
          </BbButton>
          <p>{{ startNote }}</p>
          <p
            v-if="startError"
            class="checkins-error"
            role="alert"
          >
            {{ startError }}
          </p>
        </section>

        <section
          class="closed-checkins"
          aria-labelledby="closed-checkins-heading"
        >
          <h2
            id="closed-checkins-heading"
            class="section-label"
          >
            {{ commonCurrency ? `Closed · family total in ${commonCurrency}` : 'Closed check-ins' }}
          </h2>
          <BbListCard v-if="closedCheckins.length">
            <RouterLink
              v-for="checkin in closedCheckins"
              :key="checkin.id"
              class="row closed-checkin-row"
              :to="`/check-ins/${checkin.id}`"
              :aria-label="closedLabel(checkin)"
            >
              <span class="row-l">
                <span class="closed-checkin-date">{{ closedDate(checkin) }}</span>
                <span class="t-sub">{{ closedSummary(checkin) }}</span>
              </span>
              <span
                v-if="series"
                class="closed-checkin-total"
                aria-hidden="true"
              >
                <span
                  v-if="closedTotal(checkin) === null"
                  class="num closed-checkin-amount"
                >Rate missing</span>
                <BbAmount
                  v-else
                  :value="closedTotal(checkin) ?? ''"
                  :visible="totalsVisible"
                  :masked-value="formatter.masked(commonCurrency)"
                  class="closed-checkin-amount"
                />
                <span
                  v-if="closedDirection(checkin)"
                  class="num t-sub"
                >{{ closedDirection(checkin) }}</span>
              </span>
              <BbIcon
                name="forward"
                class="chev"
              />
            </RouterLink>
          </BbListCard>
          <p
            v-else
            class="empty-checkins"
          >
            No closed check-ins yet.
          </p>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.checkins-heading {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.checkins-content {
  gap: 14px;
}

.checkins-state {
  margin: 0;
  padding: 16px;
  color: var(--muted);
}

.checkins-error-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkins-error-state p,
.start-checkin p {
  margin: 0;
}

.checkins-error {
  color: var(--warn);
}

.open-checkin-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--r-card);
  background: var(--accent-soft);
  color: var(--ink);
  text-decoration: none;
}

.open-checkin-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.open-checkin-continue {
  flex: none;
  color: var(--accent);
  font-size: 14px;
}

.open-checkin-meta {
  color: var(--muted);
  font-size: 13px;
}

.start-checkin {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.start-checkin > p {
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.closed-checkins {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  margin: 0 4px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}

.closed-checkin-row {
  min-height: calc(64px - 2 * var(--row-pad));
  text-decoration: none;
}

.closed-checkin-date {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.closed-checkin-total {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.closed-checkin-amount {
  font-weight: 500;
}

.empty-checkins {
  margin: 0;
  padding: 16px;
  color: var(--muted);
}
</style>
