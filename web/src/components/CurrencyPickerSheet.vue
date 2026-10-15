<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CurrencyOption } from '@budget-buddy/shared';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';

/**
 * Searchable sheet behind a currency chip row's "Other…" (UI-NAV-7): the
 * currencies in use first, then every currency and coin. One pick closes it.
 */
const props = defineProps<{
  /** Every currency and coin the family can choose. */
  options: CurrencyOption[];
  /** Codes in use by the family's accounts and envelopes. */
  inUse: string[];
  /** The code that is selected now. */
  selected: string;
}>();

const emit = defineEmits<{
  /** A currency or coin was picked. */
  pick: [code: string];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const search = ref('');

const matches = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return props.options.filter((option) =>
    `${option.code} ${option.name}`.toLocaleLowerCase().includes(needle),
  );
});
const used = computed(() =>
  matches.value.filter((option) => props.inUse.includes(option.code)),
);
</script>

<template>
  <BbSheet title="Currency or coin" @close="emit('close')">
    <div class="input-wrap">
      <BbIcon name="search" :size="18" />
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Search currencies and coins"
        aria-label="Search currencies and coins"
      />
    </div>
    <div class="picker-list scroll">
      <div v-if="used.length" role="radiogroup" aria-label="In use">
        <h4 class="t-group">In use</h4>
        <button
          v-for="option in used"
          :key="option.code"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="option.code === selected"
          @click="emit('pick', option.code)"
        >
          <span class="picker-name">{{ option.code }} · {{ option.name }}</span>
          <BbIcon v-if="option.code === selected" name="check" :size="18" />
        </button>
      </div>
      <div
        v-if="matches.length"
        role="radiogroup"
        aria-label="All currencies and coins"
      >
        <h4 class="t-group">All currencies and coins</h4>
        <button
          v-for="option in matches"
          :key="option.code"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="option.code === selected"
          @click="emit('pick', option.code)"
        >
          <span class="picker-name">{{ option.code }} · {{ option.name }}</span>
          <BbIcon v-if="option.code === selected" name="check" :size="18" />
        </button>
      </div>
      <p v-else class="t-sub" role="status">Nothing matches.</p>
    </div>
  </BbSheet>
</template>

<style scoped>
.picker-list {
  max-height: 55dvh;
  overflow-y: auto;
}
.picker-name {
  flex: 1;
  font-weight: 500;
}
</style>
