import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, defineComponent, h, nextTick, type App } from 'vue';
import { useKeyboardInset } from '../src/composables/useKeyboardInset.js';

type Listener = () => void;

/** A stand-in for `window.visualViewport` that records its listeners. */
function fakeViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    height,
    offsetTop,
    listeners,
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    /** Fires every listener of `type`, as the browser would. */
    emit(type: string) {
      listeners.get(type)?.forEach((fn) => fn());
    },
    count: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

/** A renderer with no DOM: enough to run setup and mounted hooks. */
const { createApp } = createRenderer<object, object>({
  patchProp: () => undefined,
  insert: () => undefined,
  remove: () => undefined,
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => undefined,
  setElementText: () => undefined,
  parentNode: () => null,
  nextSibling: () => null,
});

/** Mounts a component that reads the inset into `seen`. */
function mountReader(seen: { value: number }): App {
  const app = createApp(
    defineComponent({
      setup() {
        const inset = useKeyboardInset();
        return () => {
          seen.value = inset.value;
          return h('div');
        };
      },
    }),
  );
  app.mount({});
  return app;
}

describe('useKeyboardInset', () => {
  let viewport: ReturnType<typeof fakeViewport>;

  beforeEach(() => {
    viewport = fakeViewport(844);
    vi.stubGlobal('window', { innerHeight: 844, visualViewport: viewport });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads 0 when no keyboard is shown', () => {
    const seen = { value: -1 };
    const app = mountReader(seen);
    expect(seen.value).toBe(0);
    app.unmount();
  });

  it('follows the visual viewport as the keyboard opens and closes', async () => {
    const seen = { value: -1 };
    const app = mountReader(seen);
    const tick = nextTick;

    viewport.height = 500;
    viewport.emit('resize');
    await tick();
    expect(seen.value).toBe(344);

    viewport.height = 844;
    viewport.emit('resize');
    await tick();
    expect(seen.value).toBe(0);
    app.unmount();
  });

  it('subtracts the viewport offset after a scroll and never goes negative', async () => {
    const seen = { value: -1 };
    const app = mountReader(seen);

    viewport.height = 500;
    viewport.offsetTop = 100;
    viewport.emit('scroll');
    await nextTick();
    expect(seen.value).toBe(244);

    // Overscroll can make the viewport taller than the window.
    viewport.height = 900;
    viewport.offsetTop = 0;
    viewport.emit('resize');
    await nextTick();
    expect(seen.value).toBe(0);
    app.unmount();
  });

  it('shares one pair of listeners and removes them with the last user', () => {
    const first = mountReader({ value: 0 });
    const second = mountReader({ value: 0 });
    expect(viewport.count()).toBe(2);

    first.unmount();
    expect(viewport.count()).toBe(2);
    second.unmount();
    expect(viewport.count()).toBe(0);
  });

  it('resets to 0 when the last user unmounts while the keyboard is open', async () => {
    const seen = { value: -1 };
    viewport.height = 500;
    const app = mountReader(seen);
    await nextTick();
    expect(seen.value).toBe(344);
    app.unmount();

    // A new user must not start from the stale value.
    const again = { value: -1 };
    viewport.height = 844;
    const next = mountReader(again);
    await nextTick();
    expect(again.value).toBe(0);
    next.unmount();
  });

  it('stays at 0 without visualViewport', () => {
    vi.stubGlobal('window', { innerHeight: 844 });
    const seen = { value: -1 };
    const app = mountReader(seen);
    expect(seen.value).toBe(0);
    app.unmount();
  });
});
