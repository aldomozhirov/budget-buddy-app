<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  accountsResponseSchema,
  categoriesResponseSchema,
  currenciesResponseSchema,
  envelopesResponseSchema,
  listTransactionsResponseSchema,
  membersResponseSchema,
  monthOfDate,
  settingsResponseSchema,
  todayInTimeZone,
  transactionFacetsResponseSchema,
  type CoinSetting,
  type DayTotal,
  type ListedTransaction,
  type ListTransactionsResponse,
  type TransactionFacet,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { useBack } from '../../composables/useBack.js';
import NeedsCategoryTab from './NeedsCategoryTab.vue';
import TransactionDay from './TransactionDay.vue';
import TransactionRow from './TransactionRow.vue';
import TransactionsFilterSheet from './TransactionsFilterSheet.vue';
import {
  chipLabel,
  countText,
  dayHeading,
  emptyFilters,
  facetOptions,
  filtersFromQuery,
  filtersToParams,
  hasActiveFilters,
  isFacetActive,
  totalsText,
  type FilterLookups,
  type FilterNames,
  type IdOrNone,
  type TransactionFilters,
} from './transactionsFormat.js';

/**
 * Transactions (TXN-6, UI-TXN-1, UI-TXN-2): search, the "All" and "Needs a
 * category" tabs, filter chips with their sheets, a summary line and the rows
 * by day, fifty at a time. `?tab=needs-category` opens the second tab and
 * `?account=3&period=all` the list of one account (UI-NAV-5, O14).
 */
defineOptions({ name: 'TransactionsScreen' });

type Tab = 'all' | 'needs-category';

const FACETS: readonly { facet: TransactionFacet; title: string }[] = [
  { facet: 'period', title: 'Period' },
  { facet: 'member', title: 'Member' },
  { facet: 'account', title: 'Account' },
  { facet: 'category', title: 'Category' },
  { facet: 'envelope', title: 'Envelope' },
  { facet: 'kind', title: 'Kind' },
];

const route = useRoute();
const { label: backLabel, goBack } = useBack();

const filters = reactive<TransactionFilters>(filtersFromQuery(route.query));
const searchText = ref(filters.q);
const tab = ref<Tab>(
  route.query.tab === 'needs-category' ? 'needs-category' : 'all',
);

const lookups = ref<FilterLookups>({
  member: [],
  account: [],
  category: [],
  envelope: [],
});
const coins = ref<CoinSetting[]>([]);
const commonCurrency = ref('');
const today = ref('');
const bootstrapped = ref(false);
const bootError = ref('');

const rows = ref<ListedTransaction[]>([]);
const dayTotals = ref(new Map<string, DayTotal>());
const summary = ref<ListTransactionsResponse['summary'] | null>(null);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const listError = ref('');
const needsCount = ref<number | null>(null);

const openFacet = ref<TransactionFacet | null>(null);
const facetCounts = ref(new Map<string, number>());
const facetLoading = ref(false);

const listElement = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
let observer: IntersectionObserver | undefined;
let generation = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const names = computed<FilterNames>(() => ({
  member: new Map(lookups.value.member.map((item) => [item.id, item.name])),
  account: new Map(lookups.value.account.map((item) => [item.id, item.name])),
  category: new Map(lookups.value.category.map((item) => [item.id, item.name])),
  envelope: new Map(lookups.value.envelope.map((item) => [item.id, item.name])),
}));
const month = computed(() => (today.value ? monthOfDate(today.value) : ''));
const filtered = computed(() => hasActiveFilters(filters));

const chips = computed(() =>
  FACETS.map(({ facet, title }) => ({
    facet,
    title,
    label: chipLabel(facet, filters, names.value, month.value),
    on: isFacetActive(filters, facet),
  })),
);
const tabs = computed(() => [
  { value: 'all' as const, label: 'All' },
  {
    value: 'needs-category' as const,
    label:
      needsCount.value === null
        ? 'Needs a category'
        : `Needs a category · ${needsCount.value}`,
  },
]);

const days = computed(() => {
  const groups: { date: string; rows: ListedTransaction[] }[] = [];
  for (const row of rows.value) {
    const last = groups.at(-1);
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups.map((group) => {
    const total = dayTotals.value.get(group.date);
    return {
      ...group,
      heading: dayHeading(group.date, today.value),
      total: total
        ? totalsText(total, commonCurrency.value, coins.value, 'day')
        : '',
    };
  });
});
const summaryTotals = computed(() =>
  summary.value
    ? totalsText(summary.value, summary.value.currency, coins.value, 'summary')
    : '',
);

const sheetFacet = computed(() =>
  FACETS.find((item) => item.facet === openFacet.value),
);
const sheetOptions = computed(() =>
  openFacet.value
    ? facetOptions(openFacet.value, lookups.value, facetCounts.value, filters)
    : [],
);

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0
    ? cause.message
    : fallback;
}

async function bootstrap(): Promise<void> {
  bootError.value = '';
  try {
    const [settings, members, accounts, categories, active, archived, money] =
      await Promise.all([
        callApi('GET', '/api/settings', settingsResponseSchema),
        callApi('GET', '/api/members', membersResponseSchema),
        callApi('GET', '/api/accounts?inactive=true', accountsResponseSchema),
        callApi('GET', '/api/categories', categoriesResponseSchema),
        callApi('GET', '/api/envelopes', envelopesResponseSchema),
        callApi('GET', '/api/envelopes?archived=true', envelopesResponseSchema),
        callApi('GET', '/api/currencies', currenciesResponseSchema),
      ]);
    lookups.value = {
      member: members.members.map((item) => ({
        id: item.id,
        name: item.name,
        archived: !item.active,
      })),
      account: accounts.accounts.map((item) => ({
        id: item.id,
        name: item.name,
        archived: !item.active,
      })),
      category: categories.categories.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        archived: item.archived,
      })),
      envelope: [
        ...active.envelopes.map((item) => ({ ...item, archived: false })),
        ...archived.envelopes.map((item) => ({ ...item, archived: true })),
      ].map((item) => ({
        id: item.id,
        name: item.name,
        archived: item.archived,
      })),
    };
    coins.value = money.coins;
    commonCurrency.value = settings.commonCurrency;
    today.value = todayInTimeZone(new Date(), settings.timeZone);
    bootstrapped.value = true;
    void loadFirstPage();
    void loadNeedsCount();
  } catch (cause) {
    bootError.value = errorText(
      cause,
      'Could not load the transactions. Check your connection and try again.',
    );
  }
}

async function fetchPage(cursor: string | null) {
  const params = filtersToParams(filters);
  if (cursor) params.set('cursor', cursor);
  return callApi(
    'GET',
    `/api/transactions?${params.toString()}`,
    listTransactionsResponseSchema,
  );
}

function takeDays(response: ListTransactionsResponse): void {
  const next = new Map(dayTotals.value);
  for (const day of response.days) next.set(day.date, day);
  dayTotals.value = next;
}

async function loadFirstPage(): Promise<void> {
  const mine = ++generation;
  loading.value = true;
  loadingMore.value = false;
  listError.value = '';
  try {
    const response = await fetchPage(null);
    if (mine !== generation) return;
    rows.value = response.transactions;
    dayTotals.value = new Map();
    takeDays(response);
    summary.value = response.summary;
    nextCursor.value = response.nextCursor;
  } catch (cause) {
    if (mine !== generation) return;
    rows.value = [];
    nextCursor.value = null;
    listError.value = errorText(
      cause,
      'Could not load the transactions. Check your connection and try again.',
    );
  } finally {
    if (mine === generation) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const cursor = nextCursor.value;
  if (!cursor || loading.value || loadingMore.value) return;
  const mine = generation;
  loadingMore.value = true;
  listError.value = '';
  try {
    const response = await fetchPage(cursor);
    if (mine !== generation) return;
    rows.value = [...rows.value, ...response.transactions];
    takeDays(response);
    summary.value = response.summary;
    nextCursor.value = response.nextCursor;
  } catch (cause) {
    if (mine !== generation) return;
    listError.value = errorText(
      cause,
      'Could not load more. Check your connection and try again.',
    );
  } finally {
    if (mine === generation) loadingMore.value = false;
  }
}

/** The count on the second tab: expenses and incomes with no category. */
async function loadNeedsCount(): Promise<void> {
  try {
    const answer = await callApi(
      'GET',
      '/api/transactions/facets?facet=category&period=all',
      transactionFacetsResponseSchema,
    );
    needsCount.value =
      answer.options.find((option) => option.value === 'none')?.count ?? 0;
  } catch {
    needsCount.value = null;
  }
}

async function loadFacet(facet: TransactionFacet): Promise<void> {
  facetLoading.value = true;
  try {
    const answer = await callApi(
      'GET',
      `/api/transactions/facets?facet=${facet}&${filtersToParams(filters).toString()}`,
      transactionFacetsResponseSchema,
    );
    if (openFacet.value !== facet) return;
    facetCounts.value = new Map(
      answer.options.map((option) => [option.value, option.count]),
    );
  } catch {
    if (openFacet.value === facet) facetCounts.value = new Map();
  } finally {
    if (openFacet.value === facet) facetLoading.value = false;
  }
}

function openSheet(facet: TransactionFacet): void {
  openFacet.value = facet;
  facetCounts.value = new Map();
  void loadFacet(facet);
}

function toggle(value: string): void {
  const facet = openFacet.value;
  if (facet === null) return;
  if (facet === 'period') {
    filters.period = value as TransactionFilters['period'];
    return;
  }
  const current = filters[facet] as (IdOrNone | string)[];
  const picked: IdOrNone | string =
    facet === 'kind' || value === 'none' ? value : Number(value);
  const next = current.includes(picked)
    ? current.filter((item) => item !== picked)
    : [...current, picked];
  (filters[facet] as (IdOrNone | string)[]) = next;
}

function resetSheet(): void {
  const facet = openFacet.value;
  if (facet === null) return;
  if (facet === 'period') filters.period = emptyFilters().period;
  else (filters[facet] as unknown[]) = [];
}

function clearAll(): void {
  clearTimeout(searchTimer);
  searchText.value = '';
  Object.assign(filters, emptyFilters());
}

function observeEnd(): void {
  observer?.disconnect();
  if (!sentinel.value || !listElement.value || !nextCursor.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    },
    { root: listElement.value, rootMargin: '0px 0px 300px 0px' },
  );
  observer.observe(sentinel.value);
}

onMounted(() => void bootstrap());
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(searchTimer);
});

watch(searchText, (text) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.q = text;
  }, 250);
});

watch(
  () => filtersToParams(filters).toString(),
  () => {
    if (bootstrapped.value) void loadFirstPage();
  },
);

// A new page can leave the end of the list still in view, which an observer
// does not report again, so it is set up afresh each time the rows change.
watch(
  [() => rows.value.length, nextCursor, sentinel, tab],
  () => void nextTick(observeEnd),
  { flush: 'post' },
);
</script>

<template>
  <main class="screen app-screen transactions-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <h1 class="t-title transactions-title">Transactions</h1>
      <RouterLink
        class="icon-btn icon-btn-ink"
        to="/add"
        aria-label="Add transaction"
      >
        <BbIcon name="plus" />
      </RouterLink>
    </header>

    <div class="transactions-controls">
      <div class="input-wrap">
        <BbIcon name="search" :size="18" />
        <label class="sr" for="transactions-search">Search transactions</label>
        <input
          id="transactions-search"
          v-model="searchText"
          class="search"
          type="search"
          autocomplete="off"
          placeholder="Search merchant, note, amount"
        />
      </div>
      <div class="segmented" role="tablist" aria-label="Show">
        <button
          v-for="item in tabs"
          :key="item.value"
          class="seg"
          type="button"
          role="tab"
          :aria-selected="tab === item.value"
          @click="tab = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <div v-if="tab === 'all'" class="hrow" role="group" aria-label="Filters">
        <button
          v-if="filtered"
          class="fchip transactions-clear"
          type="button"
          aria-label="Clear all filters"
          @click="clearAll"
        >
          <BbIcon name="close" :size="14" />Clear
        </button>
        <button
          v-for="chip in chips"
          :key="chip.facet"
          class="fchip"
          type="button"
          aria-haspopup="dialog"
          :aria-pressed="chip.on"
          :aria-label="`${chip.title}: ${chip.label}`"
          @click="openSheet(chip.facet)"
        >
          {{ chip.label }}<BbIcon name="down" :size="14" />
        </button>
      </div>
    </div>

    <div
      ref="listElement"
      data-testid="transactions-list"
      class="content app-content transactions-list scroll"
    >
      <div v-if="bootError" role="alert">
        <p class="error">{{ bootError }}</p>
        <button class="text-btn" type="button" @click="bootstrap">
          Try again
        </button>
      </div>
      <p v-else-if="!bootstrapped" role="status">Loading transactions…</p>

      <NeedsCategoryTab v-else-if="tab === 'needs-category'" />

      <template v-else>
        <div v-if="summary && !listError" class="num transactions-summary">
          <span class="transactions-count">{{ countText(summary.count) }}</span>
          <span>{{ summaryTotals }}</span>
        </div>
        <p v-if="loading && rows.length === 0" role="status">Loading…</p>
        <div v-if="listError" role="alert">
          <p class="error">{{ listError }}</p>
          <button
            class="text-btn"
            type="button"
            @click="nextCursor && rows.length ? loadMore() : loadFirstPage()"
          >
            Try again
          </button>
        </div>
        <div
          v-else-if="!loading && summary && summary.count === 0"
          class="transactions-empty"
        >
          <p class="t-sub">
            {{
              filtered
                ? 'No transactions match.'
                : 'No transactions yet. Tap + to add one.'
            }}
          </p>
          <button
            v-if="filtered"
            class="text-btn"
            type="button"
            @click="clearAll"
          >
            Clear
          </button>
        </div>

        <TransactionDay
          v-for="day in days"
          :key="day.date"
          :heading="day.heading"
          :total="day.total"
        >
          <TransactionRow
            v-for="row in day.rows"
            :key="row.id"
            :row="row"
            :coins="coins"
          />
        </TransactionDay>
        <p v-if="loadingMore" class="t-sub" role="status">Loading more…</p>
        <div ref="sentinel" class="transactions-end" aria-hidden="true" />
      </template>
    </div>

    <TransactionsFilterSheet
      v-if="sheetFacet"
      :title="sheetFacet.title"
      :hint="
        sheetFacet.facet === 'period'
          ? 'Pick one.'
          : 'Pick any. None picked shows all.'
      "
      :options="sheetOptions"
      :single="sheetFacet.facet === 'period'"
      :count="loading || !summary ? null : summary.count"
      :loading="facetLoading"
      @toggle="toggle"
      @reset="resetSheet"
      @close="openFacet = null"
    />
  </main>
</template>

<style scoped>
.transactions-screen {
  height: var(--app-h, 100dvh);
  min-height: 0;
}
.transactions-title {
  flex: 1;
  min-width: 0;
}
.transactions-controls {
  padding: 4px var(--gutter) 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.transactions-clear {
  color: var(--muted);
}
.transactions-list {
  min-height: 0;
  overflow-y: auto;
  gap: 14px;
  padding-top: 4px;
  scrollbar-width: none;
}
.transactions-list::-webkit-scrollbar {
  display: none;
}
.transactions-summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--soft);
  font-size: 14px;
}
.transactions-count {
  font-weight: 600;
}
.transactions-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.transactions-end {
  height: 1px;
  flex: none;
}
</style>
