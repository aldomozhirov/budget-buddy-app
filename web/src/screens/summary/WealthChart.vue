<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { wealthSeriesSchema, type WealthSeries } from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbSegmented from '../../components/BbSegmented.vue';
import LineChart from '../../components/charts/LineChart.vue';
import {
  chartPoints,
  wealthChartSummary,
  type MoneyFormatter,
} from './summaryFormat';

/**
 * "Over time" card of the summary (SUM-4, CUR-6, UI-SUM-3): the wealth at
 * the opening balances and at every closed check-in, in the common currency
 * or in one currency's own unit, valued at each date's rates or at today's.
 */
defineOptions({ name: 'WealthChart' });

const props = defineProps<{
  /** The common currency, named on the first pill. */
  commonCurrency: string;
  /** Formats the high and low labels. */
  formatter: MoneyFormatter;
  /** The family's time zone, for the dates on the chart. */
  timeZone: string;
}>();

const emit = defineEmits<{
  /** The session ended while the chart was loading. */
  unauthorized: [];
}>();

/** The chart's first pill: everything in the common currency. */
const ALL = '';

const series = ref<WealthSeries | null>(null);
const selection = ref<string>(ALL);
const rates = ref<'dated' | 'today'>('dated');
const loading = ref(true);
const failed = ref(false);
let latestRequest = 0;

const pillOptions = computed(() => [
  { label: `All in ${props.commonCurrency}`, value: ALL },
  // The common currency comes first, as in the design.
  ...[...(series.value?.currencies ?? [])]
    .sort(
      (left, right) =>
        Number(right === props.commonCurrency) -
          Number(left === props.commonCurrency) || left.localeCompare(right),
    )
    .map((code) => ({
      label: code,
      value: code,
    })),
]);
const points = computed(() =>
  series.value
    ? chartPoints(series.value, props.formatter, props.timeZone)
    : [],
);
const summary = computed(() => {
  const unit = series.value?.currency ?? '';
  const name = selection.value === ALL ? `All in ${unit}` : unit;
  return wealthChartSummary(
    name,
    points.value.map((point) => point.date),
    points.value[0]?.start ?? false,
  );
});
const caption = computed(() =>
  rates.value === 'today'
    ? 'All at today’s rates'
    : 'Each check-in at its own rate',
);

const rateOptions = [
  { label: 'Rate of each date', value: 'dated' },
  { label: 'Today’s rates', value: 'today' },
];

async function load(): Promise<void> {
  const request = ++latestRequest;
  loading.value = true;
  failed.value = false;
  const query = new URLSearchParams(
    selection.value === ALL
      ? { view: 'equivalent', rates: rates.value }
      : { view: 'currency', currency: selection.value, rates: rates.value },
  );
  try {
    const response = await fetch(`/api/wealth/series?${query.toString()}`);
    if (request !== latestRequest) return;
    if (response.status === 401) {
      emit('unauthorized');
      return;
    }
    if (!response.ok) throw new Error('Could not load the chart.');
    const parsed = wealthSeriesSchema.parse(await response.json());
    if (request !== latestRequest) return;
    series.value = parsed;
  } catch {
    if (request === latestRequest) failed.value = true;
  } finally {
    if (request === latestRequest) loading.value = false;
  }
}

watch([selection, rates], () => void load());
void load();

function selectSeries(value: string | number): void {
  selection.value = String(value);
}

function selectRates(value: string | number): void {
  rates.value = value === 'today' ? 'today' : 'dated';
}
</script>

<template>
  <div class="card chart-card">
    <BbChipGroup
      v-if="series"
      :model-value="selection"
      :options="pillOptions"
      label="Series"
      variant="pill"
      @update:model-value="selectSeries"
    />
    <p v-if="failed" class="chart-state" role="alert">
      Could not load the chart. Check your connection and try again.
    </p>
    <BbButton v-if="failed" variant="secondary" @click="load">
      Try again
    </BbButton>
    <p v-else-if="loading && !series" class="chart-state" role="status">
      Loading the chart…
    </p>
    <template v-else-if="series">
      <div class="chart-caption" :aria-busy="loading">
        <span v-if="selection === ALL">{{ caption }}</span>
        <span v-else>In {{ series.currency }}, no conversion</span>
      </div>
      <LineChart
        :points="points"
        :summary="summary"
        empty-text="Not enough check-ins to chart yet."
      />
      <p v-if="series.incomplete" class="chart-state">
        Check-ins that need a missing rate are left out.
      </p>
      <BbSegmented
        v-if="selection === ALL"
        :model-value="rates"
        :options="rateOptions"
        label="Rates"
        small
        @update:model-value="selectRates"
      />
    </template>
  </div>
</template>

<style scoped>
.bb .chart-card {
  gap: 10px;
  padding: 14px;
}

.chart-caption {
  display: flex;
  justify-content: flex-end;
  color: var(--muted);
  font-size: 12px;
}

.chart-state {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.chart-card :deep(.line-chart) {
  margin-top: 0;
}
</style>
