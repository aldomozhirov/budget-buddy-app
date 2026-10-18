<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { todayInTimeZone } from '@budget-buddy/shared';
import BbIcon from '../../components/BbIcon.vue';
import BbTag from '../../components/BbTag.vue';
import { outbox } from '../../offline/outbox.js';
import { describeRow } from '../transactions/transactionsFormat.js';
import { outboxRow, waitingRowSub } from '../transactions/outboxRows.js';
import { formatDateLine, limitedHomeShown } from './dateLine.js';

/**
 * Home without a connection (UI-HOME-7, `HomeOffline`, `HomeOfflineLocked`):
 * the greeting of the profile whose options are on the phone, an "Offline"
 * label where the eye and the avatar would be, the Income and Transfer
 * tiles, what waits in the outbox (no amounts) and the sticky "Add expense".
 * It shows when the device is locked, or Home had nothing loaded.
 */
defineOptions({ name: 'LimitedHome' });

const props = defineProps<{
  /** First name of the profile the stored options belong to. */
  name: string;
  /** The family's time zone, to say what day and time things were typed. */
  timeZone: string;
  /** True when the device asks to sign in again (MEM-7). */
  locked: boolean;
}>();

const today = computed(() => todayInTimeZone(new Date(), props.timeZone));
const dateLine = computed(() => formatDateLine(today.value));
const waiting = computed(() =>
  outbox.items.value.map((item) => ({
    item,
    title: describeRow(outboxRow(item), []).title,
    sub: waitingRowSub(item, today.value, props.timeZone),
  })),
);

onMounted(() => (limitedHomeShown.value = true));
onBeforeUnmount(() => (limitedHomeShown.value = false));
</script>

<template>
  <main class="screen app-screen home-screen limited-home">
    <header class="topbar home-header">
      <div class="home-title">
        <span class="t-sub">{{ dateLine }}</span>
        <h1 class="t-greeting">Hi, {{ name }}</h1>
      </div>
      <span class="limited-pill">
        <!-- The design's slashed cloud, as in OfflineNote. -->
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
          <path d="M3 3l18 18" />
          <path d="M9 19h8a4 4 0 0 0 1.6-7.7" />
          <path d="M6 9.6A5 5 0 0 0 7 19" />
        </svg>
        Offline
      </span>
    </header>

    <div class="content app-content limited-content">
      <nav class="limited-tiles" aria-label="Quick actions">
        <RouterLink class="tile" to="/add?kind=income">
          <BbIcon name="income" :size="22" />
          Income
        </RouterLink>
        <RouterLink class="tile" to="/add?kind=transfer">
          <BbIcon name="transfer" :size="22" />
          Transfer
        </RouterLink>
      </nav>

      <section
        v-if="waiting.length"
        class="limited-waiting"
        aria-labelledby="limited-waiting-title"
      >
        <div class="limited-waiting-head">
          <BbIcon name="upload" :size="20" />
          <h2 id="limited-waiting-title" class="limited-waiting-title">
            Waiting to send · {{ waiting.length }}
          </h2>
        </div>
        <span class="t-sub limited-waiting-note">
          They send themselves when you’re back online.
        </span>
        <div
          v-for="entry in waiting"
          :key="entry.item.clientId"
          class="limited-waiting-row"
        >
          <span class="limited-waiting-text">
            <span class="limited-waiting-name">{{ entry.title }}</span>
            <span class="t-sub">{{ entry.sub }}</span>
          </span>
          <BbTag :tone="entry.item.state === 'failed' ? 'warn' : 'neutral'">
            {{
              entry.item.state === 'failed' ? 'Couldn’t send' : 'On this phone'
            }}
          </BbTag>
        </div>
      </section>

      <div class="limited-info">
        <BbIcon name="info" :size="20" />
        <span class="limited-info-text">
          Balances, envelopes and check-ins show when you’re back online{{
            locked ? ' and signed in' : ''
          }}.
        </span>
      </div>
    </div>

    <footer class="bottombar home-bottombar">
      <RouterLink class="primary home-add" to="/add">
        <BbIcon name="plus" :size="22" :stroke-width="2.2" />
        Add expense
      </RouterLink>
    </footer>
  </main>
</template>

<style scoped>
.limited-home {
  height: var(--app-h, 100dvh);
  min-height: 0;
}

.limited-content {
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  gap: 20px;
}

.limited-content::-webkit-scrollbar {
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

.limited-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 13px;
  font-weight: 600;
}

.limited-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.limited-tiles .tile {
  color: var(--ink);
  text-decoration: none;
}

.limited-waiting {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 16px 6px;
  border-radius: var(--r-hero);
  background: var(--surface);
}

.limited-waiting-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.limited-waiting-title {
  flex: 1;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.limited-waiting-note {
  padding: 2px 0 6px 30px;
  font-size: 13px;
}

.limited-waiting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border-top: 1px solid var(--line);
}

.limited-waiting-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.limited-waiting-name {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.limited-info {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: var(--r-card);
  background: var(--soft);
  color: var(--muted);
}

.limited-info svg {
  margin-top: 1px;
}

.limited-info-text {
  flex: 1;
  color: var(--ink);
  font-size: 14px;
}
</style>
