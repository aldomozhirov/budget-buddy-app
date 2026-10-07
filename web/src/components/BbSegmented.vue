<script setup lang="ts">
import { nextTick, ref } from 'vue';

export interface BbSegmentOption {
  label: string;
  value: string | number;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    options: BbSegmentOption[];
    label: string;
    small?: boolean;
  }>(),
  { small: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

const tablist = ref<HTMLElement>();

function select(option: BbSegmentOption) {
  emit('update:modelValue', option.value);
}

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
