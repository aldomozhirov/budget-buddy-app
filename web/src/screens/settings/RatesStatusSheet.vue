<script setup lang="ts">
import { computed } from 'vue';
import type { RatesStatusResponse } from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import BbSheet from '../../components/BbSheet.vue';
import BbTag from '../../components/BbTag.vue';
import { formatRateDate, formatUpdated, staleRateDays } from './ratesFormat.js';

/**
 * Read-only status of the exchange rates (D6, CUR-4): when they were last
 * fetched, how old the latest rate of each currency in use is, and the last
 * error of each price feed. Rates cannot be edited here.
 */
const props = defineProps<{
  /** Status returned by `GET /api/rates/status`. */
  status: RatesStatusResponse;
}>();

const emit = defineEmits<{
  /** The sheet was dismissed. */
  close: [];
}>();

const updatedLine = computed(() =>
  props.status.lastUpdatedAt === null
    ? 'No rates fetched yet'
    : formatUpdated(
        props.status.lastUpdatedAt,
        props.status.today,
        props.status.timeZone,
      ),
);

const currencies = computed(() =>
  props.status.currencies.map((currency) => {
    const age = currency.ageDays;
    return {
      code: currency.code,
      date:
        currency.latestDate === null || age === null
          ? 'No rate yet'
          : formatRateDate(currency.latestDate, age, props.status.timeZone),
      detail:
        currency.source === null
          ? 'Waiting for the first fetch'
          : age !== null && age > 1
            ? `${currency.source} · ${age} days old`
            : currency.source,
      stale: age === null || age >= staleRateDays,
    };
  }),
);

const feeds = computed(() =>
  props.status.feeds.map((feed) => ({
    id: feed.id,
    name: feed.name,
    detail:
      feed.lastSuccessAt === null
        ? 'No answer yet'
        : `Last answer: ${formatUpdated(feed.lastSuccessAt, props.status.today, props.status.timeZone).replace('Updated ', '')}`,
    error: feed.lastError ? `Last error: ${feed.lastError.message}` : '',
  })),
);
</script>

<template>
  <BbSheet title="Exchange rates" @close="emit('close')">
    <p class="t-sub settings-money-copy">
      {{ updatedLine }}. Rates come from free public feeds once a day and are
      kept for every date.
    </p>
    <p
      v-if="currencies.length === 0"
      class="t-sub settings-money-empty"
      role="status"
    >
      Only {{ status.commonCurrency }} is in use, so no rates are needed.
    </p>
    <template v-else>
      <h4 class="h settings-rate-heading">Latest rate per currency</h4>
      <BbListCard label="Latest rate per currency">
        <BbRow
          v-for="currency in currencies"
          :key="currency.code"
          :title="currency.code"
          :subtitle="currency.detail"
        >
          <template #trailing>
            <span class="settings-rate-trailing">
              <span class="row-v">{{ currency.date }}</span>
              <BbTag v-if="currency.stale" tone="warn">Stale</BbTag>
            </span>
          </template>
        </BbRow>
      </BbListCard>
    </template>
    <template v-if="feeds.length > 0">
      <h4 class="h settings-rate-heading">Price feeds</h4>
      <BbListCard label="Price feeds">
        <template v-for="feed in feeds" :key="feed.id">
          <BbRow :title="feed.name" :subtitle="feed.detail" />
          <p v-if="feed.error" class="error settings-rate-error" role="alert">
            {{ feed.error }}
          </p>
        </template>
      </BbListCard>
    </template>
    <BbButton variant="text" @click="emit('close')"> Close </BbButton>
  </BbSheet>
</template>
