<script setup lang="ts">
/**
 * The strip at the top of the app while the device has no connection (IOS-6).
 * It takes the notch's safe area itself, so the screens below it start flush.
 * Shown by `App.vue`; carries the one sentence the owner approved. Its icon
 * is the design's own "offline" drawing (a slashed cloud, `icons.md`), not
 * the Lucide icon that `BbIcon` has under that name.
 */
defineOptions({ name: 'OfflineNote' });
</script>

<template>
  <div class="offline-strip">
    <p class="offline-note" role="status">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 3l18 18" />
        <path d="M9 19h8a4 4 0 0 0 1.6-7.7" />
        <path d="M6 9.6A5 5 0 0 0 7 19" />
      </svg>
      You’re offline. Showing what was loaded last.
    </p>
  </div>
</template>

<style scoped>
.offline-strip {
  position: sticky;
  top: 0;
  z-index: 20;
  box-sizing: border-box;
  height: var(--offline-strip-height);
  padding: var(--inset-top) var(--gutter) 0;
  background: var(--bg);
}

/* The prototype's offline note on Add expense, in the same measures. */
.offline-note svg {
  flex: none;
}

.offline-note {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 34px;
  margin: 8px 0 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 13px;
  font-weight: 500;
}
</style>
