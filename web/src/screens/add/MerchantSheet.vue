<script setup lang="ts">
import { computed, ref } from 'vue';
import { merchantKey, type KnownMerchant } from '@budget-buddy/shared';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';

/** A known merchant with what its rule would fill in, if any. */
export interface MerchantOption extends KnownMerchant {
  /** "Rule: Groceries", or "Used before" without a rule. */
  detail: string;
}

/**
 * The merchant sheet (UI-ADD-3): the family's recent merchants with what
 * their rule fills in, a search, "Use “…”" for a new one and "No merchant"
 * to clear it. One pick closes it.
 */
const props = defineProps<{
  /** Known merchants, most recently used first. */
  merchants: MerchantOption[];
  /** The merchant on the form; empty for none. */
  selected: string;
}>();

const emit = defineEmits<{
  /** A merchant was picked or typed; empty to clear it. */
  pick: [merchant: string];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const RECENT_COUNT = 6;

const search = ref('');
const needle = computed(() => search.value.trim().replace(/\s+/gu, ' '));
const words = computed(() =>
  merchantKey(needle.value).split(' ').filter(Boolean),
);
const matches = computed(() =>
  props.merchants.filter((merchant) =>
    words.value.every((word) => merchant.key.includes(word)),
  ),
);
const shown = computed(() =>
  needle.value ? matches.value : props.merchants.slice(0, RECENT_COUNT),
);
const heading = computed(() => {
  if (!needle.value) return 'Recent';
  const count = matches.value.length;
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
});
const canUse = computed(
  () =>
    needle.value.length > 0 &&
    !props.merchants.some(
      (merchant) => merchant.key === merchantKey(needle.value),
    ),
);
</script>

<template>
  <BbSheet title="Merchant" @close="emit('close')">
    <div class="input-wrap">
      <BbIcon name="search" :size="18" />
      <input
        v-model="search"
        class="search"
        type="search"
        autocomplete="off"
        maxlength="120"
        placeholder="Search or type a merchant"
        aria-label="Search or type a merchant"
      />
    </div>
    <div class="picker-list scroll">
      <button
        v-if="selected && !needle"
        class="opt"
        type="button"
        @click="emit('pick', '')"
      >
        <span class="picker-name">No merchant</span>
      </button>
      <div v-if="shown.length" role="radiogroup" :aria-label="heading">
        <h4 class="t-group">{{ heading }}</h4>
        <button
          v-for="merchant in shown"
          :key="merchant.key"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="merchant.merchant === selected"
          @click="emit('pick', merchant.merchant)"
        >
          <span class="picker-text">
            <span class="picker-name">{{ merchant.merchant }}</span>
            <span class="t-sub">{{ merchant.detail }}</span>
          </span>
          <BbIcon
            v-if="merchant.merchant === selected"
            name="check"
            :size="18"
          />
        </button>
      </div>
      <button
        v-if="canUse"
        class="opt picker-add"
        type="button"
        @click="emit('pick', needle)"
      >
        <BbIcon name="plus" :size="18" />
        <span class="picker-name">Use “{{ needle }}”</span>
      </button>
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
  flex: 1;
  font-weight: 500;
}
.picker-add {
  color: var(--accent);
  border-bottom: 0;
}
.picker-add .picker-name {
  font-weight: 600;
}
</style>
