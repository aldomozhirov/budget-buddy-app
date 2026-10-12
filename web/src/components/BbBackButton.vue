<script setup lang="ts">
import BbIcon from './BbIcon.vue';

/**
 * Icon-only back button for the top bar. Navigation is up to the parent:
 * listen for `click`, which falls through to the native button.
 */
defineProps<{
  /** Accessible name, e.g. "Back to home"; the button shows no text. */
  label: string;
}>();
</script>

<template>
  <button
    class="icon-btn"
    type="button"
    :aria-label="label"
  >
    <BbIcon name="back" />
  </button>
</template>
