<script setup lang="ts">
import { useRoute } from 'vue-router';
import BbBackButton from '../components/BbBackButton.vue';
import { useBack } from '../composables/useBack';

/** Generic destination for routes whose feature screen arrives in a later task. */
defineOptions({ name: 'PlaceholderScreen' });

const title = String(useRoute().meta.title ?? 'Page');
const { label, goBack } = useBack();
</script>

<template>
  <main class="screen app-screen">
    <header class="topbar">
      <BbBackButton
        :label="label"
        @click="goBack"
      />
      <h1 class="t-title">
        {{ title }}
      </h1>
    </header>
    <div class="content app-content">
      <p>{{ title }} is not available yet.</p>
    </div>
  </main>
</template>
