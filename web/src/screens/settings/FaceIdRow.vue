<script setup lang="ts">
import { computed, ref } from 'vue';
import BbRow from '../../components/BbRow.vue';
import BbSwitch from '../../components/BbSwitch.vue';
import { deviceName } from '../../device.js';
import {
  disablePasskey,
  enablePasskey,
  passkeysSupported,
} from '../../passkey/passkeyClient.js';
import { authState, refreshAuthState } from '../../stores/auth.js';

/**
 * "Unlock with Face ID" in Settings → Sign-in: a per-device switch that
 * registers or deletes this device's passkey (MEM-6, UI-AUTH-7). The switch
 * follows what the server says this device has, and is disabled offline.
 */
defineOptions({ name: 'FaceIdRow' });

const emit = defineEmits<{
  /** A change did not work; carries the message to show under the list. */
  error: [message: string];
}>();

const supported = passkeysSupported();
const busy = ref(false);
const deviceLabel = deviceName();
const on = computed(() => authState.value?.device.hasPasskey === true);
const subtitle = computed(() =>
  supported
    ? `On ${deviceLabel}, instead of the password`
    : 'This browser can’t use Face ID',
);

/** Turns Face ID on or off for this device and reloads the server's answer. */
async function change(value: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  emit('error', '');
  try {
    if (value) {
      const result = await enablePasskey();
      if (!result.ok && result.reason === 'failed')
        emit('error', result.message);
    } else if (!(await disablePasskey())) {
      emit(
        'error',
        'Could not turn off Face ID. Check your connection and try again.',
      );
    }
    await refreshAuthState().catch(() => undefined);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BbRow title="Unlock with Face ID" :subtitle="subtitle">
    <template #trailing>
      <BbSwitch
        :model-value="on"
        label="Unlock with Face ID"
        needs-server
        :disabled="busy || authState === null || (!supported && !on)"
        @update:model-value="change"
      />
    </template>
  </BbRow>
</template>
