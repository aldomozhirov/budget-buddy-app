<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Account } from '@budget-buddy/shared';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';

/**
 * Searchable sheet behind an account chip row's "All…" (UI-NAV-7): every
 * active account with its owner and type, found by bank, person or currency.
 * With `allowAny`, a first row clears the choice. One pick closes it.
 */
const props = withDefaults(
  defineProps<{
    /** The active accounts. */
    accounts: Account[];
    /** The id that is selected now, or null for none. */
    selectedId: number | null;
    /** Heading of the sheet. */
    title?: string;
    /** Offers a row that clears the choice. */
    allowAny?: boolean;
    /** Name of the row that clears the choice. */
    anyLabel?: string;
  }>(),
  { title: 'Account', allowAny: false, anyLabel: 'Any account' },
);

const emit = defineEmits<{
  /** An account was picked, or null for the "any" row. */
  pick: [account: Account | null];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const TYPE_NAMES: Record<Account['type'], string> = {
  bank: 'Bank',
  cash: 'Cash',
  investment: 'Investment',
  crypto: 'Crypto',
  we_owe: 'We owe',
  owed_to_us: 'Owed to us',
};

const search = ref('');

const matches = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return props.accounts.filter((account) =>
    `${account.name} ${account.ownerName ?? ''} ${account.currency}`
      .toLocaleLowerCase()
      .includes(needle),
  );
});

function detail(account: Account): string {
  const owner = account.ownerName ? `${account.ownerName}’s` : 'Shared';
  return `${owner} · ${TYPE_NAMES[account.type]}`;
}
</script>

<template>
  <BbSheet :title="title" @close="emit('close')">
    <div class="input-wrap">
      <BbIcon name="search" :size="18" />
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Search: bank, person, currency"
        aria-label="Search: bank, person, currency"
      />
    </div>
    <div class="picker-list scroll" role="radiogroup" :aria-label="title">
      <button
        v-if="allowAny && !search.trim()"
        class="opt"
        type="button"
        role="radio"
        :aria-checked="selectedId === null"
        @click="emit('pick', null)"
      >
        <span class="picker-name">{{ anyLabel }}</span>
        <BbIcon v-if="selectedId === null" name="check" :size="18" />
      </button>
      <h4 v-if="matches.length" class="t-group">All accounts</h4>
      <button
        v-for="account in matches"
        :key="account.id"
        class="opt"
        type="button"
        role="radio"
        :aria-checked="account.id === selectedId"
        @click="emit('pick', account)"
      >
        <span class="picker-text">
          <span class="picker-name"
            >{{ account.name }} · {{ account.currency }}</span
          >
          <span class="t-sub">{{ detail(account) }}</span>
        </span>
        <BbIcon v-if="account.id === selectedId" name="check" :size="18" />
      </button>
      <p v-if="!matches.length" class="t-sub" role="status">
        No accounts found.
      </p>
    </div>
  </BbSheet>
</template>

<style scoped>
.picker-list {
  max-height: 55dvh;
  overflow-y: auto;
}
.picker-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.picker-name {
  font-weight: 500;
}
</style>
