<script setup lang="ts">
import { nextTick, ref } from 'vue';
import BbChip from './BbChip.vue';

/** One choice in a BbChipGroup. */
export interface BbChipOption {
  label: string;
  /** Emitted on selection; must be unique within the group (used as key). */
  value: string | number;
}

/**
 * Single-select row of chips that works as a radio group; use with `v-model`.
 * Only the selected chip, or the first if none matches, is in the tab order.
 */
const props = withDefaults(
  defineProps<{
    /** Value of the selected option. */
    modelValue: string | number;
    options: BbChipOption[];
    /** Accessible name of the radio group; not shown on screen. */
    label: string;
    /** Chip style for every option; see BbChip. */
    variant?: 'choice' | 'small' | 'pill';
  }>(),
  { variant: 'choice' },
);

const emit = defineEmits<{
  /** A chip was clicked or the selection moved by keyboard. */
  'update:modelValue': [value: string | number];
}>();

const radioGroup = ref<HTMLElement>();

function select(index: number) {
  const option = props.options[index];
  if (!option) return;
  emit('update:modelValue', option.value);
}

/**
 * Moves selection with arrow/Home/End keys, wrapping at the ends, following
 * the WAI-ARIA radio group pattern.
 */
function onKeydown(event: KeyboardEvent) {
  if (
    ![
      'ArrowRight',
      'ArrowDown',
      'ArrowLeft',
      'ArrowUp',
      'Home',
      'End',
    ].includes(event.key)
  )
    return;
  event.preventDefault();
  if (props.options.length === 0) return;

  const currentIndex = props.options.findIndex(
    (option) => option.value === props.modelValue,
  );
  let nextIndex = currentIndex < 0 ? 0 : currentIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = props.options.length - 1;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (nextIndex + 1) % props.options.length;
  } else {
    nextIndex = (nextIndex - 1 + props.options.length) % props.options.length;
  }

  select(nextIndex);
  // Focus after the re-render, once the new chip is the tab stop.
  void nextTick(() => {
    radioGroup.value
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      .item(nextIndex)
      ?.focus();
  });
}
</script>

<template>
  <div
    ref="radioGroup"
    class="hrow"
    role="radiogroup"
    :aria-label="label"
    @keydown="onKeydown"
  >
    <BbChip
      v-for="(option, index) in options"
      :key="option.value"
      :variant="variant"
      :selected="option.value === modelValue"
      :tabindex="
        option.value === modelValue ||
          (!options.some((item) => item.value === modelValue) && index === 0)
          ? 0
          : -1
      "
      @click="select(index)"
    >
      {{ option.label }}
    </BbChip>
  </div>
</template>
