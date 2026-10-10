<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from 'vue';
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
    /** When false, hides the close button and ignores every close gesture. */
    closable?: boolean;
  }>(),
  { closeLabel: 'Close', closable: true },
);

const emit = defineEmits<{
  /** Close button, scrim tap, swipe down or Escape, only while `closable`. */
  close: [];
}>();

const dialog = ref<HTMLElement>();
const titleId = `bb-sheet-title-${useId()}`;
const layer = ref<HTMLElement>();
const dragOffset = ref(0);
const dragging = ref(false);
const hasDragged = ref(false);
const sheetStyle = computed(() =>
  dragging.value
    ? { transform: `translateY(${dragOffset.value}px)` }
    : undefined,
);
const scrimStyle = computed(() => {
  if (!dragging.value) return undefined;
  const height = dialog.value?.offsetHeight ?? window.innerHeight;
  return { opacity: Math.max(0, 1 - dragOffset.value / (height * 0.9)) };
});
/** Element to refocus when the sheet unmounts. */
let previouslyFocused: HTMLElement | null = null;
/** Elements this sheet made inert, restored when it unmounts. */
let inertElements: HTMLElement[] = [];
/** Identifies this sheet in `openSheets`. */
const sheetToken = {};
registerSheet(sheetToken);
let dragRegion: 'chrome' | 'body' | undefined;
let dragStartY = 0;
let previousY = 0;
let previousTime = 0;
let lastDownwardVelocity = 0;
let lastDownwardAt = 0;
let bodyScrollAncestors: HTMLElement[] = [];

function close() {
  if (props.closable) emit('close');
}

function getScrollAncestors(target: Element): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let element: Element | null = target;
  while (element && element !== dialog.value) {
    if (element instanceof HTMLElement) {
      const overflowY = getComputedStyle(element).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight
      ) {
        ancestors.push(element);
      }
    }
    element = element.parentElement;
  }
  if (dialog.value) ancestors.push(dialog.value);
  return ancestors;
}

function onTouchStart(event: TouchEvent) {
  if (!props.closable || !isTopSheet(sheetToken) || event.touches.length !== 1) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element) || target.closest('.sheet') !== dialog.value) {
    return;
  }
  const chrome = target.closest('.sheet-handle, .sheet-head');
  const scrollAncestors = chrome ? [] : getScrollAncestors(target);
  if (scrollAncestors.some((element) => element.scrollTop > 0)) return;

  const touch = event.touches[0];
  if (!touch) return;
  dragRegion = chrome ? 'chrome' : 'body';
  bodyScrollAncestors = scrollAncestors;
  dragStartY = touch.clientY;
  previousY = touch.clientY;
  previousTime = event.timeStamp;
  lastDownwardVelocity = 0;
  lastDownwardAt = 0;
}

function onTouchMove(event: TouchEvent) {
  if (!dragRegion || !props.closable || !isTopSheet(sheetToken)) return;
  const touch = event.touches[0];
  if (!touch) return;

  const elapsed = event.timeStamp - previousTime;
  const movement = touch.clientY - previousY;
  if (movement > 0 && elapsed > 0) {
    lastDownwardVelocity = movement / elapsed;
    lastDownwardAt = event.timeStamp;
  } else if (movement < 0) {
    lastDownwardVelocity = 0;
    lastDownwardAt = 0;
  }
  previousY = touch.clientY;
  previousTime = event.timeStamp;

  const offset = touch.clientY - dragStartY;
  if (offset <= 0) {
    if (dragging.value) {
      if (event.cancelable) event.preventDefault();
      dragOffset.value = 0;
    }
    return;
  }
  if (!dragging.value && offset < 6) return;

  if (bodyScrollAncestors.some((element) => element.scrollTop > 0)) return;
  if (event.cancelable) event.preventDefault();
  hasDragged.value = true;
  dragging.value = true;
  dragOffset.value = offset;
}

function resetTouchDrag() {
  dragRegion = undefined;
  bodyScrollAncestors = [];
  dragging.value = false;
  dragOffset.value = 0;
}

function onTouchEnd(event: TouchEvent) {
  if (!dragRegion) return;
  const touch = event.changedTouches[0];
  const offset = Math.max(0, (touch?.clientY ?? previousY) - dragStartY);
  const height = dialog.value?.offsetHeight ?? window.innerHeight;
  const lastVelocityIsFresh = event.timeStamp - lastDownwardAt <= 100;
  const flickedDown =
    offset > 20 && lastVelocityIsFresh && lastDownwardVelocity > 0.65;
  const shouldClose =
    dragging.value && (offset > height * 0.25 || flickedDown);

  resetTouchDrag();
  if (shouldClose) close();
}

function onTouchCancel() {
  resetTouchDrag();
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

/** Makes the app and lower sheets inert while this sheet is open. */
function makeBackgroundInert() {
  const parent = layer.value?.parentElement;
  if (!parent) return;
  for (const sibling of Array.from(parent.children)) {
    if (
      sibling !== layer.value &&
      sibling instanceof HTMLElement &&
      !sibling.inert
    ) {
      sibling.inert = true;
      inertElements.push(sibling);
    }
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
  <Teleport to="body">
    <div ref="layer" class="bb sheet-layer">
      <button
        class="scrim"
        :class="{
          'scrim-interacted': hasDragged,
          'scrim-dragging': dragging,
        }"
        type="button"
        tabindex="-1"
        aria-hidden="true"
        :disabled="!closable"
        :style="scrimStyle"
        @click="close"
      />
      <section
        ref="dialog"
        class="sheet"
        :class="{
          'sheet-interacted': hasDragged,
          'sheet-dragging': dragging,
        }"
        :style="sheetStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchCancel"
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
  </Teleport>
</template>
