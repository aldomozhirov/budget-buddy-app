import { getCurrentInstance, onMounted, onUnmounted, readonly, ref } from 'vue';

const inset = ref(0);
const visible = ref(0);
let users = 0;

/** Height covered by the on-screen keyboard; 0 without `visualViewport`. */
function measure(): void {
  const viewport = window.visualViewport;
  // Pinch zoom also shrinks the visual viewport; it is not a keyboard.
  const zoomed = viewport ? Math.abs(viewport.scale - 1) > 0.01 : false;
  inset.value =
    viewport && !zoomed
      ? Math.max(
          0,
          Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
        )
      : 0;
  visible.value = inset.value > 0 && viewport ? Math.round(viewport.height) : 0;
}

/**
 * Height in px of the visible area above the keyboard while it is open, which
 * is smaller than the layout viewport minus the inset when the visual
 * viewport is scrolled; 0 while no keyboard is open.
 */
export const keyboardVisibleHeight = readonly(visible);

/**
 * Height in px that the on-screen keyboard covers at the bottom of the
 * layout viewport. iOS shrinks only the visual viewport for the keyboard, so
 * a bottom-anchored sheet must lift itself by this much. Call it from a
 * component setup: one shared listener runs while any caller is mounted.
 */
export function useKeyboardInset() {
  onUsed();
  return readonly(inset);
}

/** Starts the shared listeners with the current component, stops with it. */
function onUsed(): void {
  if (!getCurrentInstance()) return;
  onMounted(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    if (users++ === 0) {
      viewport.addEventListener('resize', measure);
      viewport.addEventListener('scroll', measure);
    }
    measure();
  });
  onUnmounted(() => {
    const viewport = window.visualViewport;
    if (!viewport || users === 0) return;
    if (--users === 0) {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
      inset.value = 0;
      visible.value = 0;
    }
  });
}
