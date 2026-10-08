<script setup lang="ts">
/**
 * Small inline label, e.g. "Stale" next to an amount.
 * Default slot: tag text.
 */
withDefaults(
  defineProps<{
    /** `warn` flags a problem, e.g. a stale balance. */
    tone?: 'neutral' | 'warn';
    /** Alternative style for mode labels such as "Resets monthly". */
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
