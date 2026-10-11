<script setup lang="ts">
import { computed, ref } from 'vue';
import BbButton from '../../components/BbButton.vue';
import BbSheet from '../../components/BbSheet.vue';
import { deviceName } from '../../device.js';
import { enablePush } from '../../push/pushClient.js';

/**
 * Explainer shown before the system asks for notification permission
 * (UI-SET-3, NTF-2). "Continue" is the tap that iOS needs before it shows
 * its question; "Not now" and dismissing the sheet request nothing.
 */
const emit = defineEmits<{
  /** The sheet is done: permission was answered, or the sheet was dismissed. */
  close: [];
}>();

const busy = ref(false);
const error = ref('');
const asker = computed(() => {
  const name = deviceName();
  return name === 'this iPhone'
    ? 'iPhone'
    : name === 'this iPad'
      ? 'iPad'
      : 'Your browser';
});

/** Asks for permission and subscribes; the sheet stays open on a failure. */
async function proceed(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await enablePush();
    if (!result.ok && result.reason === 'failed') {
      error.value =
        'Could not turn on notifications. Check your connection and try again.';
      return;
    }
    emit('close');
  } finally {
    busy.value = false;
  }
}

/** Closing while the system question is open would hide its answer. */
function dismiss(): void {
  if (!busy.value) emit('close');
}
</script>

<template>
  <BbSheet title="Turn on notifications?" :closable="!busy" @close="dismiss">
    <p class="t-sub sheet-copy">
      You’ll get a nudge when a check-in starts, a reminder if your accounts are
      still open, and a note when it closes. Notifications never show amounts.
    </p>
    <p class="t-sub sheet-copy">{{ asker }} asks for permission next.</p>
    <p v-if="error" class="error sheet-copy" role="alert">
      {{ error }}
    </p>
    <BbButton needs-server :disabled="busy" @click="proceed">Continue</BbButton>
    <BbButton
      variant="secondary"
      class="not-now"
      :disabled="busy"
      @click="dismiss"
    >
      Not now
    </BbButton>
  </BbSheet>
</template>
