<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  checkinsResponseSchema,
  formatDate,
  formatRecentDate,
  settingsResponseSchema,
  startCheckinResponseSchema,
  type Checkin,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbProgress from '../../components/BbProgress.vue';
import { useBack } from '../../composables/useBack.js';
import { authState, setAuthState } from '../../stores/auth.js';

/** Lists the family's open and closed check-ins. */
defineOptions({ name: 'CheckInsScreen' });

const router = useRouter();
const { label: backLabel, goBack } = useBack();
const checkins = ref<Checkin[]>([]);
const timeZone = ref('Europe/Berlin');
const loading = ref(true);
const loadError = ref('');
const startError = ref('');
const starting = ref(false);

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
  await router.replace('/sign-in');
  return true;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [checkinsResponse, settingsResponse] = await Promise.all([
      fetch('/api/checkins'),
      fetch('/api/settings'),
    ]);
    if (await handleUnauthorized([checkinsResponse, settingsResponse])) return;
    if (!checkinsResponse.ok || !settingsResponse.ok) {
      throw new Error('Could not load check-ins.');
    }
    const [checkinsData, settingsData] = await Promise.all([
      checkinsResponse.json(),
      settingsResponse.json(),
    ]);
    checkins.value = checkinsResponseSchema.parse(checkinsData).checkins;
    timeZone.value = settingsResponseSchema.parse(settingsData).timeZone;
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
    <header class="topbar">
      <BbBackButton
        :label="backLabel"
        @click="goBack"
      />
      <h1 class="t-title">Check-ins</h1>
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
            :disabled="starting"
            :aria-busy="starting"
            @click="startCheckin"
          >
            {{ starting ? 'Starting…' : 'Start a check-in now' }}
          </BbButton>
          <p>Everyone gets a notification.</p>
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
            Closed check-ins
          </h2>
          <BbListCard v-if="closedCheckins.length">
            <RouterLink
              v-for="checkin in closedCheckins"
              :key="checkin.id"
              class="row closed-checkin-row"
              :to="`/check-ins/${checkin.id}`"
              :aria-label="`${closedDate(checkin)} · ${closedSummary(checkin)}`"
            >
              <span class="row-l">
                <span class="closed-checkin-date">{{ closedDate(checkin) }}</span>
                <span class="t-sub">{{ closedSummary(checkin) }}</span>
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
  min-height: 64px;
  text-decoration: none;
}

.closed-checkin-date {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.empty-checkins {
  margin: 0;
  padding: 16px;
  color: var(--muted);
}
</style>
