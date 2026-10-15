<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  deleteRuleResponseSchema,
  ruleResponseSchema,
  type Account,
  type Category,
  type CoinSetting,
  type CreateRuleRequest,
  type Envelope,
  type Rule,
  type UpdateRuleRequest,
} from '@budget-buddy/shared';
import AccountPickerSheet from '../../components/AccountPickerSheet.vue';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbConfirmSheet from '../../components/BbConfirmSheet.vue';
import BbSheet from '../../components/BbSheet.vue';
import CategoryPickerSheet from '../../components/CategoryPickerSheet.vue';
import EnvelopePickerSheet from '../../components/EnvelopePickerSheet.vue';
import { callApi, ApiError } from '../../api/callApi.js';
import { chipChoices } from './chipChoices.js';

/**
 * The new and edit rule sheet (UI-CAT-3): "Merchant contains", the category,
 * the envelope and optionally one account. Category, envelope and account
 * are chips of a handful of choices then "All…", which opens the Add form's
 * picker sheet (UI-NAV-7).
 */
const props = defineProps<{
  /** The rule to edit; left out for a new one. */
  rule?: Rule | undefined;
  /** Every category, active and archived. */
  categories: Category[];
  /** Every envelope, active and archived. */
  envelopes: Envelope[];
  /** Every account, so that a rule's account keeps its name. */
  accounts: Account[];
  /** Coins of the family, to write the envelopes' amounts. */
  coins: CoinSetting[];
}>();

const emit = defineEmits<{
  /** The rule was created or changed. */
  saved: [rule: Rule];
  /** The rule was deleted. */
  deleted: [id: number];
  /** The category picker added a category that the list does not have yet. */
  categoryAdded: [category: Category];
  /** Close button, scrim tap, swipe down, or after a change. */
  close: [];
}>();

const editing = props.rule !== undefined;

const pattern = ref(props.rule?.pattern ?? '');
const categoryId = ref(props.rule?.categoryId ?? 0);
const envelopeId = ref(props.rule?.envelopeId ?? 0);
const accountId = ref(props.rule?.accountId ?? 0);
const categorySheet = ref(false);
const envelopeSheet = ref(false);
const accountSheet = ref(false);
const confirmDelete = ref(false);
const saving = ref(false);
const error = ref('');
const patternError = ref('');

const expenseCategories = computed(() =>
  props.categories.filter((category) => category.kind === 'expense'),
);
const activeCategories = computed(() =>
  expenseCategories.value.filter((category) => !category.archived),
);
const activeEnvelopes = computed(() =>
  props.envelopes.filter((envelope) => !envelope.archived),
);
const activeAccounts = computed(() =>
  props.accounts.filter((account) => account.active),
);

/** An archived choice stays in the row while it is the rule's own. */
function keepPicked<T extends { id: number; archived?: boolean }>(
  items: readonly T[],
  pickedId: number,
): T[] {
  return items.filter((item) => !item.archived || item.id === pickedId);
}

const categoryChips = computed(() => {
  const ranked = [
    ...keepPicked(expenseCategories.value, categoryId.value),
  ].sort((a, b) => b.usedThisYear - a.usedThisYear || a.position - b.position);
  return chipChoices(ranked, categoryId.value || null, 3).map((category) => ({
    label: category.name,
    value: category.id,
  }));
});
const envelopeChips = computed(() => [
  { label: 'None', value: 0 },
  ...chipChoices(
    keepPicked(props.envelopes, envelopeId.value),
    envelopeId.value || null,
    3,
  ).map((envelope) => ({ label: envelope.name, value: envelope.id })),
]);
const accountChips = computed(() => [
  { label: 'Any', value: 0 },
  ...chipChoices(
    props.accounts.filter(
      (account) => account.active || account.id === accountId.value,
    ),
    accountId.value || null,
    3,
  ).map((account) => ({ label: account.name, value: account.id })),
]);

const canSave = computed(
  () =>
    pattern.value.trim().length > 0 && categoryId.value > 0 && !saving.value,
);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (editing) return 'Save';
  if (!pattern.value.trim()) return 'Enter the words';
  return categoryId.value ? 'Add rule' : 'Choose a category';
});
const title = computed(() =>
  props.rule ? `Rule ${props.rule.position}` : 'New rule',
);

function messageFor(cause: unknown): string {
  return cause instanceof ApiError
    ? cause.message
    : 'Could not save the rule. Try again.';
}

function pickCategory(category: Category): void {
  // The picker can add a category; the screen reads the list again for it.
  if (!props.categories.some((item) => item.id === category.id)) {
    emit('categoryAdded', category);
  }
  categoryId.value = category.id;
  categorySheet.value = false;
}

function pickEnvelope(envelope: Envelope | null): void {
  envelopeId.value = envelope?.id ?? 0;
  envelopeSheet.value = false;
}

function pickAccount(account: Account | null): void {
  accountId.value = account?.id ?? 0;
  accountSheet.value = false;
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  patternError.value = '';
  try {
    if (props.rule) {
      const before = props.rule;
      const body: UpdateRuleRequest = {};
      if (pattern.value.trim() !== before.pattern) {
        body.pattern = pattern.value.trim();
      }
      if (categoryId.value !== before.categoryId) {
        body.categoryId = categoryId.value;
      }
      if ((envelopeId.value || null) !== before.envelopeId) {
        body.envelopeId = envelopeId.value || null;
      }
      if ((accountId.value || null) !== before.accountId) {
        body.accountId = accountId.value || null;
      }
      if (Object.keys(body).length === 0) {
        emit('close');
        return;
      }
      const { rule } = await callApi(
        'PATCH',
        `/api/rules/${before.id}`,
        ruleResponseSchema,
        body,
      );
      emit('saved', rule);
    } else {
      const body: CreateRuleRequest = {
        pattern: pattern.value.trim(),
        categoryId: categoryId.value,
        envelopeId: envelopeId.value || null,
        accountId: accountId.value || null,
      };
      const { rule } = await callApi(
        'POST',
        '/api/rules',
        ruleResponseSchema,
        body,
      );
      emit('saved', rule);
    }
    emit('close');
  } catch (cause) {
    if (cause instanceof ApiError && cause.fields.pattern) {
      patternError.value = cause.fields.pattern;
    } else {
      error.value = messageFor(cause);
    }
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  if (!props.rule || saving.value) return;
  confirmDelete.value = false;
  saving.value = true;
  error.value = '';
  try {
    await callApi(
      'DELETE',
      `/api/rules/${props.rule.id}`,
      deleteRuleResponseSchema,
    );
    emit('deleted', props.rule.id);
    emit('close');
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BbSheet :title="title" @close="emit('close')">
    <div class="rule-body scroll">
      <div class="rule-field">
        <label class="lbl" for="rule-pattern">Merchant contains</label>
        <input
          id="rule-pattern"
          v-model="pattern"
          class="text"
          type="text"
          autocomplete="off"
          placeholder="e.g. REWE, Penny"
          :aria-invalid="Boolean(patternError)"
        />
        <span v-if="patternError" class="error" role="alert">{{
          patternError
        }}</span>
        <span class="rule-hint"
          >Matches merchant text containing any of these words. Separate with
          commas.</span
        >
      </div>

      <div class="rule-field">
        <span class="lbl">Category</span>
        <BbChipGroup
          v-model="categoryId"
          label="Category"
          :options="categoryChips"
        >
          <template #trailing>
            <BbChip
              variant="ghost"
              aria-haspopup="dialog"
              aria-label="All categories"
              @click="categorySheet = true"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>

      <div class="rule-field">
        <span class="lbl">Envelope</span>
        <BbChipGroup
          v-model="envelopeId"
          label="Envelope"
          :options="envelopeChips"
        >
          <template v-if="activeEnvelopes.length > 3" #trailing>
            <BbChip
              variant="ghost"
              aria-haspopup="dialog"
              aria-label="All envelopes"
              @click="envelopeSheet = true"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>

      <div class="rule-field">
        <span class="lbl">Only for account</span>
        <BbChipGroup
          v-model="accountId"
          label="Only for account"
          :options="accountChips"
        >
          <template v-if="activeAccounts.length > 3" #trailing>
            <BbChip
              variant="ghost"
              aria-haspopup="dialog"
              aria-label="All accounts"
              @click="accountSheet = true"
              >All…</BbChip
            >
          </template>
        </BbChipGroup>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="rule-actions" :class="{ 'rule-actions-two': editing }">
      <BbButton
        v-if="editing"
        variant="secondary"
        class="danger"
        needs-server
        :disabled="saving"
        @click="confirmDelete = true"
        >Delete</BbButton
      >
      <BbButton needs-server :disabled="!canSave" @click="save">{{
        saveLabel
      }}</BbButton>
    </div>
  </BbSheet>

  <CategoryPickerSheet
    v-if="categorySheet"
    :categories="activeCategories"
    :selected-id="categoryId || null"
    @pick="pickCategory"
    @close="categorySheet = false"
  />
  <EnvelopePickerSheet
    v-if="envelopeSheet"
    :envelopes="activeEnvelopes"
    :coins="coins"
    :selected-id="envelopeId || null"
    @pick="pickEnvelope"
    @close="envelopeSheet = false"
  />
  <AccountPickerSheet
    v-if="accountSheet"
    :accounts="activeAccounts"
    :selected-id="accountId || null"
    title="Only for account"
    allow-any
    @pick="pickAccount"
    @close="accountSheet = false"
  />
  <BbConfirmSheet
    v-if="confirmDelete"
    :title="`Delete rule ${rule?.position ?? ''}?`"
    message="Expenses already saved keep their category and envelope."
    confirm-label="Delete"
    cancel-label="Keep it"
    danger
    @confirm="remove"
    @cancel="confirmDelete = false"
  />
</template>

<style scoped>
.rule-body {
  max-height: 60dvh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rule-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* The prototype's sheets wrap their chips instead of scrolling a row. */
.rule-field :deep(.hrow) {
  flex-wrap: wrap;
  overflow-x: visible;
  margin: 0;
  padding: 0;
}
.rule-hint {
  font-size: 12px;
  color: var(--muted);
}
.rule-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 4px;
}
.rule-actions-two {
  grid-template-columns: 1fr 2fr;
}
</style>
