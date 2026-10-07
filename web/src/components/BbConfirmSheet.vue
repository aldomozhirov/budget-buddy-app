<script setup lang="ts">
import BbButton from './BbButton.vue';
import BbSheet from './BbSheet.vue';

withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
  }>(),
  { cancelLabel: 'Keep it open', danger: false },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <BbSheet
    :title="title"
    @close="emit('cancel')"
  >
    <p class="t-sub sheet-copy">
      {{ message }}
    </p>
    <BbButton
      :variant="danger ? 'secondary' : 'primary'"
      :class="{ danger }"
      @click="emit('confirm')"
    >
      {{ confirmLabel }}
    </BbButton>
    <BbButton
      variant="text"
      class="text-btn"
      @click="emit('cancel')"
    >
      {{ cancelLabel }}
    </BbButton>
  </BbSheet>
</template>
