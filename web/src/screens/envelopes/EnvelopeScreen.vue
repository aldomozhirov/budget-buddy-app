<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  addMonths,
  currenciesResponseSchema,
  deleteEnvelopeResponseSchema,
  envelopeDetailResponseSchema,
  envelopesResponseSchema,
  formatMoney,
  membersResponseSchema,
  settingsResponseSchema,
  todayInTimeZone,
  type CoinSetting,
  type Envelope,
  type EnvelopeAdjustment,
  type EnvelopeDetailResponse,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbConfirmSheet from '../../components/BbConfirmSheet.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbProgress from '../../components/BbProgress.vue';
import { ApiError, callApi } from '../../api/callApi.js';
import { useBack } from '../../composables/useBack.js';
import { replaceScreen } from '../../router';
import AdjustSheet from './AdjustSheet.vue';
import EnvelopeHistoryTab from './EnvelopeHistoryTab.vue';
import EnvelopeSheet from './EnvelopeSheet.vue';
import MoveMoneySheet from './MoveMoneySheet.vue';
import {
  cardFigures,
  dayLabel,
  daysToGo,
  envelopeCurrency,
  expenseCountText,
  monthName,
  pendingPlanLine,
  planLine,
} from './envelopeFormat.js';

/**
 * One envelope: the plan, what is left this month with "Move money" and
 * "Adjust", then the month's expenses, adjustments and moves, or the
 * History tab (UI-ENV-2 to UI-ENV-8). `?tab=history` and `?sheet=move` open
 * it in that state (UI-NAV-5).
 */
defineOptions({ name: 'EnvelopeScreen' });

type OpenSheet = 'move' | 'adjust' | 'edit' | null;

const route = useRoute();
const { label: backLabel, goBack } = useBack();
const id = computed(() => String(route.params.id));
// The query only sets the state the screen opens in; changing it later would
// remount the screen, since the shell keys screens by their full path.
const tab = ref<'month' | 'history'>(
  route.query.tab === 'history' ? 'history' : 'month',
);

const detail = ref<EnvelopeDetailResponse | null>(null);
const active = ref<Envelope[]>([]);
const names = ref(new Map<number, string>());
const members = ref(new Map<number, string>());
const coins = ref<CoinSetting[]>([]);
const today = ref('');
const loading = ref(true);
const error = ref('');
const actionError = ref('');
const sheet = ref<OpenSheet>(initialSheet());
const pendingDelete = ref<EnvelopeAdjustment | null>(null);
const historyKey = ref(0);

function initialSheet(): OpenSheet {
  const wanted = route.query.sheet;
  return wanted === 'move' || wanted === 'adjust' || wanted === 'edit'
    ? wanted
    : null;
}

const envelope = computed(() => detail.value?.envelope ?? null);
const month = computed(() => detail.value?.month.month ?? '');
const currency = computed(() =>
  envelopeCurrency(envelope.value?.currency ?? 'EUR', coins.value),
);
const money = (value: string | bigint): string =>
  formatMoney(BigInt(value), currency.value);

const figures = computed(() =>
  envelope.value
    ? cardFigures(envelope.value, currency.value, month.value)
    : null,
);
const over = computed(() => (figures.value?.left ?? 0n) < 0n);
const left = computed(() => {
  const value = figures.value?.left ?? 0n;
  return money(over.value ? -value : value);
});
const heroLine = computed(() => {
  const current = envelope.value;
  if (!current || !figures.value) return '';
  const spent = `${money(figures.value.spent)} spent of ${money(figures.value.available)}`;
  const what =
    current.startingMonth === month.value
      ? 'starting balance'
      : expenseCountText(current.monthExpenseCount);
  return `${spent} · ${what} · ${daysToGo(today.value)}`;
});
const carriedLine = computed(() => {
  const current = detail.value?.month;
  if (
    !current ||
    current.topUpMode !== 'carry_over' ||
    BigInt(current.opening) === 0n
  ) {
    return '';
  }
  const previous = monthName(addMonths(month.value, -1));
  return `${money(current.topUp)} + ${money(current.opening)} carried from ${previous}`;
});
const canMove = computed(
  () => !envelope.value?.archived && active.value.length >= 2,
);

interface MonthRow {
  key: string;
  date: string;
  title: string;
  meta: string;
  value: string;
  tone: 'ink' | 'accent';
  adjustment?: EnvelopeAdjustment;
}

const rows = computed<MonthRow[]>(() => {
  const data = detail.value;
  if (!data) return [];
  const expenses = data.expenses.map((expense): MonthRow => {
    const shown = expense.envelopeAmount ?? expense.amount;
    const code = expense.envelopeAmount
      ? data.envelope.currency
      : expense.accountCurrency;
    return {
      key: `x${expense.transactionId}`,
      date: expense.date,
      title: expense.merchant ?? expense.note ?? 'Expense',
      meta: [
        dayLabel(expense.date, today.value),
        members.value.get(expense.memberId),
        expense.accountName,
      ]
        .filter(Boolean)
        .join(' · '),
      value: formatMoney(BigInt(shown), envelopeCurrency(code, coins.value)),
      tone: 'ink',
    };
  });
  const adjustments = [...data.adjustments]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((adjustment): MonthRow => {
      const amount = BigInt(adjustment.amount);
      const size = money(amount < 0n ? -amount : amount);
      const counterpart = names.value.get(
        adjustment.counterpartEnvelopeId ?? 0,
      );
      let title: string;
      if (adjustment.moveId !== null) {
        title = `Moved ${size} ${amount < 0n ? 'to' : 'from'} ${
          counterpart ?? 'another envelope'
        }`;
      } else {
        title = `${amount < 0n ? 'Took out' : 'Added'} ${size}${
          adjustment.note ? ` · ${adjustment.note}` : ''
        }`;
      }
      return {
        key: `a${adjustment.id}`,
        date: adjustment.date,
        title,
        meta: [
          dayLabel(adjustment.date, today.value),
          members.value.get(adjustment.createdBy),
        ]
          .filter(Boolean)
          .join(' · '),
        value: `${amount > 0n ? '+' : ''}${money(amount)}`,
        tone: amount > 0n ? 'accent' : 'ink',
        adjustment,
      };
    });
  // Newest day first; on one day the expenses come before the adjustments.
  return [...expenses, ...adjustments].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? 1 : -1,
  );
});

const deleteTitle = computed(() =>
  pendingDelete.value?.moveId ? 'Delete this move?' : 'Delete this adjustment?',
);
const deleteMessage = computed(() =>
  pendingDelete.value?.moveId
    ? 'Both envelopes change back.'
    : 'The amount left changes back.',
);

onMounted(() => void load());

async function load(): Promise<void> {
  error.value = '';
  try {
    const [data, list, archived, memberData, settings, currencyData] =
      await Promise.all([
        callApi(
          'GET',
          `/api/envelopes/${id.value}`,
          envelopeDetailResponseSchema,
        ),
        callApi('GET', '/api/envelopes', envelopesResponseSchema),
        callApi('GET', '/api/envelopes?archived=true', envelopesResponseSchema),
        callApi('GET', '/api/members', membersResponseSchema),
        callApi('GET', '/api/settings', settingsResponseSchema),
        callApi('GET', '/api/currencies', currenciesResponseSchema),
      ]);
    detail.value = data;
    active.value = list.envelopes;
    names.value = new Map(
      [...list.envelopes, ...archived.envelopes].map((item) => [
        item.id,
        item.name,
      ]),
    );
    members.value = new Map(
      memberData.members.map((member) => [member.id, member.name]),
    );
    coins.value = currencyData.coins;
    today.value = todayInTimeZone(new Date(), settings.timeZone);
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the envelope. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

/** Reads the page again after a change, and the History tab with it. */
async function refresh(): Promise<void> {
  await load();
  historyKey.value += 1;
}

function openSheet(next: Exclude<OpenSheet, null>): void {
  sheet.value = next;
}

function closeSheet(): void {
  sheet.value = null;
}

function leave(): void {
  sheet.value = null;
  void replaceScreen('/envelopes');
}

async function removeAdjustment(): Promise<void> {
  const target = pendingDelete.value;
  pendingDelete.value = null;
  if (!target) return;
  actionError.value = '';
  try {
    await callApi(
      'DELETE',
      `/api/envelope-adjustments/${target.id}`,
      deleteEnvelopeResponseSchema,
    );
    await refresh();
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not delete it. Try again.';
  }
}
</script>

<template>
  <main class="screen app-screen envelope-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="envelope-title">
        <h1 class="t-title">{{ envelope?.name ?? 'Envelope' }}</h1>
        <template v-if="envelope">
          <span v-if="envelope.plan" class="num t-sub">{{
            planLine(envelope.plan, currency)
          }}</span>
          <span
            v-if="envelope.pendingPlan"
            class="num t-sub envelope-pending"
            >{{
              pendingPlanLine(envelope.pendingPlan, envelope.plan, currency)
            }}</span
          >
        </template>
      </div>
      <button
        class="icon-btn"
        type="button"
        aria-label="Edit envelope"
        aria-haspopup="dialog"
        :disabled="!envelope"
        @click="openSheet('edit')"
      >
        <BbIcon name="settings" />
      </button>
    </header>

    <div class="content app-content">
      <p v-if="loading" role="status">Loading envelope…</p>
      <div v-else-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <button class="text-btn" type="button" @click="load">Try again</button>
      </div>
      <template v-else-if="envelope && figures">
        <section
          class="card-hero envelope-hero"
          :class="{ 'card-warn': over }"
          aria-label="This month"
        >
          <span class="num envelope-left" :class="{ warn: over }">
            {{ over ? '−' : '' }}{{ left }}
            <span class="envelope-unit">{{ over ? 'overspent' : 'left' }}</span>
          </span>
          <BbProgress
            :value="
              over ? Number(figures.available) || 1 : Number(figures.spent)
            "
            :max="Number(figures.available) || 1"
            :over="over"
            :label="`${envelope.name} spent`"
          />
          <span class="num t-sub">{{ heroLine }}</span>
          <span v-if="carriedLine" class="num t-sub">{{ carriedLine }}</span>
          <div class="envelope-actions">
            <button
              class="secondary secondary-sm"
              type="button"
              aria-haspopup="dialog"
              :disabled="!canMove"
              @click="openSheet('move')"
            >
              <BbIcon name="transfer" :size="16" />Move money
            </button>
            <button
              class="secondary secondary-sm"
              type="button"
              aria-haspopup="dialog"
              :disabled="envelope.archived"
              @click="openSheet('adjust')"
            >
              <BbIcon name="plus" :size="16" />Adjust
            </button>
          </div>
        </section>

        <div class="segmented" role="tablist" aria-label="View">
          <button
            class="seg"
            type="button"
            role="tab"
            :aria-selected="tab === 'month'"
            @click="tab = 'month'"
          >
            {{ monthName(month) }}
          </button>
          <button
            class="seg"
            type="button"
            role="tab"
            :aria-selected="tab === 'history'"
            @click="tab = 'history'"
          >
            History
          </button>
        </div>

        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>

        <template v-if="tab === 'month'">
          <div v-if="rows.length" class="card envelope-rows">
            <template v-for="row in rows" :key="row.key">
              <button
                v-if="row.adjustment"
                class="row envelope-row"
                type="button"
                aria-haspopup="dialog"
                @click="pendingDelete = row.adjustment"
              >
                <span class="envelope-icon" aria-hidden="true">
                  <BbIcon
                    :name="row.adjustment.moveId ? 'transfer' : 'plus'"
                    :size="16"
                  />
                </span>
                <span class="row-l">
                  <span class="num envelope-row-title">{{ row.title }}</span>
                  <span class="t-sub">{{ row.meta }}</span>
                </span>
                <span
                  class="num envelope-row-value"
                  :class="{ accent: row.tone === 'accent' }"
                  >{{ row.value }}</span
                >
              </button>
              <div v-else class="row envelope-row">
                <span class="row-l">
                  <span class="envelope-row-title">{{ row.title }}</span>
                  <span class="t-sub">{{ row.meta }}</span>
                </span>
                <span class="num envelope-row-value">{{ row.value }}</span>
              </div>
            </template>
          </div>
          <p v-else class="t-sub">Nothing charged to this envelope yet.</p>
        </template>
        <EnvelopeHistoryTab
          v-else
          :key="historyKey"
          :envelope="envelope"
          :coins="coins"
        />
      </template>
    </div>

    <EnvelopeSheet
      v-if="sheet === 'edit' && envelope"
      :envelope="envelope"
      :month="month"
      @saved="refresh"
      @deleted="leave"
      @archived="leave"
      @close="closeSheet"
    />
    <MoveMoneySheet
      v-if="sheet === 'move' && envelope"
      :envelopes="active"
      :coins="coins"
      :from-id="envelope.id"
      @moved="refresh"
      @close="closeSheet"
    />
    <AdjustSheet
      v-if="sheet === 'adjust' && envelope"
      :envelope="envelope"
      :coins="coins"
      @adjusted="refresh"
      @close="closeSheet"
    />
    <BbConfirmSheet
      v-if="pendingDelete"
      :title="deleteTitle"
      :message="deleteMessage"
      confirm-label="Delete"
      cancel-label="Keep it"
      danger
      @confirm="removeAdjustment"
      @cancel="pendingDelete = null"
    />
  </main>
</template>

<style scoped>
.envelope-screen .app-content {
  gap: 14px;
}
.envelope-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.envelope-pending {
  font-weight: 500;
  color: var(--accent);
}
.envelope-left {
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.envelope-left.warn,
.envelope-left.warn .envelope-unit {
  color: var(--warn);
}
.envelope-unit {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--muted);
}
.envelope-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 6px;
}
.envelope-actions .secondary {
  height: 44px;
  gap: 6px;
  border-radius: 14px;
  background: var(--bg);
  font-size: 14px;
}
.envelope-rows {
  padding: 4px 16px;
}
.envelope-row {
  width: 100%;
  text-align: left;
}
.envelope-row-title {
  font-weight: 500;
}
.envelope-row-value {
  font-weight: 500;
}
.envelope-row-value.accent {
  color: var(--accent);
}
.envelope-icon {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: var(--soft);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
</style>
