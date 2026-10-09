<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue';
import BbIcon from './BbIcon.vue';
import {
  isTopSheet,
  registerSheet,
  unregisterSheet,
} from './sheetStack.js';

/**
 * Modal bottom sheet with a title, close button and focus trap; the parent
 * shows it with `v-if`. Default slot: sheet body. `title` slot: heading.
 */
const props = withDefaults(
  defineProps<{
    /** Heading text, also the dialog's accessible name. */
    title: string;
    /** Accessible name of the close button. */
    closeLabel?: string;
    /** When false, hides the close button and ignores Escape and scrim taps. */
    closable?: boolean;
  }>(),
  { closeLabel: 'Close', closable: true },
);

const emit = defineEmits<{
  /** Close button, scrim tap or Escape, only while `closable`. */
  close: [];
}>();

const dialog = ref<HTMLElement>();
const titleId = `bb-sheet-title-${useId()}`;
const layer = ref<HTMLElement>();
/** Element to refocus when the sheet unmounts. */
let previouslyFocused: HTMLElement | null = null;
/** Elements this sheet made inert, restored when it unmounts. */
let inertElements: HTMLElement[] = [];
/** Identifies this sheet in `openSheets`. */
const sheetToken = {};
registerSheet(sheetToken);

function close() {
  if (props.closable) emit('close');
}

/**
 * Closes on Escape and keeps Tab and Shift+Tab focus inside the sheet. Only
 * the topmost sheet reacts, so stacked sheets don't all close at once.
 */
function onKeydown(event: KeyboardEvent) {
  if (!isTopSheet(sheetToken)) return;
  if (event.key === 'Escape') {
    // Leave Escape alone when it can't close this sheet.
    if (!props.closable) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
    return;
  }

  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.closest('[aria-hidden="true"], [inert]'));
  // Nothing to tab to: keep focus on the dialog itself.
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.value.focus();
    return;
  }

  // Move focus ourselves on every Tab: browsers differ in what Tab reaches
  // (WebKit skips buttons by default), so the default can leave the sheet.
  event.preventDefault();
  const current = focusable.indexOf(document.activeElement as HTMLElement);
  const next =
    current === -1
      ? event.shiftKey
        ? focusable.length - 1
        : 0
      : (current + (event.shiftKey ? -1 : 1) + focusable.length) %
        focusable.length;
  focusable[next]?.focus();
}

/**
 * Makes everything outside the sheet inert, so screen readers and pointers
 * can't reach the page behind it (`aria-modal` alone isn't always honoured).
 */
function makeBackgroundInert() {
  let node = layer.value;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    for (const sibling of Array.from(parent?.children ?? [])) {
      if (
        sibling !== node &&
        sibling instanceof HTMLElement &&
        !sibling.inert
      ) {
        sibling.inert = true;
        inertElements.push(sibling);
      }
    }
    node = parent ?? undefined;
  }
}

onMounted(() => {
  // Read focus first: making its element inert would move focus away.
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  makeBackgroundInert();
  dialog.value?.focus();
  // On window, so Escape and Tab are handled wherever focus is.
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  unregisterSheet(sheetToken);
  for (const element of inertElements) element.inert = false;
  inertElements = [];
  previouslyFocused?.focus();
});
</script>

<template>
  <div ref="layer" class="sheet-layer">
    <div class="scrim" aria-hidden="true" @click="close" />
    <section
      ref="dialog"
      class="sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
    >
      <div class="sheet-handle" aria-hidden="true" />
      <header class="sheet-head">
        <h2 :id="titleId" class="t-sheet">
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
