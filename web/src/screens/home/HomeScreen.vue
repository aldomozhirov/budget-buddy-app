<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';

/** Home placeholder with links for trying the app shell and navigation. */
defineOptions({ name: 'HomeScreen' });

const sheetOpen = ref(false);
</script>

<template>
  <main class="screen app-screen">
    <header class="topbar">
      <h1 class="t-title">
        Home
      </h1>
    </header>
    <div class="content app-content">
      <p>Your family’s finances, together.</p>
      <section
        class="home-everything"
        aria-labelledby="everything-heading"
      >
        <h2
          id="everything-heading"
          class="h home-grid-heading"
        >
          Everything
        </h2>
        <nav
          class="home-grid"
          aria-label="Everything"
        >
          <RouterLink
            class="home-grid-link"
            to="/accounts"
          >
            <BbIcon name="account" />
            Accounts
          </RouterLink>
          <RouterLink
            class="home-grid-link"
            to="/check-ins"
          >
            <BbIcon name="checkin" />
            Check-ins
          </RouterLink>
          <RouterLink
            class="home-grid-link"
            to="/check-ins/1"
          >
            <BbIcon name="chart" />
            Wealth history
          </RouterLink>
          <RouterLink
            class="home-grid-link"
            to="/settings"
          >
            <BbIcon name="settings" />
            Settings
          </RouterLink>
        </nav>
      </section>
      <BbButton
        variant="secondary"
        @click="sheetOpen = true"
      >
        Open example sheet
      </BbButton>
    </div>
    <BbSheet
      v-if="sheetOpen"
      title="Example sheet"
      @close="sheetOpen = false"
    >
      <p class="t-sub">
        This placeholder sheet can be dismissed without leaving Home.
      </p>
    </BbSheet>
  </main>
</template>
