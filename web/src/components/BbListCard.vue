<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    as?: 'div' | 'section' | 'ul';
  }>(),
  { label: '', as: 'div' },
);

defineOptions({ inheritAttrs: false });
</script>

<template>
  <component
    :is="as"
    v-bind="$attrs"
    class="card"
    :aria-label="label || undefined"
  >
    <slot />
  </component>
</template>
