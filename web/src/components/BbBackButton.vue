<script setup lang="ts">
import BbIcon from './BbIcon.vue';

defineProps<{
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
