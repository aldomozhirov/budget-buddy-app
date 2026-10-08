<script setup lang="ts">
/** On/off switch, e.g. for a setting in a row; use with `v-model`. */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** Accessible name; the switch shows no text of its own. */
    label: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  /** The switch was toggled; carries the new value. */
  'update:modelValue': [value: boolean];
}>();

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    class="switch-target"
    type="button"
    role="switch"
    :aria-label="label"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="toggle"
  >
    <span
      class="switch"
      aria-hidden="true"
    >
      <span class="knob" />
    </span>
  </button>
</template>
