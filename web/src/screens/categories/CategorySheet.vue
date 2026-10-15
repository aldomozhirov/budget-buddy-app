<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  categoryResponseSchema,
  deleteCategoryResponseSchema,
  type Category,
  type CoinSetting,
  type CreateCategoryRequest,
  type Envelope,
  type UpdateCategoryRequest,
} from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbConfirmSheet from '../../components/BbConfirmSheet.vue';
import BbSheet from '../../components/BbSheet.vue';
import EnvelopePickerSheet from '../../components/EnvelopePickerSheet.vue';
import { callApi, ApiError } from '../../api/callApi.js';
import { chipChoices } from './chipChoices.js';

/**
 * The new and edit category sheet (UI-CAT-2): the name, the default envelope
 * of an expense category, and Delete, Archive or Restore with their hints.
 */
const props = defineProps<{
  /** The category to edit; left out for a new one. */
  category?: Category | undefined;
  /** The kind of a new category. */
  kind: 'expense' | 'income';
  /** Every envelope, active and archived, so a default keeps its name. */
  envelopes: Envelope[];
  /** Coins of the family, to write the envelopes' amounts. */
  coins: CoinSetting[];
}>();

const emit = defineEmits<{
  /** The category was created or changed. */
  saved: [category: Category];
  /** An unused category was deleted, with the rules that named it. */
  deleted: [id: number];
  /** Close button, scrim tap, swipe down, or after a change. */
  close: [];
}>();

const editing = props.category !== undefined;
const isExpense = (props.category?.kind ?? props.kind) === 'expense';
const archivedNow = props.category?.archived === true;

const name = ref(props.category?.name ?? '');
const envelopeId = ref(props.category?.defaultEnvelopeId ?? 0);
const envelopeSheet = ref(false);
const confirmDelete = ref(false);
const saving = ref(false);
const error = ref('');
const nameError = ref('');

const activeEnvelopes = computed(() =>
  props.envelopes.filter((envelope) => !envelope.archived),
);
const envelopeChips = computed(() => [
  { label: 'None', value: 0 },
  ...chipChoices(
    // An archived default stays visible so that the row shows what is saved.
    props.envelopes.filter(
      (envelope) => !envelope.archived || envelope.id === envelopeId.value,
    ),
    envelopeId.value || null,
    3,
  ).map((envelope) => ({ label: envelope.name, value: envelope.id })),
]);
const canSave = computed(() => name.value.trim().length > 0 && !saving.value);
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…';
  if (editing) return 'Save';
  return name.value.trim() ? 'Add category' : 'Name the category';
});
const title = computed(() => {
  if (editing) return 'Edit category';
  return isExpense ? 'New category' : 'New income category';
});
const secondary = computed(() => {
  if (!props.category) return null;
  if (archivedNow) return { label: 'Restore', hint: '' };
  if (!props.category.used) {
    return { label: 'Delete', hint: 'Unused, so it can be deleted.' };
  }
  const count = props.category.usedThisYear;
  const has =
    count > 0
      ? `${count} ${count === 1 ? 'transaction' : 'transactions'} this year`
      : 'transactions';
  return {
    label: 'Archive',
    hint: `It has ${has}, so it can only be archived. ${
      count === 1 ? 'It keeps' : 'They keep'
    } this category.`,
  };
});
const deleteMessage = computed(() => {
  const rules = props.category?.ruleCount ?? 0;
  if (rules === 0) return 'It has no transactions.';
  return `It has no transactions. ${
    rules === 1 ? '1 rule that names it is' : `${rules} rules that name it are`
  } deleted too.`;
});

function messageFor(cause: unknown): string {
  return cause instanceof ApiError
    ? cause.message
    : 'Could not save the category. Try again.';
}

function pickEnvelope(envelope: Envelope | null): void {
  envelopeId.value = envelope?.id ?? 0;
  envelopeSheet.value = false;
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  nameError.value = '';
  try {
    if (props.category) {
      const before = props.category;
      const body: UpdateCategoryRequest = {};
      if (name.value.trim() !== before.name) body.name = name.value.trim();
      if (
        isExpense &&
        (envelopeId.value || null) !== before.defaultEnvelopeId
      ) {
        body.defaultEnvelopeId = envelopeId.value || null;
      }
      if (Object.keys(body).length === 0) {
        emit('close');
        return;
      }
      const { category } = await callApi(
        'PATCH',
        `/api/categories/${before.id}`,
        categoryResponseSchema,
        body,
      );
      emit('saved', category);
    } else {
      const body: CreateCategoryRequest = {
        name: name.value.trim(),
        kind: props.kind,
        ...(isExpense && envelopeId.value
          ? { defaultEnvelopeId: envelopeId.value }
          : {}),
      };
      const { category } = await callApi(
        'POST',
        '/api/categories',
        categoryResponseSchema,
        body,
      );
      emit('saved', category);
    }
    emit('close');
  } catch (cause) {
    if (cause instanceof ApiError && cause.fields.name) {
      nameError.value = cause.fields.name;
    } else {
      error.value = messageFor(cause);
    }
  } finally {
    saving.value = false;
  }
}

/** Archives or restores the category at once; Delete asks first. */
async function secondaryAction(): Promise<void> {
  if (!props.category || saving.value) return;
  if (secondary.value?.label === 'Delete') {
    confirmDelete.value = true;
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const { category } = await callApi(
      'PATCH',
      `/api/categories/${props.category.id}`,
      categoryResponseSchema,
      { archived: !archivedNow },
    );
    emit('saved', category);
    emit('close');
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  if (!props.category || saving.value) return;
  confirmDelete.value = false;
  saving.value = true;
  error.value = '';
  try {
    await callApi(
      'DELETE',
      `/api/categories/${props.category.id}`,
      deleteCategoryResponseSchema,
    );
    emit('deleted', props.category.id);
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
    <div class="sheet-body">
      <div class="sheet-field">
        <label class="lbl" for="category-name">Name</label>
        <input
          id="category-name"
          v-model="name"
          class="text"
          type="text"
          autocomplete="off"
          placeholder="e.g. Pets"
          :aria-invalid="Boolean(nameError)"
        />
        <span v-if="nameError" class="error" role="alert">{{ nameError }}</span>
      </div>

      <div v-if="isExpense" class="sheet-field">
        <span class="lbl"
          >Default envelope · used on save when an expense has none</span
        >
        <BbChipGroup
          v-model="envelopeId"
          label="Default envelope"
          wrap
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

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="sheet-actions" :class="{ 'sheet-actions-two': secondary }">
        <BbButton
          v-if="secondary"
          variant="secondary"
          needs-server
          :class="{ danger: secondary.label === 'Delete' }"
          :disabled="saving"
          @click="secondaryAction"
          >{{ secondary.label }}</BbButton
        >
        <BbButton needs-server :disabled="!canSave" @click="save">{{
          saveLabel
        }}</BbButton>
      </div>
      <span v-if="secondary?.hint" class="sheet-hint">{{
        secondary.hint
      }}</span>
    </div>
  </BbSheet>

  <EnvelopePickerSheet
    v-if="envelopeSheet"
    :envelopes="activeEnvelopes"
    :coins="coins"
    :selected-id="envelopeId || null"
    @pick="pickEnvelope"
    @close="envelopeSheet = false"
  />
  <BbConfirmSheet
    v-if="confirmDelete"
    :title="`Delete ${category?.name ?? 'category'}?`"
    :message="deleteMessage"
    confirm-label="Delete"
    cancel-label="Keep it"
    danger
    @confirm="remove"
    @cancel="confirmDelete = false"
  />
</template>

<style scoped>
.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sheet-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sheet-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 4px;
}
.sheet-actions-two {
  grid-template-columns: 1fr 2fr;
}
.sheet-hint {
  margin-top: -6px;
  font-size: 13px;
  color: var(--muted);
}
</style>
