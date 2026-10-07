<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue';
import BbIcon from './BbIcon.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    closeLabel?: string;
    closable?: boolean;
  }>(),
  { closeLabel: 'Close', closable: true },
);

const emit = defineEmits<{
  close: [];
}>();

const dialog = ref<HTMLElement>();
const titleId = `bb-sheet-title-${useId()}`;
let previouslyFocused: HTMLElement | null = null;

function close() {
  if (props.closable) emit('close');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }

  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.value.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const activeElement = document.activeElement;
  if (activeElement === dialog.value) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  dialog.value?.focus();
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  previouslyFocused?.focus();
});
</script>

<template>
  <div class="sheet-layer">
    <div
      class="scrim"
      aria-hidden="true"
      @click="close"
    />
    <section
      ref="dialog"
      class="sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
    >
      <div
        class="sheet-handle"
        aria-hidden="true"
      />
      <header class="sheet-head">
        <h2
          :id="titleId"
          class="t-sheet"
        >
          <slot name="title">
            {{ title }}
          </slot>
        </h2>
        <button
          v-if="closable"
          class="icon-btn"
          type="button"
          :aria-label="closeLabel"
          @click="close"
        >
          <BbIcon name="close" />
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>
