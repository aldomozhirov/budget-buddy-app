<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import ProfileSheet from './ProfileSheet.vue';
import { authState } from '../../stores/auth.js';

/** Home placeholder with the signed-in greeting and profile controls. */
defineOptions({ name: 'HomeScreen' });

const sheetOpen = ref(false);
const profileSheetOpen = ref(false);
const profileName = computed(() => authState.value?.member?.name ?? '');
</script>

<template>
  <main class="screen app-screen">
    <header class="topbar home-header">
      <h1 class="t-greeting">Hi, {{ profileName }}</h1>
      <button
        class="icon-btn icon-btn-ink home-profile-button"
        type="button"
        :aria-label="`${profileName} — switch profile or sign out`"
        aria-haspopup="dialog"
        @click="profileSheetOpen = true"
      >
        {{ profileName.slice(0, 1).toLocaleUpperCase() }}
      </button>
    </header>
    <div class="content app-content">
      <p>Your family’s finances, together.</p>
      <section class="home-everything" aria-labelledby="everything-heading">
        <h2 id="everything-heading" class="h home-grid-heading">Everything</h2>
        <nav class="home-grid" aria-label="Everything">
          <RouterLink class="home-grid-link" to="/accounts">
            <BbIcon name="account" />
            Accounts
          </RouterLink>
          <RouterLink class="home-grid-link" to="/check-ins">
            <BbIcon name="checkin" />
            Check-ins
          </RouterLink>
          <RouterLink class="home-grid-link" to="/check-ins/1">
            <BbIcon name="chart" />
            Wealth history
          </RouterLink>
          <RouterLink class="home-grid-link" to="/settings">
            <BbIcon name="settings" />
            Settings
          </RouterLink>
        </nav>
      </section>
      <BbButton variant="secondary" @click="sheetOpen = true">
        Open example sheet
      </BbButton>
    </div>
    <BbSheet v-if="sheetOpen" title="Example sheet" @close="sheetOpen = false">
      <p class="t-sub">
        This placeholder sheet can be dismissed without leaving Home.
      </p>
    </BbSheet>
    <ProfileSheet v-if="profileSheetOpen" @close="profileSheetOpen = false" />
  </main>
</template>
