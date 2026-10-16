<script setup lang="ts">
import { ref } from 'vue';
import BbButton from '../../components/BbButton.vue';
import BbSheet from '../../components/BbSheet.vue';

/**
 * The note sheet (UI-ADD-6): a text box and "Done", which keeps the note
 * trimmed. Closing without "Done" leaves the note as it was.
 */
const props = defineProps<{
  /** The note now; empty for none. */
  note: string;
}>();

const emit = defineEmits<{
  /** "Done" with the trimmed note. */
  save: [note: string];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const draft = ref(props.note);
</script>

<template>
  <BbSheet title="Note" @close="emit('close')">
    <label for="add-note" class="sr">Note</label>
    <textarea
      id="add-note"
      v-model="draft"
      class="noteinput"
      maxlength="500"
      placeholder="e.g. Birthday cake for Sofia"
    />
    <BbButton @click="emit('save', draft.trim())">Done</BbButton>
  </BbSheet>
</template>
