<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  checkinSummarySchema,
  currenciesResponseSchema,
  formatDate,
  type CheckinSummary,
  type CoinSetting,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSegmented from '../../components/BbSegmented.vue';
import { useBack } from '../../composables/useBack.js';
import { replaceScreen } from '../../router/index.js';
import { setAuthState } from '../../stores/auth.js';
import {
  accountLabel,
  accountTypeLabels,
  createMoneyFormatter,
  directionClass,
  directionOfMinor,
  missingRatesText,
} from './summaryFormat';
import WealthChart from './WealthChart.vue';

/**
 * The summary of one closed check-in (SUM-1 to SUM-6, UI-SUM-2 to UI-SUM-4):
 * the total and where its change came from, per-currency totals, the chart,
 * the biggest changes and what else happened. An open check-in opens the
 * check-in itself (UI-NAV-6).
 */
defineOptions({ name: 'SummaryScreen' });

const route = useRoute();
const router = useRouter();
const { label: backLabel, goBack } = useBack();

const summary = ref<CheckinSummary | null>(null);
const coins = ref<CoinSetting[]>([]);
const status = ref<'loading' | 'ready' | 'error' | 'not-found'>('loading');
const groupBy = ref<'member' | 'type'>('member');
let latestRequest = 0;

const formatter = computed(() => createMoneyFormatter(coins.value));
const timeZone = computed(() => summary.value?.timeZone ?? 'Europe/Berlin');
const common = computed(() => summary.value?.commonCurrency ?? 'EUR');
const checkinDate = computed(() =>
  summary.value ? formatDate(summary.value.checkin.date, timeZone.value) : '',
);
const subtitle = computed(() => {
  const previous = summary.value?.previous;
  return previous
    ? `Compared with ${formatDate(previous.date, timeZone.value)}`
    : 'First check-in';
});
const total = computed(() => summary.value?.total);
const totalChangeText = computed(() => {
  const data = total.value;
  if (!data || data.change === null) return '';
  const change = formatter.value.change(data.change, common.value);
  if (data.direction === 'unchanged' || data.previous === null) return change;
  return `${change} from ${formatter.value.money(data.previous, common.value)}`;
});
const missingText = computed(() =>
  summary.value && summary.value.missingRates.length > 0
    ? missingRatesText(summary.value.missingRates, timeZone.value)
    : '',
);
const groupOptions = [
  { label: 'Member', value: 'member' },
  { label: 'Account type', value: 'type' },
];
const groupRows = computed(() => {
  const data = summary.value;
  if (!data) return [];
  return groupBy.value === 'member'
    ? data.byMember.map((entry) => ({
        key: `member-${entry.memberId ?? 'shared'}`,
        name: entry.name ?? 'Shared',
        change: entry.change,
      }))
    : data.byType.map((entry) => ({
        key: `type-${entry.type}`,
        name: accountTypeLabels[entry.type],
        change: entry.change,
      }));
});
const also = computed(() => summary.value?.alsoInThisCheckin);
const nothingAdded = computed(
  () =>
    !!also.value &&
    also.value.added.length === 0 &&
    also.value.deactivated.length === 0,
);

function listText(
  accounts: { name: string; ownerName: string | null }[],
): string {
  return accounts.map(accountLabel).join(', ');
}

function changeLine(minor: string | null, code: string): string {
  return minor === null ? 'Rate missing' : formatter.value.change(minor, code);
}

async function load(): Promise<void> {
  const request = ++latestRequest;
  status.value = 'loading';
  try {
    const [summaryResponse, currenciesResponse] = await Promise.all([
      fetch(`/api/checkins/${String(route.params.id)}/summary`),
      fetch('/api/currencies'),
    ]);
    if (request !== latestRequest) return;
    if (summaryResponse.status === 401 || currenciesResponse.status === 401) {
      setAuthState(null);
      await router.replace('/sign-in');
      return;
    }
    if (summaryResponse.status === 403) {
      const body: unknown = await summaryResponse.json().catch(() => null);
      const code = (body as { error?: { code?: string } } | null)?.error?.code;
      if (code === 'forbidden_state') {
        await replaceScreen('/check-in');
        return;
      }
    }
    if (summaryResponse.status === 404 || summaryResponse.status === 400) {
      status.value = 'not-found';
      return;
    }
    if (!summaryResponse.ok || !currenciesResponse.ok) {
      throw new Error('Could not load the summary.');
    }
    const parsed = checkinSummarySchema.parse(await summaryResponse.json());
    coins.value = currenciesResponseSchema.parse(
      await currenciesResponse.json(),
    ).coins;
    if (request !== latestRequest) return;
    summary.value = parsed;
    status.value = 'ready';
  } catch {
    if (request === latestRequest) status.value = 'error';
  }
}

watch(
  () => route.params.id,
  () => void load(),
);
void load();
</script>

<template>
  <main class="screen app-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="summary-title">
        <h1 class="t-title">
          {{ summary ? `Check-in ${checkinDate}` : 'Check-in summary' }}
        </h1>
        <span v-if="summary" class="t-sub">{{ subtitle }}</span>
      </div>
    </header>

    <div class="content app-content summary-content">
      <p
        v-if="status === 'loading' && !summary"
        class="summary-state"
        role="status"
      >
        Loading the summary…
      </p>
      <div v-else-if="status === 'error'" class="summary-state summary-error">
        <p role="alert">
          Could not load the summary. Check your connection and try again.
        </p>
        <BbButton variant="secondary" @click="load"> Try again </BbButton>
      </div>
      <p v-else-if="status === 'not-found'" class="summary-state" role="alert">
        This check-in doesn’t exist.
      </p>

      <template v-else-if="summary && total && also">
        <section class="card card-hero summary-total" aria-label="Total">
          <span class="t-sub">Everything in {{ common }}</span>
          <span class="num summary-figure">
            {{
              total.current === null
                ? 'Rate missing'
                : formatter.money(total.current, common)
            }}
          </span>
          <span
            v-if="summary.previous === null"
            class="num summary-change muted"
            >First check-in</span
          >
          <span
            v-else-if="totalChangeText"
            class="num summary-change"
            :class="directionClass(total.direction)"
            >{{ totalChangeText }}</span
          >
          <p v-if="missingText" class="summary-missing" role="status">
            {{ missingText }}
          </p>
          <dl
            v-if="
              summary.fromBalances !== null ||
              summary.fromExchangeRates !== null
            "
            class="summary-split"
          >
            <div v-if="summary.fromBalances !== null">
              <dt>From balances</dt>
              <dd class="num">
                {{ formatter.signed(summary.fromBalances, common) }}
              </dd>
            </div>
            <div v-if="summary.fromExchangeRates !== null">
              <dt>From exchange rates</dt>
              <dd class="num">
                {{ formatter.signed(summary.fromExchangeRates, common) }}
              </dd>
            </div>
          </dl>
        </section>

        <h2 class="h">Per currency</h2>
        <div class="card">
          <div
            v-for="entry in summary.currencies"
            :key="entry.currency"
            class="row currency-row"
            role="group"
            :aria-label="entry.currency"
          >
            <span class="currency-code">{{ entry.currency }}</span>
            <span class="currency-amounts">
              <span class="num fw-medium">{{
                formatter.money(entry.current, entry.currency)
              }}</span>
              <span v-if="entry.previous !== null" class="num t-sub"
                >was {{ formatter.money(entry.previous, entry.currency) }}</span
              >
            </span>
            <span
              v-if="entry.difference !== null"
              class="num currency-change"
              :class="directionClass(entry.direction)"
              >{{ formatter.change(entry.difference, entry.currency) }}</span
            >
          </div>
        </div>

        <h2 class="h">Over time</h2>
        <WealthChart
          :common-currency="common"
          :formatter="formatter"
          :time-zone="timeZone"
          @unauthorized="router.replace('/sign-in')"
        />

        <template v-if="summary.previous !== null">
          <h2 class="h">Biggest changes</h2>
          <div v-if="summary.biggestChanges.length" class="card">
            <RouterLink
              v-for="entry in summary.biggestChanges"
              :key="entry.accountId"
              class="row change-row"
              :to="`/accounts/${entry.accountId}`"
            >
              <span class="row-l">
                <span class="fw-medium"
                  >{{ entry.name }} · {{ entry.currency }}</span
                >
                <span class="t-sub"
                  >{{ entry.ownerName ?? 'Shared' }} ·
                  {{ accountTypeLabels[entry.type] }}</span
                >
              </span>
              <span
                class="num fw-medium"
                :class="directionClass(directionOfMinor(entry.change))"
                >{{ formatter.change(entry.change, entry.currency) }}</span
              >
              <BbIcon name="forward" class="chev" />
            </RouterLink>
          </div>
          <p v-else class="summary-state">No account changed.</p>

          <h2 class="h">Change by</h2>
          <BbSegmented
            v-model="groupBy"
            :options="groupOptions"
            label="Group by"
          />
          <div class="card">
            <div v-for="row in groupRows" :key="row.key" class="row group-row">
              <span class="row-l">{{ row.name }}</span>
              <span
                class="num fw-medium"
                :class="
                  row.change === null
                    ? 'muted'
                    : directionClass(directionOfMinor(row.change))
                "
                >{{ changeLine(row.change, common) }}</span
              >
            </div>
            <div class="row group-row group-total">
              <span class="row-l fw-semibold">Total</span>
              <span class="num fw-semibold">{{
                changeLine(summary.fromBalances, common)
              }}</span>
            </div>
          </div>
        </template>

        <h2 class="h">Also in this check-in</h2>
        <div class="card">
          <div v-if="also.notChanged.length" class="row">
            <span class="row-l">
              <span class="fw-medium"
                >Wasn’t changed · {{ also.notChanged.length }}</span
              >
              <span class="t-sub"
                >{{ listText(also.notChanged) }}
                {{ also.notChanged.length === 1 ? 'kept its' : 'kept their' }}
                last balance</span
              >
            </span>
          </div>
          <div v-if="also.added.length" class="row">
            <span class="row-l">
              <span class="fw-medium">Added · {{ also.added.length }}</span>
              <span class="t-sub">{{ listText(also.added) }}</span>
            </span>
          </div>
          <div v-if="also.deactivated.length" class="row">
            <span class="row-l">
              <span class="fw-medium"
                >Deactivated · {{ also.deactivated.length }}</span
              >
              <span class="t-sub">{{ listText(also.deactivated) }}</span>
            </span>
          </div>
          <div v-if="nothingAdded" class="row">
            <span class="row-l muted">No accounts added or deactivated</span>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.summary-title {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.summary-content {
  gap: 10px;
}

.summary-state {
  margin: 0;
  padding: 16px;
  color: var(--muted);
}

.summary-error {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-error p {
  margin: 0;
}

.bb .summary-total {
  gap: 2px;
}

.summary-figure {
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.summary-change {
  font-size: 14px;
  font-weight: 600;
}

.summary-missing {
  margin: 6px 0 0;
  color: var(--warn);
  font-size: 13px;
}

.summary-split {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 14px;
}

.summary-split div {
  display: flex;
  justify-content: space-between;
}

.summary-split dt {
  color: var(--muted);
}

.summary-split dd {
  margin: 0;
}

.currency-row {
  min-height: 60px;
}

.currency-code {
  width: 44px;
  font-weight: 600;
}

.currency-amounts {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-end;
}

.currency-change {
  width: 104px;
  font-size: 14px;
  font-weight: 500;
  text-align: right;
}

.change-row {
  color: var(--ink);
  text-decoration: none;
}

.group-row {
  min-height: 48px;
}

.group-row:has(+ .group-total) {
  border-bottom: 0;
}

.group-total {
  border-top: 1px solid var(--ink);
}

.fw-medium {
  font-weight: 500;
}

.fw-semibold {
  font-weight: 600;
}
</style>
