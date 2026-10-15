<script setup lang="ts">
import { computed, ref } from 'vue';
import { categoryResponseSchema, type Category } from '@budget-buddy/shared';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';
import { isOnline } from '../composables/useOnline.js';
import { callApi, ApiError } from '../api/callApi.js';

/**
 * Searchable sheet behind a category chip row's "All…" (UI-NAV-7): the most
 * used categories first, then all of them; a name that matches none offers
 * "Add category “…”". One pick closes it.
 */
const props = defineProps<{
  /** The active expense categories, in the family's order. */
  categories: Category[];
  /** The id that is selected now, if any. */
  selectedId: number | null;
}>();

const emit = defineEmits<{
  /** A category was picked, or added and picked. */
  pick: [category: Category];
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
const mostUsed = computed(() =>
  matches.value
    .filter((category) => category.usedThisYear > 0)
    .sort((a, b) => b.usedThisYear - a.usedThisYear)
    .slice(0, 3),
);
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
      { name: needle.value, kind: 'expense' },
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
      <div v-if="mostUsed.length" role="radiogroup" aria-label="Most used">
        <h4 class="t-group">Most used</h4>
        <button
          v-for="category in mostUsed"
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
