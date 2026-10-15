<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  envelopeHistoryResponseSchema,
  formatMoney,
  type CoinSetting,
  type Envelope,
  type EnvelopeHistoryResponse,
} from '@budget-buddy/shared';
import BarChart, {
  type BarChartBar,
} from '../../components/charts/BarChart.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import {
  envelopeCurrency,
  historySummary,
  monthName,
  monthWithYear,
} from './envelopeFormat.js';

/**
 * The History tab of an envelope (UI-ENV-4): spent per month against the
 * monthly amount, the statistics of a period (ENV-9) and the monthly records
 * (ENV-6), newest first.
 */
const props = defineProps<{
  envelope: Envelope;
  coins: CoinSetting[];
}>();

type Period = EnvelopeHistoryResponse['period'];

const PERIODS: { value: Period; label: string }[] = [
  { value: 'last6', label: 'Last 6 months' },
  { value: 'last12', label: 'Last 12 months' },
  { value: 'thisYear', label: 'This year' },
  { value: 'all', label: 'All' },
];

const period = ref<Period>('last6');
const history = ref<EnvelopeHistoryResponse | null>(null);
const loading = ref(true);
const error = ref('');
const periodSheet = ref(false);

const currency = computed(() =>
  envelopeCurrency(props.envelope.currency, props.coins),
);
const money = (value: string | bigint): string =>
  formatMoney(BigInt(value), currency.value);
const periodLabel = computed(
  () => PERIODS.find((item) => item.value === period.value)?.label ?? '',
);
const limit = computed(() => BigInt(props.envelope.plan?.monthlyAmount ?? '0'));

const bars = computed<BarChartBar[]>(() =>
  (history.value?.months ?? []).map((month) => ({
    label: monthName(month.month).slice(0, 3),
    value: BigInt(month.spent),
    current: !month.closed,
    title: `${monthName(month.month)}: ${money(month.spent)}`,
  })),
);
const summary = computed(() =>
  historySummary(history.value?.months ?? [], limit.value, money),
);

const tiles = computed(() => {
  const stats = history.value?.statistics;
  if (!stats || stats.months === 0) return [];
  const net = BigInt(stats.leftOverNet);
  return [
    {
      label: 'Within budget',
      value: `${stats.withinBudget} of ${stats.months} months`,
      warn: false,
    },
    {
      label: 'Average spent',
      value: stats.averageSpent === null ? '—' : money(stats.averageSpent),
      warn: false,
    },
    {
      label: 'Largest overspend',
      value: stats.largestOverspend
        ? `${money(stats.largestOverspend.amount)} · ${monthName(
            stats.largestOverspend.month,
          ).slice(0, 3)}`
        : 'None',
      warn: stats.largestOverspend !== null,
    },
    {
      label: 'Left over, net',
      value: `${net > 0n ? '+' : ''}${money(net)}`,
      warn: false,
    },
  ];
});

const records = computed(() =>
  (history.value?.months ?? [])
    .filter((month) => month.closed)
    .reverse()
    .map((month) => {
      const closing = BigInt(month.closing);
      return {
        month: month.month,
        title: monthWithYear(month.month),
        detail: `${money(month.spent)} spent of ${money(month.available)}${
          month.incomplete ? ' · some expenses are not counted yet' : ''
        }`,
        result:
          closing < 0n ? `${money(-closing)} over` : `${money(closing)} left`,
        over: closing < 0n,
      };
    }),
);

onMounted(() => void load());
watch(period, () => void load());

async function load(): Promise<void> {
  error.value = '';
  try {
    history.value = await callApi(
      'GET',
      `/api/envelopes/${props.envelope.id}/history?period=${period.value}`,
      envelopeHistoryResponseSchema,
    );
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the history. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

function pick(value: Period): void {
  period.value = value;
  periodSheet.value = false;
}
</script>

<template>
  <p v-if="loading" role="status">Loading history…</p>
  <div v-else-if="error" role="alert">
    <p class="error">{{ error }}</p>
    <button class="text-btn" type="button" @click="load">Try again</button>
  </div>
  <template v-else-if="history">
    <section class="card history-card" aria-label="Spent per month">
      <BarChart
        :bars="bars"
        :limit="limit"
        :limit-label="`${money(limit)} limit`"
        :summary="summary"
      />
      <div v-if="tiles.length" class="history-tiles">
        <div v-for="tile in tiles" :key="tile.label" class="history-tile">
          <span class="t-sub">{{ tile.label }}</span>
          <span class="num history-tile-v" :class="{ warn: tile.warn }">{{
            tile.value
          }}</span>
        </div>
      </div>
      <p v-else class="t-sub">No closed month yet.</p>
      <p v-if="history.statistics.incomplete" class="t-sub">
        Some expenses have no rate yet, so these figures are not exact.
      </p>
      <button
        class="history-period"
        type="button"
        aria-haspopup="dialog"
        @click="periodSheet = true"
      >
        {{ periodLabel }}<BbIcon name="down" :size="14" />
      </button>
    </section>

    <section v-if="records.length" class="card history-records">
      <div v-for="record in records" :key="record.month" class="row">
        <span class="row-l">
          <span class="history-month">{{ record.title }}</span>
          <span class="num t-sub">{{ record.detail }}</span>
        </span>
        <span class="num history-result" :class="{ warn: record.over }">{{
          record.result
        }}</span>
      </div>
    </section>

    <BbSheet v-if="periodSheet" title="Period" @close="periodSheet = false">
      <div role="radiogroup" aria-label="Period">
        <button
          v-for="item in PERIODS"
          :key="item.value"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="item.value === period"
          @click="pick(item.value)"
        >
          <span class="history-month">{{ item.label }}</span>
          <BbIcon v-if="item.value === period" name="check" :size="18" />
        </button>
      </div>
    </BbSheet>
  </template>
</template>

<style scoped>
.history-card {
  gap: 14px;
  padding: 18px 16px;
}
.history-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.history-tile {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 14px;
  background: var(--bg);
}
.history-tile .t-sub {
  font-size: 12px;
}
.history-tile-v {
  font-size: 17px;
  font-weight: 600;
}
.history-tile-v.warn,
.history-result.warn {
  color: var(--warn);
}
.history-period {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 22px;
  border: 1px solid var(--line);
  font-size: 13px;
  font-weight: 600;
}
.history-records {
  padding: 4px 16px;
}
.history-month {
  flex: 1;
  font-weight: 500;
}
.history-result {
  font-weight: 500;
}
</style>
