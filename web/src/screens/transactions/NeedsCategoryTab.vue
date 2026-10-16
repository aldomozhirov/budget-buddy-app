<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import {
  addOptionsResponseSchema,
  labelTransactionsResponseSchema,
  needsCategoryResponseSchema,
  type CoinCurrency,
  type NeedsCategoryRow,
} from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbListCard from '../../components/BbListCard.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { isOnline } from '../../composables/useOnline.js';
import { dayHeading, money } from './transactionsFormat.js';

/**
 * The "Needs a category" tab of Transactions (CAT-7, UI-TXN-3; O7, O8):
 * expenses and incomes saved without a category, each with its suggestion as
 * a one-tap chip and "Other…" (the Add form's category sheet). Several rows
 * can be ticked and labelled at once, and the last labelling can be undone
 * from a short message. Labelling an expense that has no envelope also gives
 * it the category's default envelope, which the message says.
 */
const props = defineProps<{
  /** The family's own coins, to read the currency of an amount. */
  coins: readonly CoinCurrency[];
  /** `YYYY-MM-DD` in the family time zone, for "Today". */
  today: string;
}>();

const emit = defineEmits<{
  /** How many transactions wait, as the server counted them. */
  count: [count: number];
  /** Something was labelled or unlabelled, so the "All" list is stale. */
  changed: [];
}>();

/** One chosen label for a row. */
interface Choice {
  row: NeedsCategoryRow;
  categoryId: number;
  categoryName: string;
}

/** What the short message can take back. */
interface Applied {
  message: string;
  rows: NeedsCategoryRow[];
  /** The envelope each labelling filled, by transaction id. */
  filled: Map<number, number>;
}

type OptionCategory = { id: number; name: string; kind: 'expense' | 'income' };

const RECENT_CATEGORIES = 3;

const rows = ref<NeedsCategoryRow[]>([]);
const nextCursor = ref<string | null>(null);
const total = ref(0);
const loaded = ref(false);
const loadingMore = ref(false);
const loadError = ref('');
const actionError = ref('');
const busy = ref(false);
const selected = ref(new Set<number>());
const applied = ref<Applied | null>(null);
const note = ref('');

const categories = ref<OptionCategory[]>([]);
const sheetRow = ref<NeedsCategoryRow | null>(null);

const sentinel = ref<HTMLElement>();
let observer: IntersectionObserver | undefined;

const lines = computed(() =>
  rows.value.map((row) => {
    const amount = BigInt(row.amount);
    const refund = row.kind === 'expense' && amount < 0n;
    const gain = row.kind === 'income' || refund;
    const meta = [
      dayHeading(row.date, props.today),
      row.accountName,
      row.memberName,
    ];
    if (refund) meta.unshift('Refund');
    return {
      row,
      title: titleOf(row),
      meta: meta.join(' · '),
      amount: gain
        ? `+${money(refund ? -amount : amount, row.currency, props.coins)}`
        : money(-amount, row.currency, props.coins),
      gain,
    };
  }),
);
const ticked = computed(
  () =>
    rows.value.filter((row) => selected.value.has(row.id) && row.suggestion)
      .length,
);
const sheetCategories = computed(() =>
  categories.value
    .filter((category) => category.kind === sheetRow.value?.kind)
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const sheetRecent = computed(() =>
  categories.value
    .filter((category) => category.kind === sheetRow.value?.kind)
    .slice(0, RECENT_CATEGORIES)
    .map((category) => category.id),
);

function titleOf(row: NeedsCategoryRow): string {
  return row.merchant ?? (row.kind === 'income' ? 'Income' : 'No merchant');
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0
    ? cause.message
    : fallback;
}

async function loadPage(cursor: string | null): Promise<void> {
  const answer = await callApi(
    'GET',
    `/api/transactions/needs-category${cursor ? `?cursor=${cursor}` : ''}`,
    needsCategoryResponseSchema,
  );
  const known = new Set(rows.value.map((row) => row.id));
  rows.value = [
    ...rows.value,
    ...answer.transactions.filter((row) => !known.has(row.id)),
  ];
  nextCursor.value = answer.nextCursor;
  total.value = answer.count;
  emit('count', answer.count);
}

async function loadFirst(): Promise<void> {
  loadError.value = '';
  try {
    rows.value = [];
    await loadPage(null);
    loaded.value = true;
  } catch (cause) {
    loadError.value = errorText(
      cause,
      'Could not load the list. Check your connection and try again.',
    );
  }
}

async function loadMore(): Promise<void> {
  const cursor = nextCursor.value;
  if (!cursor || loadingMore.value) return;
  loadingMore.value = true;
  try {
    await loadPage(cursor);
  } catch (cause) {
    loadError.value = errorText(
      cause,
      'Could not load more. Check your connection and try again.',
    );
  } finally {
    loadingMore.value = false;
  }
}

/** The categories for the "Other…" sheet, in the Add form's order. */
async function loadCategories(): Promise<void> {
  try {
    const options = await callApi(
      'GET',
      '/api/add-options',
      addOptionsResponseSchema,
    );
    categories.value = options.categories;
  } catch {
    // Retried when "Other…" is next tapped.
  }
}

function toggle(row: NeedsCategoryRow): void {
  const next = new Set(selected.value);
  if (!next.delete(row.id)) next.add(row.id);
  selected.value = next;
}

function byNewest(a: NeedsCategoryRow, b: NeedsCategoryRow): number {
  return b.date.localeCompare(a.date) || b.id - a.id;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Labels the chosen rows in one request and offers the undo. */
async function apply(choices: Choice[]): Promise<void> {
  if (busy.value || choices.length === 0) return;
  busy.value = true;
  actionError.value = '';
  note.value = '';
  try {
    const answer = await callApi(
      'POST',
      '/api/transactions/label',
      labelTransactionsResponseSchema,
      {
        items: choices.map((choice) => ({
          id: choice.row.id,
          categoryId: choice.categoryId,
        })),
      },
    );
    const done = new Map(answer.labelled.map((item) => [item.id, item]));
    const gone = new Set([...done.keys(), ...answer.skipped]);
    const labelled = choices.filter((choice) => done.has(choice.row.id));
    rows.value = rows.value.filter((row) => !gone.has(row.id));
    selected.value = new Set([...selected.value].filter((id) => !gone.has(id)));
    total.value = answer.count;
    emit('count', answer.count);
    emit('changed');
    if (labelled.length === 0) {
      applied.value = null;
      note.value = 'Those were already labelled.';
      return;
    }
    const filled = new Map<number, number>();
    const envelopes: string[] = [];
    for (const choice of labelled) {
      const item = done.get(choice.row.id);
      if (item?.filledEnvelopeId != null) {
        filled.set(choice.row.id, item.filledEnvelopeId);
        envelopes.push(item.filledEnvelopeName ?? '');
      }
    }
    applied.value = {
      message: appliedMessage(labelled, envelopes),
      rows: labelled.map((choice) => choice.row),
      filled,
    };
    // Fewer than a page can be left while more wait on the server.
    if (rows.value.length < 10 && nextCursor.value) void loadMore();
  } catch (cause) {
    actionError.value = errorText(
      cause,
      'Could not label. Check your connection and try again.',
    );
  } finally {
    busy.value = false;
  }
}

function appliedMessage(labelled: Choice[], envelopes: string[]): string {
  const [only] = labelled;
  if (labelled.length === 1 && only) {
    const text = `${titleOf(only.row)} → ${only.categoryName}`;
    return envelopes.length ? `${text} · ${envelopes[0]} envelope added` : text;
  }
  const kinds = new Set(labelled.map((choice) => choice.row.kind));
  const text = `${labelled.length} ${
    kinds.size === 1 && kinds.has('expense') ? 'expenses' : 'transactions'
  } labelled`;
  return envelopes.length
    ? `${text} · ${plural(envelopes.length, 'envelope')} added`
    : text;
}

function applySuggestion(row: NeedsCategoryRow): void {
  if (!row.suggestion) return;
  void apply([
    {
      row,
      categoryId: row.suggestion.categoryId,
      categoryName: row.suggestion.categoryName,
    },
  ]);
}

function applySelected(): void {
  void apply(
    rows.value.flatMap((row) =>
      selected.value.has(row.id) && row.suggestion
        ? [
            {
              row,
              categoryId: row.suggestion.categoryId,
              categoryName: row.suggestion.categoryName,
            },
          ]
        : [],
    ),
  );
}

function openOther(row: NeedsCategoryRow): void {
  sheetRow.value = row;
  if (categories.value.length === 0) void loadCategories();
}

function pickOther(category: { id: number; name: string }): void {
  const row = sheetRow.value;
  sheetRow.value = null;
  if (!row) return;
  if (!categories.value.some((item) => item.id === category.id)) {
    categories.value = [
      ...categories.value,
      { id: category.id, name: category.name, kind: row.kind },
    ];
  }
  void apply([{ row, categoryId: category.id, categoryName: category.name }]);
}

/** Takes the last labelling back, envelopes included, and lists it again. */
async function undo(): Promise<void> {
  const last = applied.value;
  if (!last || busy.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    const answer = await callApi(
      'POST',
      '/api/transactions/label',
      labelTransactionsResponseSchema,
      {
        items: last.rows.map((row) => {
          const envelopeId = last.filled.get(row.id);
          return {
            id: row.id,
            categoryId: null,
            ...(envelopeId === undefined
              ? {}
              : { takeBackEnvelopeId: envelopeId }),
          };
        }),
      },
    );
    const back = new Set(answer.labelled.map((item) => item.id));
    const known = new Set(rows.value.map((row) => row.id));
    rows.value = [
      ...rows.value,
      ...last.rows.filter((row) => back.has(row.id) && !known.has(row.id)),
    ].sort(byNewest);
    total.value = answer.count;
    emit('count', answer.count);
    emit('changed');
    applied.value = null;
  } catch (cause) {
    actionError.value = errorText(
      cause,
      'Could not undo. Check your connection and try again.',
    );
  } finally {
    busy.value = false;
  }
}

function observeEnd(): void {
  observer?.disconnect();
  const end = sentinel.value;
  if (!end || !nextCursor.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    },
    {
      root: end.closest<HTMLElement>('.scroll'),
      rootMargin: '0px 0px 300px 0px',
    },
  );
  observer.observe(end);
}

onMounted(() => {
  void loadFirst();
  void loadCategories();
});
onBeforeUnmount(() => observer?.disconnect());

// A new page can leave the end still in view, which an observer does not
// report again, so it is set up afresh each time the rows change.
watch(
  [() => rows.value.length, nextCursor, sentinel],
  () => void nextTick(observeEnd),
  { flush: 'post' },
);
</script>

<template>
  <div class="needs-tab">
    <div v-if="loadError" role="alert">
      <p class="error">{{ loadError }}</p>
      <button
        class="text-btn"
        type="button"
        @click="rows.length ? loadMore() : loadFirst()"
      >
        Try again
      </button>
    </div>
    <p v-else-if="!loaded" role="status">Loading…</p>

    <template v-else>
      <p v-if="rows.length" class="t-sub needs-intro">
        These were saved without a category. Tap a suggestion, or tick several
        and apply all.
      </p>
      <BbListCard v-if="rows.length" label="Waiting for a category">
        <div v-for="line in lines" :key="line.row.id" class="needs-item">
          <div class="needs-head">
            <button
              class="needs-select"
              type="button"
              :aria-pressed="selected.has(line.row.id)"
              :aria-label="`Select ${line.title}`"
              @click="toggle(line.row)"
            >
              <span
                class="box"
                :class="{ 'box-on': selected.has(line.row.id) }"
              >
                <BbIcon
                  v-if="selected.has(line.row.id)"
                  name="check"
                  :size="14"
                />
              </span>
            </button>
            <span class="needs-text">
              <span class="needs-top">
                <span class="needs-title">{{ line.title }}</span>
                <span
                  class="num needs-amount"
                  :class="{ 'needs-gain': line.gain }"
                  >{{ line.amount }}</span
                >
              </span>
              <span class="t-sub needs-meta">{{ line.meta }}</span>
            </span>
          </div>
          <div class="needs-chips">
            <button
              v-if="line.row.suggestion"
              class="chip-suggest"
              type="button"
              :disabled="busy || !isOnline"
              @click="applySuggestion(line.row)"
            >
              <BbIcon name="check" :size="14" />{{
                line.row.suggestion.categoryName
              }}
            </button>
            <button
              class="chip chip-sm chip-ghost"
              type="button"
              aria-haspopup="dialog"
              :disabled="busy || !isOnline"
              @click="openOther(line.row)"
            >
              Other…
            </button>
          </div>
        </div>
      </BbListCard>
      <p v-if="loadingMore" class="t-sub" role="status">Loading more…</p>
      <div ref="sentinel" class="needs-end" aria-hidden="true" />

      <div v-if="rows.length === 0" class="needs-empty">
        <span class="needs-done success-icon">
          <BbIcon name="check" :size="26" />
        </span>
        <span class="needs-empty-text">Everything is labelled</span>
      </div>

      <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      <p v-if="note" class="t-sub" role="status">{{ note }}</p>
      <div v-if="applied" class="needs-undo" role="status">
        <span class="needs-undo-text">{{ applied.message }}</span>
        <button
          class="needs-undo-btn"
          type="button"
          :disabled="busy || !isOnline"
          @click="undo"
        >
          Undo
        </button>
      </div>

      <div v-if="ticked > 0" class="needs-bar">
        <BbButton :disabled="busy" needs-server @click="applySelected">
          Apply suggestions to {{ ticked }} selected
        </BbButton>
      </div>
    </template>

    <CategoryPickerSheet
      v-if="sheetRow"
      :categories="sheetCategories"
      :selected-id="null"
      :recent-ids="sheetRecent"
      :kind="sheetRow.kind"
      @pick="pickOther"
      @close="sheetRow = null"
    />
  </div>
</template>

<style scoped>
.needs-tab {
  /* Fills the scroll area, so the apply bar rests on its bottom edge. */
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.needs-tab > p {
  margin: 0;
}
.needs-intro {
  padding: 0 4px;
}
.needs-item + .needs-item {
  border-top: 1px solid var(--line);
}
.needs-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0 8px;
}
.needs-select {
  flex: none;
  width: 44px;
  height: 44px;
  margin: -10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.needs-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.needs-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.needs-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.needs-amount {
  font-weight: 500;
}
.needs-gain {
  color: var(--accent);
}
.needs-meta {
  font-size: 13px;
}
.needs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 0 12px 40px;
}
.needs-end {
  height: 1px;
  flex: none;
}
.needs-empty {
  padding: 32px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.needs-done {
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.needs-empty-text {
  font-weight: 600;
}
.needs-undo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--ink);
  color: var(--on-ink);
  font-size: 14px;
}
.needs-undo-text {
  flex: 1;
  min-width: 0;
}
.needs-undo-btn {
  min-height: 44px;
  padding: 0 8px;
  font-weight: 600;
  color: var(--on-ink);
}
.needs-bar {
  position: sticky;
  bottom: 0;
  margin: auto calc(-1 * var(--gutter))
    calc(-1 * max(32px, var(--safe-area-bottom)));
  padding: 12px var(--gutter) calc(12px + var(--safe-area-bottom));
  border-top: 1px solid var(--line);
  background: var(--bg);
}
</style>
