<script setup lang="ts">
import BbButton from './BbButton.vue';
import BbSheet from './BbSheet.vue';

/**
 * Bottom sheet that asks the user to confirm an action. Dismissing the sheet
 * counts as cancel; the parent shows it with `v-if` and removes it on either
 * event.
 */
withDefaults(
  defineProps<{
    title: string;
    /** Body text explaining what will happen. */
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    /** Style the confirm button as a destructive action. */
    danger?: boolean;
  }>(),
  { cancelLabel: 'Keep it open', danger: false },
);

const emit = defineEmits<{
  /** The confirm button was pressed. */
  confirm: [];
  /** Cancel was pressed or the sheet was dismissed (scrim, Escape, close). */
  cancel: [];
}>();
</script>

<template>
  <BbSheet
    :title="title"
    @close="emit('cancel')"
  >
    <p class="t-sub sheet-copy">
      {{ message }}
    </p>
    <BbButton
      :variant="danger ? 'secondary' : 'primary'"
      :class="{ danger }"
      @click="emit('confirm')"
    >
      {{ confirmLabel }}
    </BbButton>
    <BbButton
      variant="text"
      class="text-btn"
      @click="emit('cancel')"
    >
      {{ cancelLabel }}
    </BbButton>
  </BbSheet>
</template>
