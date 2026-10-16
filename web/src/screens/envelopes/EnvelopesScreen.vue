<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  currenciesResponseSchema,
  envelopesResponseSchema,
  formatMoney,
  settingsResponseSchema,
  todayInTimeZone,
  monthOfDate,
  type CoinSetting,
  type Envelope,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbProgress from '../../components/BbProgress.vue';
import BbTag from '../../components/BbTag.vue';
import { useBack } from '../../composables/useBack.js';
import { callApi, ApiError } from '../../api/callApi.js';
import {
  cardFigures,
  envelopeCurrency,
  modeLabel,
  topUpLine,
} from './envelopeFormat.js';
import EnvelopesHistorySheet from './EnvelopesHistorySheet.vue';
import MoveMoneySheet from './MoveMoneySheet.vue';

/** Envelopes: this month's balance of each, with the sheets for the family. */
defineOptions({ name: 'EnvelopesScreen' });

type OpenSheet = 'move' | 'history' | null;

const { label: backLabel, goBack } = useBack();
const envelopes = ref<Envelope[]>([]);
const archivedCount = ref(0);
const coins = ref<CoinSetting[]>([]);
const month = ref('');
const loading = ref(true);
const error = ref('');
const sheet = ref<OpenSheet>(null);

const totals = computed(() => {
  const sums = new Map<string, bigint>();
  for (const envelope of envelopes.value) {
    sums.set(
      envelope.currency,
      (sums.get(envelope.currency) ?? 0n) +
        BigInt(envelope.current?.closing ?? '0'),
    );
  }
  return [...sums.entries()]
    .map(([code, sum]) => formatMoney(sum, envelopeCurrency(code, coins.value)))
    .join(' · ');
});
const cards = computed(() =>
  envelopes.value.map((envelope) => {
    const currency = envelopeCurrency(envelope.currency, coins.value);
    const figures = cardFigures(envelope, currency, month.value);
    const over = figures.left < 0n;
    return {
      envelope,
      over,
      mode: modeLabel(envelope.plan?.mode ?? 'reset'),
      left: formatMoney(over ? -figures.left : figures.left, currency),
      detail: figures.detail,
      spent: Number(figures.spent),
      available: Number(figures.available),
    };
  }),
);

onMounted(() => void load());

async function load(): Promise<void> {
  error.value = '';
  try {
    const [active, archived, settings, currencyData] = await Promise.all([
      callApi('GET', '/api/envelopes', envelopesResponseSchema),
      callApi('GET', '/api/envelopes?archived=true', envelopesResponseSchema),
      callApi('GET', '/api/settings', settingsResponseSchema),
      callApi('GET', '/api/currencies', currenciesResponseSchema),
    ]);
    envelopes.value = active.envelopes;
    archivedCount.value = archived.envelopes.length;
    coins.value = currencyData.coins;
    month.value = monthOfDate(todayInTimeZone(new Date(), settings.timeZone));
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the envelopes. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="screen app-screen envelopes-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="envelopes-title">
        <h1 class="t-title">Envelopes</h1>
        <span v-if="month" class="t-sub">{{ topUpLine(month) }}</span>
      </div>
      <RouterLink
        class="icon-btn icon-btn-ink"
        to="/envelopes/new"
        aria-label="New envelope"
      >
        <BbIcon name="plus" />
      </RouterLink>
    </header>

    <div class="content app-content">
      <p v-if="loading" role="status">Loading envelopes…</p>
      <div v-else-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <button class="text-btn" type="button" @click="load">Try again</button>
      </div>
      <template v-else>
        <div v-if="envelopes.length" class="envelopes-total">
          <span class="t-sub">Left in all envelopes</span>
          <span class="num envelopes-total-v">{{ totals }}</span>
        </div>
        <p v-else class="t-sub">No envelopes yet.</p>

        <RouterLink
          v-for="card in cards"
          :key="card.envelope.id"
          class="card-hero envelope-card"
          :class="{ 'card-warn': card.over }"
          :to="`/envelopes/${card.envelope.id}`"
        >
          <span class="envelope-card-head">
            <span class="envelope-card-name">{{ card.envelope.name }}</span>
            <BbTag mode>{{ card.mode }}</BbTag>
          </span>
          <span class="num envelope-card-left" :class="{ warn: card.over }">
            {{ card.over ? '−' : '' }}{{ card.left }}
            <span class="envelope-card-unit">{{
              card.over ? 'overspent' : 'left'
            }}</span>
          </span>
          <BbProgress
            :value="card.over ? card.available || 1 : card.spent"
            :max="card.available || 1"
            :over="card.over"
            :label="`${card.envelope.name} spent`"
          />
          <span class="num t-sub">{{ card.detail }}</span>
        </RouterLink>

        <div class="envelopes-actions">
          <button
            class="secondary secondary-sm"
            type="button"
            aria-haspopup="dialog"
            :disabled="envelopes.length < 2"
            @click="sheet = 'move'"
          >
            <BbIcon name="transfer" :size="18" />Move money
          </button>
          <button
            class="secondary secondary-sm"
            type="button"
            aria-haspopup="dialog"
            :disabled="envelopes.length === 0"
            @click="sheet = 'history'"
          >
            <BbIcon name="chart" :size="18" />History
          </button>
        </div>
        <RouterLink class="envelopes-archived" to="/envelopes/archived">
          <span>Archived envelopes · {{ archivedCount }}</span>
          <BbIcon name="forward" :size="18" />
        </RouterLink>
      </template>
    </div>

    <MoveMoneySheet
      v-if="sheet === 'move'"
      :envelopes="envelopes"
      :coins="coins"
      @moved="load"
      @close="sheet = null"
    />
    <EnvelopesHistorySheet
      v-if="sheet === 'history'"
      :envelopes="envelopes"
      @close="sheet = null"
    />
  </main>
</template>

<style scoped>
.envelopes-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.envelopes-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
}
.envelopes-total .t-sub {
  font-size: 14px;
}
.envelopes-total-v {
  font-size: 17px;
  font-weight: 600;
}
.envelope-card {
  text-decoration: none;
  color: inherit;
}
.envelope-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.envelope-card-name {
  font-weight: 600;
  font-size: 17px;
}
.envelope-card-left {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.envelope-card-left.warn {
  color: var(--warn);
}
.envelope-card-unit {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--muted);
}
.envelope-card-left.warn .envelope-card-unit {
  color: var(--warn);
}
.envelopes-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 4px;
}
.envelopes-actions .secondary {
  gap: 8px;
}
.envelopes-archived {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 4px;
  font-size: 14px;
  color: var(--muted);
  text-decoration: none;
}
</style>
