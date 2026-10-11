<script setup lang="ts">
import { isOnline } from '../composables/useOnline';

/**
 * Button in the design system's styles. Extra attributes and listeners
 * (e.g. `@click`) go to the native `<button>`. Default slot: button content.
 */
const props = withDefaults(
  defineProps<{
    /** Visual style; `secondary-sm` is the compact secondary. */
    variant?: 'primary' | 'secondary' | 'secondary-sm' | 'danger' | 'text';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    /** The action calls the server, so it is disabled while offline (IOS-6). */
    needsServer?: boolean;
  }>(),
  { variant: 'primary', type: 'button', disabled: false, needsServer: false },
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
    :disabled="props.disabled || (props.needsServer && !isOnline)"
    :class="classes[variant]"
  >
    <slot />
  </button>
</template>
