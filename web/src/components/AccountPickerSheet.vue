<script
  setup
  lang="ts"
  generic="
    T extends Pick<
      Account,
      'id' | 'name' | 'ownerMemberId' | 'ownerName' | 'type' | 'currency'
    >
  "
>
import { computed, ref } from 'vue';
import type { Account } from '@budget-buddy/shared';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';

/**
 * Searchable sheet behind an account chip row's "All…" (UI-NAV-7): every
 * active account with its owner and type, found by bank, person, type or
 * currency. With `profileId` the list is grouped "Yours", "Max’s" and a
 * search shows "2 matches" (`SearchAccounts`). With `allowAny`, a first row
 * clears the choice. One pick closes it.
 */
const props = withDefaults(
  defineProps<{
    /** The active accounts. */
    accounts: T[];
    /** The id that is selected now, or null for none. */
    selectedId: number | null;
    /** Heading of the sheet. */
    title?: string;
    /** Offers a row that clears the choice. */
    allowAny?: boolean;
    /** Name of the row that clears the choice. */
    anyLabel?: string;
    /** The signed-in profile, to group the list by owner. */
    profileId?: number | null;
  }>(),
  {
    title: 'Account',
    allowAny: false,
    anyLabel: 'Any account',
    profileId: null,
  },
);

const emit = defineEmits<{
  /** An account was picked, or null for the "any" row. */
  pick: [account: T | null];
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
const needle = computed(() => search.value.trim());

/** "Yours", "Max’s" or "Shared". */
function owner(account: T): string {
  if (props.profileId !== null && account.ownerMemberId === props.profileId) {
    return 'Yours';
  }
  return account.ownerName ? `${account.ownerName}’s` : 'Shared';
}

/** Every typed word must be in the name, owner, type or currency. */
const matches = computed(() => {
  const words = needle.value.toLocaleLowerCase().split(/\s+/u);
  return props.accounts.filter((account) => {
    const text = [
      account.name,
      account.ownerName ?? '',
      owner(account),
      TYPE_NAMES[account.type],
      account.currency,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
});

/** The list's groups: by owner, or the matches of a search. */
const groups = computed(() => {
  if (props.profileId === null) {
    return [{ title: 'All accounts', accounts: matches.value }];
  }
  if (needle.value) {
    const count = matches.value.length;
    const title = `${count} ${count === 1 ? 'match' : 'matches'}`;
    return [{ title, accounts: matches.value }];
  }
  const byOwner = new Map<string, T[]>();
  const sorted = [...matches.value].sort(
    (a, b) => Number(owner(b) === 'Yours') - Number(owner(a) === 'Yours'),
  );
  for (const account of sorted) {
    byOwner.set(owner(account), [
      ...(byOwner.get(owner(account)) ?? []),
      account,
    ]);
  }
  return [...byOwner].map(([title, accounts]) => ({ title, accounts }));
});

function detail(account: T): string {
  return `${owner(account)} · ${TYPE_NAMES[account.type]}`;
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
      <template v-for="group in groups" :key="group.title">
        <h4 v-if="group.accounts.length" class="t-group">{{ group.title }}</h4>
        <button
          v-for="account in group.accounts"
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
      </template>
      <p
        v-if="!matches.length && profileId !== null"
        class="t-sub"
        role="status"
      >
        No account matches “{{ needle }}”. Accounts are added in Accounts.
      </p>
      <p v-else-if="!matches.length" class="t-sub" role="status">
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
