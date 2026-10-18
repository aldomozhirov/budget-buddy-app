<script setup lang="ts">
import BbButton from '../../components/BbButton.vue';
import BbSheet from '../../components/BbSheet.vue';
import { outbox } from '../../offline/outbox.js';
import { unsentQuestion } from '../transactions/outboxRows.js';

/**
 * "Sign out?" while items have not been sent (UI-HOME-8): how many sign-out
 * deletes from the phone, "Sign out anyway" and "Keep me signed in".
 */
defineProps<{
  /** A sign-out is under way. */
  busy: boolean;
}>();

const emit = defineEmits<{
  /** "Sign out anyway" was pressed. */
  confirm: [];
  /** "Keep me signed in", the close button or a dismissal. */
  cancel: [];
}>();
</script>

<template>
  <BbSheet title="Sign out?" @close="emit('cancel')">
    <p class="t-sub sign-out-unsent">
      {{ unsentQuestion(outbox.items.value) }}
    </p>
    <BbButton class="sign-out-anyway" :disabled="busy" @click="emit('confirm')">
      Sign out anyway
    </BbButton>
    <BbButton variant="secondary" class="sign-out-keep" @click="emit('cancel')">
      Keep me signed in
    </BbButton>
  </BbSheet>
</template>

<style scoped>
.sign-out-unsent {
  margin: 0 0 10px;
  font-size: 15px;
}
.bb .sign-out-anyway {
  background: var(--warn);
  color: var(--surface);
}
.bb .sign-out-keep {
  background: var(--bg);
}
</style>
