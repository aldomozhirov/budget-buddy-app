<script setup lang="ts">
import { computed } from 'vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import type { SheetOption } from './transactionsFormat.js';

/**
 * The sheet of one filter chip (UI-TXN-1, `TransactionsFilter`): the options
 * with their counts, "Reset" and "Show N transactions". A pick applies at
 * once, so the list behind the sheet is already the one the button names.
 */
const props = defineProps<{
  /** The sheet's title, such as "Category". */
  title: string;
  /** The line under the title: "Pick any. None picked shows all." */
  hint: string;
  options: readonly SheetOption[];
  /** Pick one (a period) instead of any. */
  single?: boolean;
  /** What "Show" counts: the transactions the filters now match. */
  count: number | null;
  /** The options' counts are still on their way. */
  loading: boolean;
}>();

const emit = defineEmits<{
  /** An option was tapped. */
  toggle: [value: string];
  /** "Reset": none picked again (this month, for the period). */
  reset: [];
  close: [];
}>();

const groups = computed(() => {
  const result: { name: string; options: SheetOption[] }[] = [];
  for (const option of props.options) {
    const name = option.group ?? '';
    const last = result.at(-1);
    if (last && last.name === name) last.options.push(option);
    else result.push({ name, options: [option] });
  }
  return result;
});

const showText = computed(() =>
  props.count === null
    ? 'Show transactions'
    : `Show ${props.count} ${props.count === 1 ? 'transaction' : 'transactions'}`,
);
</script>

<template>
  <BbSheet :title="title" @close="emit('close')">
    <template #title>
      {{ title }}<span class="t-sub filter-hint">{{ hint }}</span>
    </template>
    <div
      class="filter-list scroll"
      :role="single ? 'radiogroup' : 'group'"
      :aria-label="title"
      :aria-busy="loading"
    >
      <template v-for="group in groups" :key="group.name">
        <h4 v-if="group.name" class="t-group">{{ group.name }}</h4>
        <button
          v-for="option in group.options"
          :key="option.value"
          class="opt"
          type="button"
          :role="single ? 'radio' : 'checkbox'"
          :aria-checked="option.selected"
          @click="emit('toggle', option.value)"
        >
          <span class="box" :class="{ 'box-radio': single }">
            <BbIcon v-if="option.selected" name="check" :size="14" />
          </span>
          <span class="filter-label">
            <span class="filter-name">{{ option.label }}</span>
            <span v-if="option.sub" class="t-sub">{{ option.sub }}</span>
          </span>
          <span class="num t-sub">{{ loading ? '' : option.count }}</span>
        </button>
      </template>
    </div>
    <div class="filter-actions">
      <button class="secondary" type="button" @click="emit('reset')">
        Reset
      </button>
      <button class="primary num" type="button" @click="emit('close')">
        {{ showText }}
      </button>
    </div>
  </BbSheet>
</template>

<style scoped>
.filter-hint {
  display: block;
  font-size: 13px;
  font-weight: 400;
}
.filter-list {
  max-height: 55dvh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.filter-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.filter-name {
  font-weight: 500;
}
.filter-actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
  padding-top: 6px;
}
.filter-actions .secondary {
  background: var(--bg);
}
</style>
