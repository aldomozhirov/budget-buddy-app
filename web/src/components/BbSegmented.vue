<script setup lang="ts">
import { nextTick, ref } from 'vue';

/** One segment of a BbSegmented control. */
export interface BbSegmentOption {
  label: string;
  /** Emitted on selection; must be unique within the control (used as key). */
  value: string | number;
}

/**
 * Segmented control for switching between a few options; use with `v-model`.
 * Exposed as a tab list; only the selected segment is in the tab order.
 */
const props = withDefaults(
  defineProps<{
    /** Value of the selected option. */
    modelValue: string | number;
    options: BbSegmentOption[];
    /** Accessible name of the tab list; not shown on screen. */
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

const tablist = ref<HTMLElement>();

function select(option: BbSegmentOption) {
  emit('update:modelValue', option.value);
}

/**
 * Moves selection with Left/Right (wrapping), Home and End, following the
 * WAI-ARIA tabs pattern with automatic activation.
 */
function onKeydown(event: KeyboardEvent) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (props.options.length === 0) return;

  const currentIndex = props.options.findIndex(
    (option) => option.value === props.modelValue,
  );
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.options.length - 1
        : event.key === 'ArrowRight'
          ? (Math.max(currentIndex, 0) + 1) % props.options.length
          : (Math.max(currentIndex, 0) - 1 + props.options.length) %
            props.options.length;
  const option = props.options[index];
  if (!option) return;
  select(option);
  // Focus after the re-render, once the new segment is the tab stop.
  void nextTick(() => {
    tablist.value
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(index)
      ?.focus();
  });
}
</script>

<template>
  <div
    ref="tablist"
    class="segmented"
    :class="{ 'segmented-sm': small }"
    role="tablist"
    :aria-label="label"
    @keydown="onKeydown"
  >
    <button
      v-for="option in options"
      :key="option.value"
      class="seg-target"
      type="button"
      role="tab"
      :aria-selected="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      @click="select(option)"
    >
      <span
        class="seg"
        :class="{ 'seg-on': option.value === modelValue }"
      >
        {{ option.label }}
      </span>
    </button>
  </div>
</template>
