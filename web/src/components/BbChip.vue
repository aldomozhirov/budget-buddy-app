<script setup lang="ts">
import { computed, inject } from 'vue';
import { inChipGroupKey } from './chipGroup';

/**
 * Single chip button. Extra attributes and listeners (e.g. `@click`) go to
 * the native `<button>`. Default slot: chip content.
 */
const props = withDefaults(
  defineProps<{
    /**
     * Style and semantics: `choice`, `small` and `pill` are radio buttons
     * inside BbChipGroup and toggle buttons on their own, `filter` is a
     * toggle button, `suggest` and `ghost` are plain buttons.
     */
    variant?: 'choice' | 'small' | 'ghost' | 'suggest' | 'filter' | 'pill';
    /** Checked or pressed; unused for `suggest` and `ghost`. */
    selected?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'choice', selected: false, type: 'button' },
);

defineOptions({ inheritAttrs: false });

const inGroup = inject(inChipGroupKey, false);
const isChoice = computed(
  () =>
    props.variant === 'choice' ||
    props.variant === 'small' ||
    props.variant === 'pill',
);
/** A radio inside BbChipGroup; ARIA doesn't allow a radio on its own. */
const isRadio = computed(() => isChoice.value && inGroup);
/** Stand-alone choice chips and filters report their state as pressed. */
const isToggle = computed(
  () => props.variant === 'filter' || (isChoice.value && !inGroup),
);

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
    :role="isRadio ? 'radio' : undefined"
    :aria-checked="isRadio ? selected : undefined"
    :aria-pressed="isToggle ? selected : undefined"
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
