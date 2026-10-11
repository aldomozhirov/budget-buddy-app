<script setup lang="ts">
import { computed } from 'vue';
import { isOnline } from '../composables/useOnline';

/** On/off switch, e.g. for a setting in a row; use with `v-model`. */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** Accessible name; the switch shows no text of its own. */
    label: string;
    disabled?: boolean;
    /** The switch saves to the server, so it is disabled while offline. */
    needsServer?: boolean;
  }>(),
  { disabled: false, needsServer: false },
);

const blocked = computed(
  () => props.disabled || (props.needsServer && !isOnline.value),
);

const emit = defineEmits<{
  /** The switch was toggled; carries the new value. */
  'update:modelValue': [value: boolean];
}>();

function toggle() {
  if (!blocked.value) emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    class="switch-target"
    type="button"
    role="switch"
    :aria-label="label"
    :aria-checked="modelValue"
    :disabled="blocked"
    @click="toggle"
  >
    <span class="switch" aria-hidden="true">
      <span class="knob" />
    </span>
  </button>
</template>
