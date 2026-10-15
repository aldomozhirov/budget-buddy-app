<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  currenciesResponseSchema,
  envelopeResponseSchema,
  envelopesResponseSchema,
  formatMoney,
  membersResponseSchema,
  monthOfDate,
  settingsResponseSchema,
  todayInTimeZone,
  type CoinSetting,
  type Envelope,
  type ManagedMember,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import { useBack } from '../../composables/useBack.js';
import { callApi, EnvelopeApiError } from './envelopeApi.js';
import {
  envelopeCurrency,
  expenseCountText,
  monthName,
  monthWithYear,
  shortDate,
} from './envelopeFormat.js';

/** Archived envelopes (UI-ENV-9): what is kept, with Restore and an undo. */
defineOptions({ name: 'ArchivedEnvelopesScreen' });

const { label: backLabel, goBack } = useBack();
const envelopes = ref<Envelope[]>([]);
const members = ref<ManagedMember[]>([]);
const coins = ref<CoinSetting[]>([]);
const timeZone = ref('Europe/Berlin');
const loading = ref(true);
const error = ref('');
const busyId = ref<number | null>(null);
/** The envelope just restored, for the undo message. */
const restored = ref<Envelope | null>(null);

/**
 * Who archived each envelope can only be read from `updatedBy`: nothing
 * records the member who archived it, so a later edit would show that member.
 */
const rows = computed(() =>
  envelopes.value.map((envelope) => {
    const currency = envelopeCurrency(envelope.currency, coins.value);
    const by = members.value.find((item) => item.id === envelope.updatedBy);
    const archivedAt = envelope.archivedAt ?? envelope.updatedAt;
    const lastMonth = monthOfDate(
      todayInTimeZone(new Date(archivedAt), timeZone.value),
    );
    const first = envelope.startingMonth;
    const span =
      first === lastMonth
        ? monthName(first)
        : first.slice(0, 4) === lastMonth.slice(0, 4)
          ? `${monthName(first)} – ${monthName(lastMonth)}`
          : `${monthWithYear(first)} – ${monthWithYear(lastMonth)}`;
    const left = formatMoney(
      BigInt(envelope.current?.closing ?? '0'),
      currency,
    );
    return {
      envelope,
      archived: `Archived ${shortDate(archivedAt, timeZone.value)}${
        by ? ` by ${by.name}` : ''
      }`,
      detail: `${left} left · ${expenseCountText(envelope.expenseCount)} · ${span}`,
    };
  }),
);

onMounted(() => void load());

async function load(): Promise<void> {
  error.value = '';
  try {
    const [list, memberData, settings, currencyData] = await Promise.all([
      callApi('GET', '/api/envelopes?archived=true', envelopesResponseSchema),
      callApi('GET', '/api/members', membersResponseSchema),
      callApi('GET', '/api/settings', settingsResponseSchema),
      callApi('GET', '/api/currencies', currenciesResponseSchema),
    ]);
    envelopes.value = list.envelopes;
    members.value = memberData.members;
    timeZone.value = settings.timeZone;
    coins.value = currencyData.coins;
  } catch (cause) {
    error.value =
      cause instanceof EnvelopeApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the archive. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

/** Archives or restores an envelope, then reads the list again. */
async function setArchived(envelope: Envelope, archived: boolean) {
  if (busyId.value !== null) return;
  busyId.value = envelope.id;
  error.value = '';
  try {
    await callApi(
      'PATCH',
      `/api/envelopes/${envelope.id}`,
      envelopeResponseSchema,
      { archived },
    );
    restored.value = archived ? null : envelope;
    await load();
  } catch (cause) {
    error.value =
      cause instanceof EnvelopeApiError
        ? cause.message
        : 'Could not change the envelope. Try again.';
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <main class="screen app-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <div class="archived-title">
        <h1 class="t-title">Archived envelopes</h1>
        <span class="t-sub">Kept for history · no top-ups</span>
      </div>
    </header>
    <div class="content app-content">
      <p v-if="loading" role="status">Loading the archive…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="!loading">
        <p v-if="restored" class="archived-undo" role="status">
          <span>{{ restored.name }} is restored.</span>
          <button
            class="text-btn"
            type="button"
            :disabled="busyId !== null"
            @click="setArchived(restored, true)"
          >
            Undo
          </button>
        </p>
        <BbListCard v-if="rows.length">
          <div v-for="row in rows" :key="row.envelope.id" class="archived-row">
            <span class="archived-text">
              <span class="archived-name">{{ row.envelope.name }}</span>
              <span class="num t-sub">{{ row.archived }}</span>
              <span class="num t-sub">{{ row.detail }}</span>
            </span>
            <button
              class="archived-restore"
              type="button"
              :aria-label="`Restore ${row.envelope.name}`"
              :disabled="busyId !== null"
              @click="setArchived(row.envelope, false)"
            >
              Restore
            </button>
          </div>
        </BbListCard>
        <p v-else-if="!error" class="t-sub">No archived envelopes.</p>
        <p v-if="rows.length" class="t-sub archived-note">
          An archived envelope keeps its expenses and months. Restored, it is
          topped up again from the next 1st.
        </p>
      </template>
    </div>
  </main>
</template>

<style scoped>
.archived-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.archived-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 8px 2px;
}
.archived-row + .archived-row {
  border-top: 1px solid var(--line);
}
.archived-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.archived-name {
  font-weight: 600;
}
.archived-restore {
  flex: none;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 22px;
  background: var(--bg);
  color: var(--accent);
  font-weight: 600;
  font-size: 14px;
}
.archived-undo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 0 4px;
}
.archived-note {
  margin: 0;
  padding: 0 4px;
}
</style>
