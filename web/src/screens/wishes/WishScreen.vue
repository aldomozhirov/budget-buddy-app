<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  addMonths,
  currenciesResponseSchema,
  wishResponseSchema,
  wishesResponseSchema,
  type CoinSetting,
  type Wish,
  type WishState,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbProgress from '../../components/BbProgress.vue';
import LinkExpenseSheet from './LinkExpenseSheet.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { isOnline } from '../../composables/useOnline.js';
import { useBack } from '../../composables/useBack.js';
import { expenseCountText, monthName } from '../envelopes/envelopeFormat.js';
import { createMoneyFormatter } from '../summary/summaryFormat.js';
import { cardFigures, madeLine, pageDetail, shortDay } from './wishesFormat.js';

/**
 * A wish's page: what is left and spent, "Tick off as done" or "Reopen",
 * "Move to <next month>", and the expenses that count for it (UI-WSH-4).
 * Each change acts at once and offers Undo in a short message (spec 3a,
 * Design 5). It needs a connection (UI-WSH-7).
 */
defineOptions({ name: 'WishScreen' });

/** How long the message, and so Undo, stays. */
const UNDO_MS = 8000;
const CHANGED = 'Someone changed it meanwhile.';

const route = useRoute();
const { label: backLabel, goBack } = useBack();
const id = computed(() => String(route.params.id));
const wish = ref<Wish | null>(null);
const coins = ref<CoinSetting[]>([]);
/** The family's current month, which decides whether a wish can move. */
const current = ref('');
const loading = ref(true);
const error = ref('');
const busy = ref(false);
/** The "Link an expense" sheet is open. */
const linking = ref(false);
/** The message at the bottom, with the call that takes the change back. */
const message = ref<{ text: string; undo: (() => Promise<void>) | null }>();
let timer: ReturnType<typeof setTimeout> | undefined;

const formatter = computed(() => createMoneyFormatter(coins.value));
const money = (minor: string): string =>
  formatter.value.money(minor, wish.value?.currency ?? '');
const figures = computed(() => (wish.value ? cardFigures(wish.value) : null));
const closed = computed(() => wish.value?.state !== 'open');
const nextMonth = computed(() => addMonths(current.value, 1));
const canMove = computed(
  () => wish.value?.state === 'open' && wish.value.month === current.value,
);
const subtitle = computed(() => {
  const item = wish.value;
  if (!item) return '';
  const parts = [`${monthName(item.month)} wish`, money(item.amount)];
  if (item.categoryName) parts.push(item.categoryName);
  return parts.join(' · ');
});
const headline = computed(() => {
  const item = wish.value;
  const shown = figures.value;
  if (!item || !shown) return { amount: '', unit: '' };
  if (closed.value) return { amount: money(item.spent), unit: 'spent' };
  return { amount: money(String(shown.headline)), unit: shown.unit };
});
const rows = computed(() =>
  (wish.value?.expenses ?? []).map((expense) => {
    const code = expense.currency;
    const other = code !== wish.value?.currency;
    return {
      expense,
      title: expense.merchant ?? expense.note ?? 'Expense',
      meta: [
        expense.merchant ? expense.note : null,
        shortDay(expense.date),
        expense.accountName,
        madeLine(expense),
      ]
        .filter(Boolean)
        .join(' · '),
      amount: formatter.value.signed(String(-BigInt(expense.amount)), code),
      countsAs: other
        ? expense.linkAmount === null
          ? 'Rate missing'
          : `counts as ${money(expense.linkAmount)}`
        : '',
    };
  }),
);

onMounted(() => void load());
onUnmounted(() => clearTimeout(timer));

/** Loads the wish, the coins and the current month. */
async function load(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    const [answer, currencies, month] = await Promise.all([
      callApi('GET', `/api/wishes/${id.value}`, wishResponseSchema),
      callApi('GET', '/api/currencies', currenciesResponseSchema),
      callApi('GET', '/api/wishes', wishesResponseSchema),
    ]);
    wish.value = answer.wish;
    coins.value = currencies.coins;
    current.value = month.month;
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the wish. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

/** Shows `text` for `ms`, with `undo` when the change can be taken back. */
function say(text: string, undo: (() => Promise<void>) | null, ms: number) {
  clearTimeout(timer);
  message.value = { text, undo };
  timer = setTimeout(() => (message.value = undefined), ms);
}

/** The text of a failed call, "changed" included. */
function failure(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return CHANGED;
  return cause instanceof ApiError && cause.status !== 0
    ? cause.message
    : 'Could not reach the server. Check your connection and try again.';
}

/** Sets the state, remembering what to go back to. */
async function setState(next: WishState, text: string): Promise<void> {
  const item = wish.value;
  if (!item || busy.value) return;
  const previous = item.state;
  busy.value = true;
  try {
    const answer = await callApi(
      'PATCH',
      `/api/wishes/${item.id}`,
      wishResponseSchema,
      { state: next, expect: { state: previous } },
    );
    wish.value = answer.wish;
    say(text, () => change(previous, { state: next }, 'Undone.'), UNDO_MS);
  } catch (cause) {
    say(failure(cause), null, 4000);
    if (cause instanceof ApiError && cause.status === 409) await load();
  } finally {
    busy.value = false;
  }
}

/** The Undo of a state change; a 409 means someone changed it first. */
async function change(
  state: WishState,
  expect: { state: WishState },
  text: string,
): Promise<void> {
  const item = wish.value;
  if (!item) return;
  try {
    const answer = await callApi(
      'PATCH',
      `/api/wishes/${item.id}`,
      wishResponseSchema,
      { state, expect },
    );
    wish.value = answer.wish;
    say(text, null, 4000);
  } catch (cause) {
    say(failure(cause), null, 4000);
    await load();
  }
}

/** Moves the open wish to `target` month; Undo moves it back. */
async function move(target: string, back: string, text: string): Promise<void> {
  const item = wish.value;
  if (!item || busy.value) return;
  busy.value = true;
  try {
    const answer = await callApi(
      'POST',
      `/api/wishes/${item.id}/move`,
      wishResponseSchema,
      { month: target, expect: { month: back } },
    );
    wish.value = answer.wish;
    say(text, () => unmove(target, back), UNDO_MS);
  } catch (cause) {
    say(failure(cause), null, 4000);
    if (cause instanceof ApiError && cause.status === 409) await load();
  } finally {
    busy.value = false;
  }
}

/** The Undo of a move: back to `back`, if the wish is still in `from`. */
async function unmove(from: string, back: string): Promise<void> {
  const item = wish.value;
  if (!item) return;
  try {
    const answer = await callApi(
      'POST',
      `/api/wishes/${item.id}/move`,
      wishResponseSchema,
      { month: back, expect: { month: from } },
    );
    wish.value = answer.wish;
    say('Undone.', null, 4000);
  } catch (cause) {
    say(failure(cause), null, 4000);
    await load();
  }
}

/** Links the tapped expense to the wish and closes the sheet (UI-WSH-6). */
async function link(transactionId: number): Promise<void> {
  const item = wish.value;
  if (!item || busy.value || !isOnline.value) return;
  busy.value = true;
  try {
    const answer = await callApi(
      'POST',
      `/api/wishes/${item.id}/links`,
      wishResponseSchema,
      { transactionId },
    );
    wish.value = answer.wish;
    linking.value = false;
    say(`Linked to ${item.name}`, null, 4000);
  } catch (cause) {
    linking.value = false;
    say(failure(cause), null, 4000);
    if (cause instanceof ApiError && cause.status === 409) await load();
  } finally {
    busy.value = false;
  }
}

/** Runs the message's Undo once. */
async function undo(): Promise<void> {
  const action = message.value?.undo;
  if (!action || busy.value) return;
  busy.value = true;
  try {
    await action();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="screen app-screen wish-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="wish-title">
        <h1 class="t-title">{{ wish?.name ?? 'Wish' }}</h1>
        <span v-if="wish" class="num t-sub">{{ subtitle }}</span>
      </div>
      <RouterLink
        v-if="wish"
        class="icon-btn"
        :to="`/wishes/${wish.id}/edit`"
        aria-label="Edit wish"
      >
        <BbIcon name="settings" />
      </RouterLink>
      <button
        v-else
        class="icon-btn"
        type="button"
        aria-label="Edit wish"
        disabled
      >
        <BbIcon name="settings" />
      </button>
    </header>

    <div class="content app-content wish-content">
      <p v-if="loading && !wish" role="status">Loading the wish…</p>
      <div v-else-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <button class="text-btn" type="button" @click="load">Try again</button>
      </div>
      <template v-else-if="wish && figures">
        <section class="card-hero wish-hero" aria-label="Wish">
          <span class="wish-left-row">
            <span
              class="num wish-left"
              :class="{ warn: figures.unit === 'over' && !closed }"
            >
              {{ headline.amount }}
              <span class="wish-unit">{{ headline.unit }}</span>
            </span>
            <span v-if="wish.state === 'done'" class="tag tag-mode tag-done"
              >Done</span
            >
            <span v-else-if="wish.state === 'dropped'" class="tag tag-mode"
              >Dropped</span
            >
          </span>
          <BbProgress
            :value="figures.spent"
            :max="figures.total"
            :over="figures.unit === 'over' && !closed"
            :label="`${wish.name} spent`"
          />
          <span class="num t-sub">{{ pageDetail(wish, money) }}</span>
          <span v-if="wish.note" class="t-sub">{{ wish.note }}</span>
          <div class="wish-actions" :class="{ single: !canMove }">
            <button
              v-if="wish.state === 'open'"
              class="wish-act"
              type="button"
              :disabled="busy || !isOnline"
              @click="setState('done', 'Ticked off as done.')"
            >
              <BbIcon name="check" :size="16" :stroke-width="2.2" />
              Tick off as done
            </button>
            <button
              v-else
              class="wish-act"
              type="button"
              :disabled="busy || !isOnline"
              @click="setState('open', 'Reopened.')"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
              </svg>
              Reopen
            </button>
            <button
              v-if="canMove"
              class="wish-act"
              type="button"
              :disabled="busy || !isOnline"
              @click="
                move(nextMonth, wish.month, `Moved to ${monthName(nextMonth)}.`)
              "
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              Move to {{ monthName(nextMonth) }}
            </button>
          </div>
        </section>

        <section class="wish-spent" aria-labelledby="wish-spent-h">
          <h2 id="wish-spent-h" class="wish-spent-h">Spent on it</h2>
          <RouterLink
            v-for="row in rows"
            :key="row.expense.transactionId"
            class="wish-row"
            :to="`/transactions/${row.expense.transactionId}`"
          >
            <span class="wish-row-text">
              <span class="wish-row-title">{{ row.title }}</span>
              <span class="num t-sub">{{ row.meta }}</span>
            </span>
            <span class="wish-row-money">
              <span class="num wish-row-amount">{{ row.amount }}</span>
              <span v-if="row.countsAs" class="num t-sub">{{
                row.countsAs
              }}</span>
            </span>
          </RouterLink>
          <p v-if="rows.length === 0" class="t-sub wish-none">
            {{ expenseCountText(0) }} yet.
          </p>
          <button
            class="wish-link"
            type="button"
            :disabled="!isOnline || wish.state === 'dropped'"
            @click="linking = true"
          >
            <BbIcon name="plus" :size="18" :stroke-width="2.2" />
            Link an expense you added
          </button>
        </section>

        <p v-if="!isOnline" class="t-sub wish-offline" role="status">
          Offline. Recording and changing wishes need a connection.
        </p>
      </template>
    </div>

    <div v-if="wish && wish.state === 'open'" class="wish-bar">
      <button class="primary num" type="button" :disabled="!isOnline">
        {{
          isOnline
            ? 'Record as expense'
            : 'Record as expense · needs a connection'
        }}
      </button>
    </div>

    <LinkExpenseSheet
      v-if="linking && wish"
      :wish-id="wish.id"
      :wish-name="wish.name"
      :month="wish.month"
      :format="formatter.signed"
      :disabled="busy || !isOnline"
      @pick="link"
      @close="linking = false"
    />

    <div v-if="message" class="toast wish-toast" role="status">
      <span class="wish-toast-text">{{ message.text }}</span>
      <button
        v-if="message.undo"
        class="wish-undo"
        type="button"
        :disabled="busy || !isOnline"
        @click="undo"
      >
        Undo
      </button>
    </div>
  </main>
</template>

<style scoped>
.wish-screen {
  height: var(--app-h, 100dvh);
  min-height: 0;
}
.wish-screen .app-content {
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.wish-screen .app-content::-webkit-scrollbar {
  display: none;
}
.wish-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wish-content {
  gap: 14px;
}
.wish-hero {
  gap: 10px;
}
.wish-left-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wish-left {
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.wish-left.warn,
.wish-left.warn .wish-unit {
  color: var(--warn);
}
.wish-unit {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--muted);
}
.wish-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 6px;
}
.wish-actions.single {
  grid-template-columns: 1fr;
}
.wish-act {
  min-height: 44px;
  border-radius: 14px;
  background: var(--bg);
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.wish-act:disabled {
  opacity: 0.5;
}
.wish-spent {
  display: flex;
  flex-direction: column;
  border-radius: var(--r-hero);
  background: var(--surface);
  padding: 4px 16px;
}
.wish-spent-h {
  margin: 12px 0 2px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}
.wish-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid var(--line);
}
.wish-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wish-row-title,
.wish-row-amount {
  font-weight: 500;
}
.wish-row-money {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.wish-none {
  margin: 8px 0;
}
.wish-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  color: var(--accent);
  font-weight: 600;
  text-align: left;
}
.wish-link:disabled {
  opacity: 0.5;
}
.wish-offline {
  margin: 0 4px;
  color: var(--warn);
}
.wish-bar {
  padding: 12px 16px max(34px, var(--safe-area-bottom));
  background: var(--bg);
  border-top: 1px solid var(--line);
}
.wish-bar .primary {
  width: 100%;
}
.wish-toast {
  position: fixed;
  z-index: 30;
}
.wish-toast-text {
  flex: 1;
  min-width: 0;
}
.wish-undo {
  min-height: 44px;
  padding: 0 8px;
  font-weight: 600;
  color: var(--on-ink);
}
</style>
