<script setup lang="ts">
/**
 * Card container that groups rows, fields or other list content.
 * Default slot: card content.
 */
withDefaults(
  defineProps<{
    /** Accessible name for the card; applied only when non-empty. */
    label?: string;
    /**
     * Element to render: `section` with `label` for a named region, `ul` when
     * the slot holds `<li>` items.
     */
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
