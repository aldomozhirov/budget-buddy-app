<script
  setup
  lang="ts"
  generic="T extends Pick<Category, 'id' | 'name'> & { usedThisYear?: number }"
>
import { computed, ref } from 'vue';
import { categoryResponseSchema, type Category } from '@budget-buddy/shared';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';
import { isOnline } from '../composables/useOnline.js';
import { callApi, ApiError } from '../api/callApi.js';

/**
 * Searchable sheet behind a category chip row's "All…" (UI-NAV-7): a short
 * group first, then all categories; a name that matches none offers
 * "Add category “…”". The short group is "Recent" when `recentIds` is
 * given (Add expense), else the three most used this year. One pick closes
 * it.
 */
const props = withDefaults(
  defineProps<{
    /** The active categories of one kind, in the family's order. */
    categories: T[];
    /** The id that is selected now, if any. */
    selectedId: number | null;
    /** Ids for the "Recent" group, in order; replaces "Most used". */
    recentIds?: number[] | null;
    /** Kind of a category added here. */
    kind?: Category['kind'];
  }>(),
  { recentIds: null, kind: 'expense' },
);

const emit = defineEmits<{
  /** A category was picked, or added and picked. */
  pick: [category: T | Category];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const search = ref('');
const error = ref('');
const adding = ref(false);

const needle = computed(() => search.value.trim());
const matches = computed(() =>
  props.categories.filter((category) =>
    category.name
      .toLocaleLowerCase()
      .includes(needle.value.toLocaleLowerCase()),
  ),
);
const shortTitle = computed(() =>
  props.recentIds === null ? 'Most used' : 'Recent',
);
const shortList = computed(() => {
  const recent = props.recentIds;
  if (recent !== null) {
    return recent
      .map((id) => matches.value.find((category) => category.id === id))
      .filter((category): category is T => category !== undefined);
  }
  return matches.value
    .filter((category) => (category.usedThisYear ?? 0) > 0)
    .sort((a, b) => (b.usedThisYear ?? 0) - (a.usedThisYear ?? 0))
    .slice(0, 3);
});
const canAdd = computed(
  () =>
    needle.value.length > 0 &&
    !props.categories.some(
      (category) =>
        category.name.toLocaleLowerCase() === needle.value.toLocaleLowerCase(),
    ),
);

async function addCategory(): Promise<void> {
  if (adding.value) return;
  adding.value = true;
  error.value = '';
  try {
    const { category } = await callApi(
      'POST',
      '/api/categories',
      categoryResponseSchema,
      { name: needle.value, kind: props.kind },
    );
    emit('pick', category);
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? (cause.fields.name ?? cause.message)
        : 'Could not add the category. Try again.';
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <BbSheet title="Category" @close="emit('close')">
    <div class="input-wrap">
      <BbIcon name="search" :size="18" />
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Search or add a category"
        aria-label="Search or add a category"
      />
    </div>
    <div class="picker-list scroll">
      <button
        v-if="canAdd"
        class="opt"
        type="button"
        :disabled="adding || !isOnline"
        @click="addCategory"
      >
        <BbIcon name="plus" :size="18" />
        <span class="picker-name">Add category “{{ needle }}”</span>
      </button>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="shortList.length" role="radiogroup" :aria-label="shortTitle">
        <h4 class="t-group">{{ shortTitle }}</h4>
        <button
          v-for="category in shortList"
          :key="category.id"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="category.id === selectedId"
          @click="emit('pick', category)"
        >
          <span class="picker-name">{{ category.name }}</span>
          <BbIcon v-if="category.id === selectedId" name="check" :size="18" />
        </button>
      </div>
      <div v-if="matches.length" role="radiogroup" aria-label="All categories">
        <h4 class="t-group">All categories</h4>
        <button
          v-for="category in matches"
          :key="category.id"
          class="opt"
          type="button"
          role="radio"
          :aria-checked="category.id === selectedId"
          @click="emit('pick', category)"
        >
          <span class="picker-name">{{ category.name }}</span>
          <BbIcon v-if="category.id === selectedId" name="check" :size="18" />
        </button>
      </div>
      <p v-else-if="!canAdd" class="t-sub" role="status">No categories yet.</p>
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
