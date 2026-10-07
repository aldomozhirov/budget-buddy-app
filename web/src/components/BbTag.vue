<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'warn';
    mode?: boolean;
  }>(),
  { tone: 'neutral', mode: false },
);

defineOptions({ inheritAttrs: false });
</script>

<template>
  <span
    v-bind="$attrs"
    class="tag"
    :class="{ 'tag-warn': tone === 'warn', 'tag-mode': mode }"
  >
    <slot />
  </span>
</template>
