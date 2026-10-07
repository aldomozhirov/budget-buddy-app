<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const galleryEnabled =
  import.meta.env.DEV || import.meta.env.VITE_COMPONENT_GALLERY === 'true';
const isGalleryRoute =
  galleryEnabled && window.location.pathname === '/dev/components';
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
