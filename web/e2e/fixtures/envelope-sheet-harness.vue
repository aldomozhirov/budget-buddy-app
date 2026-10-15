<script setup lang="ts">
import { ref } from 'vue';
import type { Envelope } from '@budget-buddy/shared';
import EnvelopeSheet from '../../src/screens/envelopes/EnvelopeSheet.vue';

/**
 * Opens the envelope sheet on the envelope in `window.__envelope` (or a new
 * one) and lists what it emits. The envelope page that opens the edit sheet
 * is task 6 of spec 2; until then the edit sheet is tested here.
 */
const initial = (window as unknown as { __envelope?: Envelope }).__envelope;
const open = ref(false);
const events = ref<string[]>([]);
</script>

<template>
  <main class="bb" style="padding: 24px">
    <button type="button" @click="open = true">Open the sheet</button>
    <output role="status" aria-label="Events">{{ events.join(', ') }}</output>
    <EnvelopeSheet
      v-if="open"
      v-bind="initial ? { envelope: initial } : {}"
      month="2026-10"
      @saved="events.push('saved')"
      @deleted="events.push('deleted')"
      @archived="events.push('archived')"
      @close="
        open = false;
        events.push('closed');
      "
    />
  </main>
</template>
