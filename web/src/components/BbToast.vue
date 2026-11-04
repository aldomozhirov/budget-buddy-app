<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import BbIcon from './BbIcon.vue';

/**
 * A short confirmation at the bottom of the page (`.toast`, `role="status"`),
 * such as the thanks after feedback is sent (UI-SET-6). The parent shows it
 * with `v-if` and hides it on `done`.
 */
const props = withDefaults(
  defineProps<{
    /** The confirmation, read out by screen readers. */
    message: string;
    /** How long it stays, in milliseconds. */
    durationMs?: number;
  }>(),
  { durationMs: 4000 },
);

const emit = defineEmits<{
  /** The time is up. */
  done: [];
}>();

let timer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => {
  timer = setTimeout(() => emit('done'), props.durationMs);
});
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div class="toast bb-toast" role="status">
    <BbIcon name="check" :size="18" :stroke-width="2.4" />
    <span class="bb-toast-text">{{ message }}</span>
  </div>
</template>

<style scoped>
/* The page scrolls inside the app shell, so the toast keeps to the bottom
   of the screen rather than of the page. */
.bb-toast {
  position: fixed;
  z-index: 30;
}

.bb-toast-text {
  flex: 1;
}
</style>
