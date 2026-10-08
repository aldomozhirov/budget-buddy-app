<script setup lang="ts">
/**
 * Single chip button. Extra attributes and listeners (e.g. `@click`) go to
 * the native `<button>`. Default slot: chip content.
 */
withDefaults(
  defineProps<{
    /**
     * Style and semantics: `choice`, `small` and `pill` are radio buttons
     * (place them in a radiogroup, e.g. BbChipGroup), `filter` is a toggle
     * button, `suggest` and `ghost` are plain buttons.
     */
    variant?: 'choice' | 'small' | 'ghost' | 'suggest' | 'filter' | 'pill';
    /** Checked (radio variants) or pressed (`filter`); unused otherwise. */
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
