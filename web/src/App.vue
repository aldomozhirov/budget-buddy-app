<script setup lang="ts">
import { RouterView } from 'vue-router';
import { screenTransitionClass } from './router';

/** Routed app shell that retains the prior screen during navigation. */
defineOptions({ name: 'AppShell' });

let activeScreenEnter: { cancel: () => void } | undefined;
const screenEnters = new WeakMap<Element, { cancel: () => void }>();

function onScreenEnter(element: Element, done: () => void) {
  const direction = screenTransitionClass.value;
  const duration = direction === 'enter-back' ? 380 : 420;

  if (
    !direction ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    screenTransitionClass.value = '';
    done();
    return;
  }

  const animationName = direction === 'enter-back' ? 'bb-in-back' : 'bb-in-fwd';
  let active = true;
  let timer: number;
  const cleanup = () => {
    window.clearTimeout(timer);
    element.removeEventListener('animationend', onAnimationEnd);
    if (screenEnters.get(element) === transition) screenEnters.delete(element);
  };
  const transition = {
    cancel: () => {
      if (!active) return;
      active = false;
      cleanup();
      (element as HTMLElement).style.zIndex = '';
      if (activeScreenEnter === transition) activeScreenEnter = undefined;
    },
  };
  const finish = (event?: AnimationEvent) => {
    if (!active) return;
    if (
      event &&
      (event.target !== element || event.animationName !== animationName)
    ) {
      return;
    }
    active = false;
    cleanup();
    (element as HTMLElement).style.zIndex = '';
    if (activeScreenEnter === transition) {
      activeScreenEnter = undefined;
      screenTransitionClass.value = '';
    }
    done();
  };
  const onAnimationEnd = (event: Event) => finish(event as AnimationEvent);
  activeScreenEnter = transition;
  screenEnters.set(element, transition);
  timer = window.setTimeout(() => finish(), duration + 50);

  (element as HTMLElement).style.zIndex = '1';
  element.addEventListener('animationend', onAnimationEnd);
}

function onScreenEnterCancelled(element: Element) {
  screenEnters.get(element)?.cancel();
}

function onScreenLeave(element: Element, done: () => void) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }

  const duration = screenTransitionClass.value === 'enter-back' ? 380 : 420;
  Object.assign((element as HTMLElement).style, {
    position: 'absolute',
    inset: '0',
    marginInline: 'auto',
    zIndex: '0',
  });
  window.setTimeout(done, duration);
}
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <component
      :is="Component"
      v-if="route.name === 'ComponentsGallery'"
      :key="route.fullPath"
    />
    <div v-else class="bb app-shell">
      <Transition
        :css="false"
        @enter="onScreenEnter"
        @enter-cancelled="onScreenEnterCancelled"
        @leave="onScreenLeave"
      >
        <component
          :is="Component"
          :key="route.fullPath"
          :class="screenTransitionClass"
        />
      </Transition>
    </div>
  </RouterView>
</template>
