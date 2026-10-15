<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  accountsResponseSchema,
  categoriesResponseSchema,
  currenciesResponseSchema,
  envelopesResponseSchema,
  rulesResponseSchema,
  type Account,
  type Category,
  type CoinSetting,
  type Envelope,
  type Rule,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import { isOnline } from '../../composables/useOnline.js';
import { useBack } from '../../composables/useBack.js';
import { callApi, ApiError } from '../../api/callApi.js';
import CategorySheet from './CategorySheet.vue';
import RuleSheet from './RuleSheet.vue';

/**
 * Categories and rules (UI-CAT-1 to UI-CAT-3): the Expense and Income lists,
 * archived ones under "Archived · kept for history", and the ordered rules.
 * `?tab=expense|income|rules` sets the tab the screen opens on.
 */
defineOptions({ name: 'CategoriesScreen' });

type Tab = 'expense' | 'income' | 'rules';
type OpenSheet =
  | { type: 'category'; category?: Category }
  | { type: 'rule'; rule?: Rule }
  | null;

const route = useRoute();
const { label: backLabel, goBack } = useBack();

const tab = ref<Tab>(
  route.query.tab === 'income' || route.query.tab === 'rules'
    ? route.query.tab
    : 'expense',
);
const categories = ref<Category[]>([]);
const rules = ref<Rule[]>([]);
const envelopes = ref<Envelope[]>([]);
const accounts = ref<Account[]>([]);
const coins = ref<CoinSetting[]>([]);
const loading = ref(true);
const error = ref('');
const moveError = ref('');
const moving = ref(false);
const sheet = ref<OpenSheet>(null);

const tabs = computed(() => [
  { value: 'expense' as const, label: 'Expense' },
  { value: 'income' as const, label: 'Income' },
  { value: 'rules' as const, label: `Rules · ${rules.value.length}` },
]);
const categoryName = computed(
  () => new Map(categories.value.map((item) => [item.id, item.name])),
);
const envelopeName = computed(
  () => new Map(envelopes.value.map((item) => [item.id, item.name])),
);
const accountName = computed(
  () => new Map(accounts.value.map((item) => [item.id, item.name])),
);
const shown = computed(() =>
  categories.value.filter((item) => item.kind === tab.value && !item.archived),
);
const archived = computed(() =>
  categories.value.filter((item) => item.kind === tab.value && item.archived),
);
const newLabel = computed(() =>
  tab.value === 'rules' ? 'New rule' : 'New category',
);

onMounted(() => void load(true));

/**
 * Reads everything the tabs and sheets need. A later read keeps what is on
 * the screen (and the open sheet) while it runs.
 */
async function load(first = false): Promise<void> {
  if (first) loading.value = true;
  error.value = '';
  try {
    const [categoryData, ruleData, active, archivedData, accountData, money] =
      await Promise.all([
        callApi('GET', '/api/categories', categoriesResponseSchema),
        callApi('GET', '/api/rules', rulesResponseSchema),
        callApi('GET', '/api/envelopes', envelopesResponseSchema),
        callApi('GET', '/api/envelopes?archived=true', envelopesResponseSchema),
        callApi('GET', '/api/accounts?inactive=true', accountsResponseSchema),
        callApi('GET', '/api/currencies', currenciesResponseSchema),
      ]);
    categories.value = categoryData.categories;
    rules.value = ruleData.rules;
    envelopes.value = [...active.envelopes, ...archivedData.envelopes];
    accounts.value = accountData.accounts;
    coins.value = money.coins;
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the categories. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

function openNew(): void {
  sheet.value = tab.value === 'rules' ? { type: 'rule' } : { type: 'category' };
}

/** "Default envelope: Groceries", or nothing when the category has none. */
function defaultEnvelope(category: Category): string {
  const name =
    category.defaultEnvelopeId === null
      ? undefined
      : envelopeName.value.get(category.defaultEnvelopeId);
  return name ? `Default envelope: ${name}` : '';
}

function uses(category: Category): string {
  return category.used ? `${category.usedThisYear} this year` : 'unused';
}

/** "→ Groceries · Groceries · only Revolut" (CAT-6). */
function target(rule: Rule): string {
  const parts = [categoryName.value.get(rule.categoryId) ?? 'Category'];
  if (rule.categoryArchived) parts[0] += ' (archived)';
  if (rule.envelopeId !== null) {
    const name = envelopeName.value.get(rule.envelopeId) ?? 'Envelope';
    parts.push(rule.envelopeArchived ? `${name} (archived)` : name);
  }
  if (rule.accountId !== null) {
    parts.push(
      `only ${accountName.value.get(rule.accountId) ?? 'one account'}`,
    );
  }
  return `→ ${parts.join(' · ')}`;
}

/** Swaps the rule with the one above it and stores the new order. */
async function moveUp(rule: Rule): Promise<void> {
  const index = rules.value.findIndex((item) => item.id === rule.id);
  if (index < 1 || moving.value) return;
  const ids = rules.value.map((item) => item.id);
  [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
  moving.value = true;
  moveError.value = '';
  try {
    const data = await callApi('PUT', '/api/rules/order', rulesResponseSchema, {
      ids,
    });
    rules.value = data.rules;
  } catch (cause) {
    moveError.value =
      cause instanceof ApiError
        ? cause.message
        : 'Could not move the rule. Try again.';
    if (cause instanceof ApiError && cause.status === 409) await load();
  } finally {
    moving.value = false;
  }
}
</script>

<template>
  <main class="screen app-screen categories-screen">
    <header class="topbar topbar-stack">
      <div class="categories-bar">
        <BbBackButton :label="backLabel" @click="goBack" />
        <h1 class="t-title categories-title">Categories</h1>
        <button
          class="icon-btn icon-btn-ink"
          type="button"
          :aria-label="newLabel"
          aria-haspopup="dialog"
          :disabled="loading || Boolean(error)"
          @click="openNew"
        >
          <BbIcon name="plus" />
        </button>
      </div>
      <div class="segmented" role="tablist" aria-label="Show">
        <button
          v-for="item in tabs"
          :key="item.value"
          class="seg"
          type="button"
          role="tab"
          :aria-selected="tab === item.value"
          @click="tab = item.value"
        >
          {{ item.label }}
        </button>
      </div>
    </header>

    <div class="content app-content categories-content">
      <p v-if="loading" role="status">Loading categories…</p>
      <div v-else-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <button class="text-btn" type="button" @click="load()">
          Try again
        </button>
      </div>

      <template v-else-if="tab !== 'rules'">
        <BbListCard
          v-if="shown.length"
          as="ul"
          class="categories-list"
          :label="`${tab} categories`"
        >
          <li
            v-for="category in shown"
            :key="category.id"
            class="categories-li"
          >
            <BbRow
              interactive
              :title="category.name"
              :subtitle="defaultEnvelope(category)"
              @click="sheet = { type: 'category', category }"
            >
              <template #trailing>
                <span class="num categories-uses">{{ uses(category) }}</span>
                <BbIcon name="forward" :size="16" class="categories-chev" />
              </template>
            </BbRow>
          </li>
        </BbListCard>
        <p v-else class="t-sub">No categories yet.</p>

        <template v-if="archived.length">
          <h2 class="h categories-archived-h">Archived · kept for history</h2>
          <BbListCard
            as="ul"
            class="categories-list"
            label="Archived categories"
          >
            <li
              v-for="category in archived"
              :key="category.id"
              class="categories-li categories-archived"
            >
              <BbRow
                interactive
                :title="category.name"
                @click="sheet = { type: 'category', category }"
              >
                <template #trailing>
                  <span class="num categories-uses">{{ uses(category) }}</span>
                </template>
              </BbRow>
            </li>
          </BbListCard>
        </template>
      </template>

      <template v-else>
        <p class="t-sub categories-intro">
          When a merchant matches, the expense gets this category and envelope.
          The first matching rule wins.
        </p>
        <p v-if="moveError" class="error" role="alert">{{ moveError }}</p>
        <ol
          v-if="rules.length"
          class="card categories-rules"
          aria-label="Rules"
        >
          <li v-for="rule in rules" :key="rule.id" class="categories-rule">
            <span class="num categories-pos">{{ rule.position }}</span>
            <BbRow
              interactive
              class="categories-rule-row"
              @click="sheet = { type: 'rule', rule }"
            >
              <template #title>
                <span class="categories-ellipsis categories-pattern">{{
                  rule.pattern
                }}</span>
                <span class="t-sub categories-ellipsis">{{
                  target(rule)
                }}</span>
              </template>
            </BbRow>
            <button
              class="icon-btn categories-up"
              type="button"
              :aria-label="`Move rule ${rule.position} up`"
              :disabled="rule.position === 1 || moving || !isOnline"
              @click="moveUp(rule)"
            >
              <BbIcon name="up" :size="18" />
            </button>
          </li>
        </ol>
        <p v-else class="t-sub">No rules yet.</p>
      </template>
    </div>

    <CategorySheet
      v-if="sheet?.type === 'category'"
      :category="sheet.category"
      :kind="tab === 'income' ? 'income' : 'expense'"
      :envelopes="envelopes"
      :coins="coins"
      @saved="load()"
      @deleted="load()"
      @close="sheet = null"
    />
    <RuleSheet
      v-if="sheet?.type === 'rule'"
      :rule="sheet.rule"
      :categories="categories"
      :envelopes="envelopes"
      :accounts="accounts"
      :coins="coins"
      @saved="load()"
      @deleted="load()"
      @category-added="load()"
      @close="sheet = null"
    />
  </main>
</template>

<style scoped>
/* The header and tabs stay; only the lists scroll, as in the design. */
.categories-screen {
  height: var(--app-h, 100dvh);
  min-height: 0;
}
.categories-content {
  min-height: 0;
  overflow-y: auto;
}
.topbar-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.categories-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.categories-title {
  flex: 1;
  min-width: 0;
}
.categories-li {
  list-style: none;
}
/* Each row is the last child of its item, so the item draws the divider. */
.categories-li:not(:last-child) {
  border-bottom: 1px solid var(--line);
}
.categories-uses {
  font-size: 13px;
  color: var(--muted);
}
.categories-chev {
  color: var(--muted);
}
.categories-archived {
  opacity: 0.65;
}
.categories-archived-h {
  margin-top: 8px;
}
.categories-content > .categories-intro {
  margin: 0 4px;
}
.categories-list {
  margin: 0;
  list-style: none;
}
.categories-rules {
  margin: 0;
  list-style: none;
  padding: 0 6px 0 14px;
}
.categories-rule {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--line);
}
.categories-rule:last-child {
  border-bottom: 0;
}
.categories-pos {
  width: 20px;
  font-size: 13px;
  color: var(--muted);
}
.categories-rule-row {
  flex: 1;
  min-width: 0;
  border-bottom: 0;
}
.categories-pattern {
  font-weight: 500;
}
.categories-ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.categories-up:disabled {
  opacity: 0.25;
}
</style>
