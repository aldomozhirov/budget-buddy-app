<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  settingsResponseSchema,
  type CurrencyOption,
} from '@budget-buddy/shared';
import { Search } from 'lucide-vue-next';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import BbSheet from '../../components/BbSheet.vue';

/** Bottom-sheet picker for the family's currency used in converted totals. */
const props = defineProps<{
  /** Currency choices, limited to ISO currencies and coins in use. */
  currencies: CurrencyOption[];
  /** Currently selected currency code. */
  selected: string;
}>();

const emit = defineEmits<{
  /** The family setting was saved. */
  saved: [currency: string];
  /** The picker was dismissed without saving. */
  close: [];
}>();

const search = ref('');
const busy = ref(false);
const error = ref('');
const filteredCurrencies = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return props.currencies;
  return props.currencies.filter(({ code, name }) =>
    `${code} ${name}`.toLowerCase().includes(needle),
  );
});

async function chooseCurrency(code: string): Promise<void> {
  if (busy.value) return;
  if (code === props.selected) {
    emit('saved', code);
    return;
  }

  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commonCurrency: code }),
    });
    if (!response.ok) {
      error.value = await readError(response);
      return;
    }
    const settings = settingsResponseSchema.parse(await response.json());
    emit('saved', settings.commonCurrency);
  } catch {
    error.value =
      'Could not save the currency. Check your connection and try again.';
  } finally {
    busy.value = false;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; fields?: Record<string, string> };
    };
    return (
      body.error?.fields?.commonCurrency ??
      body.error?.message ??
      'Could not save the currency. Try again.'
    );
  } catch {
    return 'Could not save the currency. Try again.';
  }
}
</script>

<template>
  <BbSheet title="Common currency" @close="emit('close')">
    <p class="t-sub settings-money-copy">
      Choose the currency for totals across currencies.
    </p>
    <label class="settings-field">
      <span class="lbl">Search currencies</span>
      <div class="input-wrap">
        <Search :size="18" aria-hidden="true" />
        <input
          v-model="search"
          class="search"
          type="search"
          aria-label="Search currencies"
          placeholder="Code or name"
        />
      </div>
    </label>
    <p v-if="error" class="error settings-form-error" role="alert">
      {{ error }}
    </p>
    <p
      v-if="filteredCurrencies.length === 0"
      class="t-sub settings-money-empty"
      role="status"
    >
      No currencies found.
    </p>
    <BbListCard
      v-else
      label="Choose common currency"
      class="settings-picker-list"
    >
      <BbRow
        v-for="currency in filteredCurrencies"
        :key="currency.code"
        interactive
        :aria-pressed="currency.code === selected"
        :aria-label="`${currency.code}, ${currency.name}`"
        :disabled="busy"
        @click="chooseCurrency(currency.code)"
      >
        <template #title>
          <span class="settings-picker-title"
            >{{ currency.code }} · {{ currency.name }}</span
          >
        </template>
        <template #trailing>
          <span
            v-if="currency.code === selected"
            class="settings-picker-selected"
          >
            Selected
          </span>
          <span v-else class="row-v">
            {{ currency.symbol }}
          </span>
        </template>
      </BbRow>
    </BbListCard>
    <BbButton variant="text" :disabled="busy" @click="emit('close')">
      Close
    </BbButton>
  </BbSheet>
</template>
