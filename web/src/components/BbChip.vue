<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'choice' | 'small' | 'ghost' | 'suggest' | 'filter' | 'pill';
    selected?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'choice', selected: false, type: 'button' },
);

defineOptions({ inheritAttrs: false });

const classes = {
  choice: 'chip',
  small: 'chip chip-sm',
  ghost: 'chip chip-ghost',
  suggest: 'chip-suggest',
  filter: 'fchip',
  pill: 'pill',
} as const;
</script>

<template>
  <button
    v-bind="$attrs"
    :type="type"
    class="chip-target"
    :role="
      variant === 'choice' || variant === 'small' || variant === 'pill'
        ? 'radio'
        : undefined
    "
    :aria-checked="
      variant === 'choice' || variant === 'small' || variant === 'pill'
        ? selected
        : undefined
    "
    :aria-pressed="variant === 'filter' ? selected : undefined"
  >
    <span
      :class="[
        classes[variant],
        { 'chip-on': selected && (variant === 'choice' || variant === 'small') },
        { 'fchip-on': selected && variant === 'filter' },
        { 'pill-on': selected && variant === 'pill' },
      ]"
    >
      <slot />
    </span>
  </button>
</template>
