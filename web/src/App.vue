<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

/**
 * Root component: the app shell, or the dev component gallery at
 * `/dev/components` in development or when VITE_COMPONENT_GALLERY=true.
 */
const galleryEnabled =
  import.meta.env.DEV || import.meta.env.VITE_COMPONENT_GALLERY === 'true';
// Read once at startup; there is no router yet.
const isGalleryRoute =
  galleryEnabled && window.location.pathname === '/dev/components';
// Lazy-loaded so the gallery stays out of the main bundle.
const ComponentsPage = galleryEnabled
  ? defineAsyncComponent(() => import('./screens/dev/Components.vue'))
  : null;
</script>

<template>
  <component
    :is="ComponentsPage"
    v-if="isGalleryRoute && ComponentsPage"
  />
  <main
    v-else
    class="bb screen"
  >
    <header class="topbar">
      <h1 class="t-title">
        Budget Buddy
      </h1>
    </header>
    <div class="content">
      <p>Your family’s finances, together.</p>
    </div>
  </main>
</template>
