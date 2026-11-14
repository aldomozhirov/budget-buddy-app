<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  addMonths,
  currenciesResponseSchema,
  wishesResponseSchema,
  type CoinSetting,
  type WishesResponse,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbProgress from '../../components/BbProgress.vue';
import BbTag from '../../components/BbTag.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { useBack } from '../../composables/useBack.js';
import { monthName, monthWithYear } from '../envelopes/envelopeFormat.js';
import { createMoneyFormatter } from '../summary/summaryFormat.js';
import {
  cardDetail,
  cardFigures,
  doneDetail,
  hasNextMonth,
  hasPreviousMonth,
  monthRelation,
  summaryLine,
} from './wishesFormat.js';

/**
 * Wishes: one month's wishes, a month switcher, the summary line, an
 * envelope-style card per open wish and one card for the done and dropped
 * ones (UI-WSH-1, UI-WSH-2). It needs a connection (UI-WSH-7).
 */
defineOptions({ name: 'WishesScreen' });

const { label: backLabel, goBack } = useBack();
const data = ref<WishesResponse | null>(null);
const coins = ref<CoinSetting[]>([]);
/** The family's current month; the switcher's "This month". */
const current = ref('');
const month = ref('');
const loading = ref(true);
const error = ref('');
/** Guards against a slow answer for a month the member has left. */
let requested = 0;

const formatter = computed(() => createMoneyFormatter(coins.value));
const open = computed(
  () => data.value?.wishes.filter((wish) => wish.state === 'open') ?? [],
);
const closed = computed(
  () => data.value?.wishes.filter((wish) => wish.state !== 'open') ?? [],
);
const cards = computed(() =>
  open.value.map((wish) => {
    const figures = cardFigures(wish);
    const money = (minor: string) =>
      formatter.value.money(minor, wish.currency);
    return {
      wish,
      over: figures.unit === 'over',
      unit: figures.unit,
      headline: formatter.value.money(String(figures.headline), wish.currency),
      detail: cardDetail(wish, money),
      spent: figures.spent,
      total: figures.total,
    };
  }),
);
const rows = computed(() =>
  closed.value.map((wish) => ({
    wish,
    detail: doneDetail(wish, (minor) =>
      formatter.value.money(minor, wish.currency),
    ),
  })),
);
const total = computed(() => {
  const sum = data.value?.total;
  if (!sum) return '';
  if (sum.amount === null) return sum.incomplete ? 'Rate missing' : '';
  const amount = formatter.value.money(sum.amount, sum.currency);
  const shown = sum.estimated ? `≈ ${amount}` : amount;
  return sum.incomplete ? `${shown} · Rate missing` : shown;
});
const relation = computed(() => monthRelation(month.value, current.value));
const newWishLink = computed(() => `/wishes/new?month=${month.value}`);

onMounted(() => void load());

/** Loads `target`, or the current month when it is not given. */
async function load(target?: string): Promise<void> {
  const ticket = ++requested;
  error.value = '';
  loading.value = true;
  try {
    const query = target ? `?month=${target}` : '';
    const [wishes, currencies] = await Promise.all([
      callApi('GET', `/api/wishes${query}`, wishesResponseSchema),
      coins.value.length
        ? Promise.resolve(null)
        : callApi('GET', '/api/currencies', currenciesResponseSchema),
    ]);
    if (ticket !== requested) return;
    if (currencies) coins.value = currencies.coins;
    if (!target) current.value = wishes.month;
    data.value = wishes;
    month.value = wishes.month;
  } catch (cause) {
    if (ticket !== requested) return;
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the wishes. Check your connection and try again.';
  } finally {
    if (ticket === requested) loading.value = false;
  }
}

/** Steps the switcher by `by` months and loads that month. */
function step(by: number): void {
  const base = month.value || current.value;
  if (base) void load(addMonths(base, by));
}
</script>

<template>
  <main class="screen app-screen wishes-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="wishes-title">
        <h1 class="t-title">Wishes</h1>
        <span class="t-sub">What this month’s spare money is for</span>
      </div>
      <RouterLink
        v-if="month"
        class="icon-btn icon-btn-ink"
        :to="newWishLink"
        aria-label="New wish"
      >
        <BbIcon name="plus" />
      </RouterLink>
    </header>

    <div v-if="month" class="wishes-months">
      <button
        class="wishes-step"
        type="button"
        aria-label="Previous month"
        :disabled="!hasPreviousMonth(month)"
        @click="step(-1)"
      >
        <BbIcon name="back" />
      </button>
      <span class="wishes-month" aria-live="polite">
        <span class="wishes-month-name">{{ monthWithYear(month) }}</span>
        <span class="t-sub">{{ relation }}</span>
      </span>
      <button
        class="wishes-step"
        type="button"
        aria-label="Next month"
        :disabled="!hasNextMonth(month, current)"
        @click="step(1)"
      >
        <BbIcon name="forward" />
      </button>
    </div>

    <div class="content app-content wishes-content">
      <p v-if="loading && !data" role="status">Loading wishes…</p>
      <div v-else-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <button
          class="text-btn"
          type="button"
          @click="load(month || undefined)"
        >
          Try again
        </button>
      </div>
      <template v-else-if="data">
        <div v-if="data.counts.total > 0" class="wishes-summary">
          <span class="t-sub">{{ summaryLine(data.counts) }}</span>
          <span class="num wishes-total">{{ total }}</span>
        </div>

        <RouterLink
          v-for="card in cards"
          :key="card.wish.id"
          class="card-hero wish-card"
          :to="`/wishes/${card.wish.id}`"
        >
          <span class="wish-card-head">
            <span class="wish-card-name">{{ card.wish.name }}</span>
            <BbTag v-if="card.wish.categoryName" mode>{{
              card.wish.categoryName
            }}</BbTag>
          </span>
          <span class="num wish-card-left" :class="{ warn: card.over }">
            {{ card.headline }}
            <span class="wish-card-unit">{{ card.unit }}</span>
          </span>
          <BbProgress
            :value="card.spent"
            :max="card.total"
            :over="card.over"
            :label="`${card.wish.name} spent`"
          />
          <span class="num t-sub">{{ card.detail }}</span>
          <span v-if="card.wish.expression" class="num t-sub">{{
            card.wish.expression
          }}</span>
        </RouterLink>

        <template v-if="rows.length">
          <h2 class="wishes-heading">Done and dropped</h2>
          <div class="wishes-closed">
            <RouterLink
              v-for="row in rows"
              :key="row.wish.id"
              class="wishes-row"
              :to="`/wishes/${row.wish.id}`"
            >
              <span class="wishes-row-text">
                <span
                  class="wishes-row-name"
                  :class="{ dropped: row.wish.state === 'dropped' }"
                  >{{ row.wish.name }}</span
                >
                <span class="num t-sub">{{ row.detail }}</span>
              </span>
              <span
                class="tag tag-mode"
                :class="{ 'tag-done': row.wish.state === 'done' }"
                >{{ row.wish.state === 'done' ? 'Done' : 'Dropped' }}</span
              >
            </RouterLink>
          </div>
        </template>

        <div v-if="data.counts.total === 0" class="wishes-empty">
          <BbIcon name="star" :size="28" />
          <span
            >No wishes for {{ monthName(month) }} yet. Add one to plan
            ahead.</span
          >
          <RouterLink class="wishes-add" :to="newWishLink"
            >Add a wish</RouterLink
          >
        </div>

        <p class="t-sub wishes-note">
          Wishes don’t move to the next month by themselves. Move an open one
          from its page.
        </p>
      </template>
    </div>
  </main>
</template>

<style scoped>
.wishes-content {
  gap: 12px;
}
.wishes-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wishes-months {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
}
.wishes-step {
  flex: none;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 22px;
  color: var(--ink);
}
.wishes-step:disabled {
  opacity: 0.3;
}
.wishes-month {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.wishes-month-name {
  font-weight: 600;
}
.wishes-month .t-sub {
  font-size: 12px;
}
.wishes-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
}
.wishes-summary .t-sub {
  font-size: 14px;
}
.wishes-total {
  font-size: 17px;
  font-weight: 600;
}
.wish-card {
  text-decoration: none;
  color: inherit;
}
.wish-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wish-card-name {
  font-weight: 600;
  font-size: 17px;
}
.wish-card-left {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.wish-card-left.warn,
.wish-card-left.warn .wish-card-unit {
  color: var(--warn);
}
.wish-card-unit {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--muted);
}
.wishes-heading {
  margin: 6px 4px 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}
.wishes-closed {
  display: flex;
  flex-direction: column;
  border-radius: var(--r-hero);
  background: var(--surface);
  padding: 4px 16px;
}
.wishes-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  color: inherit;
  text-decoration: none;
}
.wishes-row + .wishes-row {
  border-top: 1px solid var(--line);
}
.wishes-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wishes-row-name {
  font-weight: 500;
}
.wishes-row-name.dropped {
  text-decoration: line-through;
  color: var(--muted);
}
.wishes-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 16px;
  border-radius: var(--r-hero);
  background: var(--surface);
  text-align: center;
  color: var(--muted);
}
.wishes-add {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 18px;
  border-radius: 22px;
  background: var(--bg);
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}
.bb .app-content > p.wishes-note {
  margin: 0 4px;
  font-size: 13px;
}
</style>
