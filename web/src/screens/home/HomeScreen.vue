<script setup lang="ts">
import { goToSignIn } from '../../session/lock.js';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  currenciesResponseSchema,
  formatDate,
  homeResponseSchema,
  type CoinSetting,
  type HomeResponse,
} from '@budget-buddy/shared';
import BbAmount from '../../components/BbAmount.vue';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbProgress from '../../components/BbProgress.vue';
import ProfileSheet from './ProfileSheet.vue';
import { authState, setAuthState } from '../../stores/auth.js';
import { monthName } from '../envelopes/envelopeFormat.js';
import {
  createMoneyFormatter,
  directionClass,
  directionOfMinor,
} from '../summary/summaryFormat';

/**
 * Home: greeting, the eye button, the open check-in banner, the Income,
 * Transfer and Check-in tiles, this month's envelopes card, "Needs a
 * category", the Family wealth card, the "Everything" grid and the sticky
 * "Add expense" button (UI-HOME-1 to 6, DSH-4, D2).
 * Amounts are hidden whenever the screen opens, unless this device's setting
 * says otherwise; the eye shows them for 30 s, counting the seconds down in
 * the note. Nothing here stores whether they are visible.
 */
defineOptions({ name: 'HomeScreen' });

/** How long the eye keeps amounts visible (UI-HOME-3). */
const REVEAL_MS = 30_000;

const profileSheetOpen = ref(false);
const profileName = computed(() => authState.value?.member?.name ?? '');
const home = ref<HomeResponse | null>(null);
const coins = ref<CoinSetting[]>([]);
const loading = ref(true);
const loadError = ref('');
// Never stored anywhere: a new visit starts from the device setting again.
const visible = ref(false);
// While set, amounts hide again at this instant (UTC epoch milliseconds).
const hideAt = ref<number | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;
// Ticks once a second during a timed reveal so the note counts down.
let tickTimer: ReturnType<typeof setInterval> | undefined;
const now = ref(Date.now());
/** Whole seconds left of a timed reveal, rounded up; 30 when it starts. */
const secondsLeft = computed(() =>
  hideAt.value === null
    ? 0
    : Math.max(0, Math.ceil((hideAt.value - now.value) / 1000)),
);

const formatter = computed(() => createMoneyFormatter(coins.value));
const currency = computed(() => home.value?.commonCurrency ?? '');
const wealth = computed(() => home.value?.wealth ?? null);
const checkin = computed(() => home.value?.checkin ?? null);
const lastCheckinDate = computed(() =>
  wealth.value ? formatDate(wealth.value.lastCheckinDate, 'UTC') : '',
);
const summaryLink = computed(() =>
  wealth.value ? `/check-ins/${wealth.value.checkinId}` : '/check-ins',
);
/**
 * The tile opens the open check-in, or Check-ins when none is open, where
 * the member can start one. Home may be stale; the check-in screen's
 * no-check-in state has a way back too.
 */
const checkinTileLink = computed(() =>
  checkin.value ? '/check-in' : '/check-ins',
);
const dateLine = computed(() => {
  if (!home.value) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${home.value.today}T12:00:00Z`));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
});

const spending = computed(() => home.value?.spending ?? null);
const needsCategory = computed(() => home.value?.needsCategory ?? 0);
/** "October" and "Day 13 of 31" for the envelopes card's heading. */
const monthHeading = computed(() => {
  const today = home.value?.today;
  if (!today) return { month: '', day: '' };
  const [year = 0, month = 0, day = 0] = today.split('-').map(Number);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    month: monthName(today.slice(0, 7)),
    day: `Day ${day} of ${length}`,
  };
});
/** The month's spending, or what stands in for it while hidden. */
const spentAmount = computed(() => {
  const spent = spending.value?.spent;
  if (spent === undefined) return '';
  return spent === null
    ? 'Rate missing'
    : formatter.value.money(spent, currency.value);
});
// The design draws four dots here, one fewer than the wealth card's five.
const spentMask = computed(() =>
  formatter.value.masked(currency.value).replace(/ •$/u, ''),
);
/** What each envelope row says: the share while hidden, else the balance. */
const envelopeRows = computed(() =>
  (spending.value?.envelopes ?? []).map((envelope) => {
    const money = (minor: string) =>
      formatter.value.money(minor, envelope.currency);
    const hidden = envelope.over ? 'Over budget' : `${envelope.share}% used`;
    const shown = envelope.over
      ? `${money(String(-BigInt(envelope.left)))} over`
      : `${money(envelope.left)} left of ${money(envelope.available)}`;
    return {
      envelope,
      text: visible.value ? shown : hidden,
      label: `${envelope.name}, ${visible.value ? shown : hidden}`,
    };
  }),
);

const eyeLabel = computed(() => {
  if (visible.value) return 'Hide amounts';
  return home.value?.hideAmounts
    ? 'Show amounts for 30 seconds'
    : 'Show amounts';
});

const bannerTitle = computed(() => {
  const open = checkin.value;
  if (!open) return '';
  if (!open.scheduled) return 'Check-in is open';
  if (open.cadence === 'monthly') return 'Monthly check-in is open';
  if (open.cadence === 'weekly') return 'Weekly check-in is open';
  return 'Scheduled check-in is open';
});

/** "Opened today · 4 of your accounts to check"; no amounts, no dates. */
const bannerDetail = computed(() => {
  const open = checkin.value;
  if (!open || !home.value) return '';
  const when = openedWhen(open.openedDate, home.value.today);
  const opened =
    open.scheduled || open.openedBy === null
      ? `Opened ${when}`
      : `${open.openedByYou ? 'You' : open.openedBy} started it ${when}`;
  if (open.accountsLeft === 0) return `${opened} · you’re done`;
  const left = `${open.accountsLeft} of your accounts`;
  return `${opened} · ${left} ${open.scheduled ? 'to check' : 'left'}`;
});

const wealthSubline = computed(() => {
  const data = wealth.value;
  if (!data) return 'No check-in yet';
  if (!visible.value) return `Hidden · last check-in ${lastCheckinDate.value}`;
  if (data.change === null) return `Last check-in ${lastCheckinDate.value}`;
  const since = `since check-in of ${lastCheckinDate.value}`;
  return directionOfMinor(data.change) === 'unchanged'
    ? `Unchanged ${since}`
    : `${formatter.value.signed(data.change, currency.value)} ${since}`;
});

const wealthSublineClass = computed(() => {
  const change = wealth.value?.change;
  return visible.value && change != null
    ? directionClass(directionOfMinor(change))
    : '';
});

const wealthAmount = computed(() => {
  const amount = wealth.value?.amount;
  if (!visible.value) return '';
  return amount == null
    ? 'Rate missing'
    : formatter.value.money(amount, currency.value);
});

/** `today`, `yesterday`, `on Saturday` within a week, else `over a week ago`. */
function openedWhen(openedDate: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${openedDate}T12:00:00Z`)) /
      86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) {
    const weekday = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${openedDate}T12:00:00Z`));
    return `on ${weekday}`;
  }
  return 'over a week ago';
}

function hideAmounts(): void {
  clearTimeout(hideTimer);
  clearInterval(tickTimer);
  hideTimer = undefined;
  tickTimer = undefined;
  hideAt.value = null;
  visible.value = false;
}

function toggleAmounts(): void {
  if (visible.value) {
    hideAmounts();
    return;
  }
  visible.value = true;
  // With the device setting off, amounts are shown by default, so showing
  // them again after a manual hide needs no timer.
  if (!home.value?.hideAmounts) return;
  now.value = Date.now();
  hideAt.value = now.value + REVEAL_MS;
  hideTimer = setTimeout(hideAmounts, REVEAL_MS);
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
}

/**
 * Hides a timed reveal as soon as the page is backgrounded or left, so
 * nothing shows on return or in the app switcher. A device that shows amounts
 * by default (UI-HOME-4) has no timed reveal and is left alone. On return, a
 * suspended app may have missed its timer, so the deadline is checked too.
 */
function hideWhenBackgrounded(): void {
  if (hideAt.value === null) return;
  if (document.visibilityState === 'hidden' || Date.now() >= hideAt.value) {
    hideAmounts();
  }
}

/** The page is going away or into the back/forward cache. */
function hideOnPageHide(): void {
  if (hideAt.value !== null) hideAmounts();
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [homeResponse, currenciesResponse] = await Promise.all([
      fetch('/api/home'),
      fetch('/api/currencies'),
    ]);
    if (homeResponse.status === 401 || currenciesResponse.status === 401) {
      setAuthState(null);
      await goToSignIn();
      return;
    }
    if (!homeResponse.ok) throw new Error('Could not load Home.');
    home.value = homeResponseSchema.parse(await homeResponse.json());
    // Coins only matter for a coin as the common currency; the code shows
    // without them.
    coins.value = currenciesResponse.ok
      ? currenciesResponseSchema.parse(await currenciesResponse.json()).coins
      : [];
    visible.value = !home.value.hideAmounts;
  } catch {
    loadError.value =
      'Could not load Home. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', hideWhenBackgrounded);
  window.addEventListener('pagehide', hideOnPageHide);
  void load();
});

onBeforeUnmount(() => {
  clearTimeout(hideTimer);
  clearInterval(tickTimer);
  document.removeEventListener('visibilitychange', hideWhenBackgrounded);
  window.removeEventListener('pagehide', hideOnPageHide);
});
</script>

<template>
  <main class="screen app-screen home-screen">
    <header class="topbar home-header">
      <div class="home-title">
        <span v-if="dateLine" class="t-sub home-date">{{ dateLine }}</span>
        <h1 class="t-greeting">Hi, {{ profileName }}</h1>
      </div>
      <div class="home-actions">
        <button
          v-if="home"
          class="icon-btn home-eye"
          type="button"
          :aria-label="eyeLabel"
          :aria-pressed="visible"
          @click="toggleAmounts"
        >
          <BbIcon :name="visible ? 'eye' : 'eye-off'" :size="22" />
        </button>
        <button
          class="icon-btn icon-btn-ink home-profile-button"
          type="button"
          :aria-label="`${profileName} — switch profile or sign out`"
          aria-haspopup="dialog"
          @click="profileSheetOpen = true"
        >
          {{ profileName.slice(0, 1).toLocaleUpperCase() }}
        </button>
      </div>
    </header>

    <div class="content app-content home-content">
      <!-- A timer role is not announced on every tick. -->
      <p v-if="hideAt !== null" class="t-sub home-note" role="timer">
        Amounts visible · hiding again in {{ secondsLeft }} s
      </p>

      <p v-if="loading" class="home-state" role="status">Loading…</p>
      <div v-else-if="loadError" class="home-state home-error">
        <p role="alert">{{ loadError }}</p>
        <BbButton variant="secondary" @click="load">Try again</BbButton>
      </div>

      <template v-else-if="home">
        <RouterLink v-if="checkin" class="home-banner" to="/check-in">
          <BbIcon name="checkin" :size="22" class="home-banner-icon" />
          <span class="home-banner-text">
            <span class="home-banner-title">{{ bannerTitle }}</span>
            <span class="t-sub">{{ bannerDetail }}</span>
          </span>
          <span class="link home-banner-action">Continue</span>
        </RouterLink>

        <RouterLink
          v-if="home.backupWarning"
          class="home-backup"
          to="/settings"
        >
          <span class="home-backup-text">
            Last backup was {{ home.backupWarning.daysAgo }} days ago
          </span>
          <BbIcon name="forward" :size="18" class="chev" />
        </RouterLink>

        <nav class="home-tiles" aria-label="Quick actions">
          <RouterLink class="tile" to="/add?kind=income">
            <BbIcon name="income" :size="22" />
            Income
          </RouterLink>
          <RouterLink class="tile" to="/add?kind=transfer">
            <BbIcon name="transfer" :size="22" />
            Transfer
          </RouterLink>
          <RouterLink class="tile" :to="checkinTileLink">
            <BbIcon name="checkin" :size="22" />
            Check-in
          </RouterLink>
        </nav>

        <!-- Under the tiles: task 17's "Waiting to send" card goes here,
             above this month's envelopes. -->

        <section
          v-if="spending"
          class="home-month"
          aria-labelledby="month-heading"
        >
          <div class="home-month-head">
            <h2 id="month-heading" class="home-month-title">
              {{ monthHeading.month }}
            </h2>
            <span class="t-sub">{{ monthHeading.day }}</span>
          </div>
          <div class="home-month-spent">
            <span
              v-if="visible && spending.spent === null"
              class="num home-month-amount"
            >
              {{ spentAmount }}
            </span>
            <BbAmount
              v-else
              class="home-month-amount"
              :value="spentAmount"
              :visible="visible"
              :masked-value="spentMask"
            />
            <span class="t-sub">spent</span>
          </div>
          <RouterLink
            v-for="row in envelopeRows"
            :key="row.envelope.id"
            class="home-envelope"
            to="/envelopes"
          >
            <span class="home-envelope-head">
              <span class="home-envelope-name">{{ row.envelope.name }}</span>
              <span
                class="num t-sub"
                :class="{ warn: row.envelope.over }"
              >
                {{ row.text }}
              </span>
            </span>
            <BbProgress
              :value="row.envelope.share"
              :over="row.envelope.over"
              :label="`${row.envelope.name} used`"
              :value-text="visible ? '' : row.text"
            />
          </RouterLink>
        </section>

        <RouterLink
          v-if="needsCategory > 0"
          class="home-needs"
          to="/transactions?tab=needs-category"
          :aria-label="`Needs a category · ${needsCategory}`"
        >
          <BbIcon name="tag" :size="22" />
          <span class="home-needs-text">Needs a category</span>
          <span class="badge" aria-hidden="true">{{ needsCategory }}</span>
          <BbIcon name="forward" :size="18" class="chev" />
        </RouterLink>

        <RouterLink class="home-wealth" :to="summaryLink">
          <span class="home-wealth-text">
            <span class="t-sub">Family wealth · {{ currency }}</span>
            <template v-if="wealth">
              <span
                v-if="visible && wealth.amount === null"
                class="num home-wealth-amount"
              >
                {{ wealthAmount }}
              </span>
              <BbAmount
                v-else
                class="home-wealth-amount"
                :value="wealthAmount"
                :visible="visible"
                :masked-value="formatter.masked(currency)"
              />
            </template>
            <span class="num t-sub" :class="wealthSublineClass">
              {{ wealthSubline }}
            </span>
          </span>
          <BbIcon name="forward" :size="18" class="chev" />
        </RouterLink>

        <section class="home-everything" aria-labelledby="everything-heading">
          <h2 id="everything-heading" class="h home-grid-heading">
            Everything
          </h2>
          <nav class="home-grid" aria-label="Everything">
            <RouterLink class="home-grid-link" to="/transactions">
              <BbIcon name="transactions" />
              Transactions
            </RouterLink>
            <RouterLink class="home-grid-link" to="/envelopes">
              <BbIcon name="envelope" />
              Envelopes
            </RouterLink>
            <RouterLink class="home-grid-link" to="/accounts">
              <BbIcon name="account" />
              Accounts
            </RouterLink>
            <RouterLink class="home-grid-link" to="/check-ins">
              <BbIcon name="calendar" />
              Check-ins
            </RouterLink>
            <RouterLink class="home-grid-link" :to="summaryLink">
              <BbIcon name="chart" />
              Wealth history
            </RouterLink>
            <RouterLink class="home-grid-link" to="/categories">
              <BbIcon name="tag" />
              Categories
            </RouterLink>
            <RouterLink class="home-grid-link" to="/settings">
              <BbIcon name="settings" />
              Settings
            </RouterLink>
          </nav>
        </section>
      </template>
    </div>

    <footer class="bottombar home-bottombar">
      <RouterLink class="primary home-add" to="/add">
        <BbIcon name="plus" :size="22" :stroke-width="2.2" />
        Add expense
      </RouterLink>
    </footer>
    <ProfileSheet v-if="profileSheetOpen" @close="profileSheetOpen = false" />
  </main>
</template>

<style scoped>
/* The page content scrolls above a bottom bar that always stays in view. */
.home-screen {
  height: var(--app-h, 100dvh);
  min-height: 0;
}

.home-content {
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}

.home-content::-webkit-scrollbar {
  display: none;
}

.bb .home-bottombar {
  padding: 12px var(--gutter) max(16px, var(--safe-area-bottom));
  border-top: 1px solid var(--line);
  background: var(--bg);
}

.bb .home-add {
  height: 60px;
  border-radius: 18px;
  text-decoration: none;
}

.home-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.home-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.home-content {
  gap: 20px;
}

.home-note {
  margin: 0;
}

.home-state {
  margin: 0;
  padding: 16px;
  color: var(--muted);
}

.home-error {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.home-error p {
  margin: 0;
}

.home-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 14px 14px 14px 16px;
  border-radius: var(--r-card);
  background: var(--accent-soft);
  color: var(--ink);
  text-decoration: none;
}

.home-banner-icon {
  color: var(--accent);
}

.home-banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.home-banner-title {
  font-weight: 600;
}

.home-banner-action {
  font-size: 14px;
}

.home-backup {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 14px 16px;
  border-radius: var(--r-card);
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--warn);
  color: var(--warn);
  font-weight: 500;
  text-decoration: none;
}

.home-backup-text {
  flex: 1;
}

.home-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.home-tiles .tile {
  color: var(--ink);
  text-decoration: none;
}

.home-month {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 16px 8px;
  border-radius: var(--r-hero);
  background: var(--surface);
}

.home-month-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.home-month-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.home-month-spent {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0 10px;
}

.home-month-amount {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.home-envelope {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 44px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  color: var(--ink);
  text-decoration: none;
}

.home-envelope-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.home-envelope-name {
  font-weight: 500;
}

.home-needs {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 14px 16px;
  border-radius: var(--r-card);
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
}

.home-needs-text {
  flex: 1;
  font-weight: 500;
}

.home-wealth {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 16px;
  border-radius: var(--r-card);
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
}

.home-wealth-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.home-wealth-amount {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
</style>
