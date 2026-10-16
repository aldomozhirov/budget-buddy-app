<script setup lang="ts">
import { nextTick, ref } from 'vue';

/** One segment of a BbSegmented control. */
export interface BbSegmentOption {
  label: string;
  /** Emitted on selection; must be unique within the control (used as key). */
  value: string | number;
  /** Shown but not selectable, e.g. a kind that is not built yet. */
  disabled?: boolean;
}

/**
 * Segmented control for picking one of a few options; use with `v-model`.
 * Exposed as a radio group; only the selected segment, or the first if none
 * matches, is in the tab order.
 */
const props = withDefaults(
  defineProps<{
    /** Value of the selected option. */
    modelValue: string | number;
    options: BbSegmentOption[];
    /** Accessible name of the radio group; not shown on screen. */
    label: string;
    /** Use the compact size. */
    small?: boolean;
  }>(),
  { small: false },
);

const emit = defineEmits<{
  /** A segment was clicked or the selection moved by keyboard. */
  'update:modelValue': [value: string | number];
}>();

const radioGroup = ref<HTMLElement>();

function select(option: BbSegmentOption) {
  emit('update:modelValue', option.value);
}

/** Whether the option is the keyboard tab stop. */
function isTabStop(option: BbSegmentOption, index: number) {
  if (props.options.some((item) => item.value === props.modelValue)) {
    return option.value === props.modelValue;
  }
  return index === 0;
}

/**
 * Moves selection with the arrow keys (wrapping), Home and End, following
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
  const count = props.options.length;
  const step =
    event.key === 'ArrowRight' ||
    event.key === 'ArrowDown' ||
    event.key === 'Home'
      ? 1
      : -1;
  let index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? count - 1
        : (Math.max(currentIndex, 0) + step + count) % count;
  // Skip disabled segments; stay put when every other one is disabled.
  for (
    let tries = 0;
    props.options[index]?.disabled && tries < count;
    tries++
  ) {
    index = (index + step + count) % count;
  }
  const option = props.options[index];
  if (!option) return;
  select(option);
  // Focus after the re-render, once the new segment is the tab stop.
  void nextTick(() => {
    radioGroup.value
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      .item(index)
      ?.focus();
  });
}
</script>

<template>
  <div
    ref="radioGroup"
    class="segmented"
    :class="{ 'segmented-sm': small }"
    role="radiogroup"
    :aria-label="label"
    @keydown="onKeydown"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      class="seg-target"
      type="button"
      role="radio"
      :aria-checked="option.value === modelValue"
      :tabindex="isTabStop(option, index) ? 0 : -1"
      :disabled="option.disabled"
      @click="select(option)"
    >
      <span class="seg" :class="{ 'seg-on': option.value === modelValue }">
        {{ option.label }}
      </span>
    </button>
  </div>
</template>
