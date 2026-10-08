<script setup lang="ts">
/**
 * Button in the design system's styles. Extra attributes and listeners
 * (e.g. `@click`) go to the native `<button>`. Default slot: button content.
 */
withDefaults(
  defineProps<{
    /** Visual style; `secondary-sm` is the compact secondary. */
    variant?: 'primary' | 'secondary' | 'secondary-sm' | 'danger' | 'text';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
  }>(),
  { variant: 'primary', type: 'button', disabled: false },
);

defineOptions({ inheritAttrs: false });

const classes = {
  primary: 'primary',
  secondary: 'secondary',
  'secondary-sm': 'secondary secondary-sm',
  danger: 'danger',
  text: 'text-btn',
} as const;
</script>

<template>
  <button
    v-bind="$attrs"
    :type="type"
    :disabled="disabled"
    :class="classes[variant]"
  >
    <slot />
  </button>
</template>
