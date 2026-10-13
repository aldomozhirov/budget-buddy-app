<script setup lang="ts">
import { computed, ref } from 'vue';
import { deviceLockSchema } from '@budget-buddy/shared';
import BbRow from '../../components/BbRow.vue';
import BbSwitch from '../../components/BbSwitch.vue';
import { deviceName } from '../../device.js';
import { goToSignIn } from '../../session/lock.js';
import { authState, setAuthState } from '../../stores/auth.js';

/**
 * "Sign in again when reopened" in Settings → Sign-in: a per-device switch
 * (MEM-7). On, the app asks for the family password or Face ID after more
 * than 5 minutes away; off, the device stays signed in. The switch shows what
 * the server says and is disabled offline, like the other server actions.
 */
defineOptions({ name: 'LockOnReopenRow' });

const emit = defineEmits<{
  /** A change did not work; carries the message to show under the list. */
  error: [message: string];
}>();

const busy = ref(false);
const deviceLabel = deviceName();
const on = computed(() => authState.value?.device.lockOnReopen !== false);

/** Saves the switch for this device; it applies from now on, here only. */
async function change(value: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  emit('error', '');
  try {
    const response = await fetch('/api/devices/current/lock', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lockOnReopen: value }),
    });
    if (response.status === 401) {
      await goToSignIn();
      return;
    }
    if (!response.ok) throw new Error('Could not save.');
    const saved = deviceLockSchema.parse(await response.json());
    const state = authState.value;
    if (state) {
      setAuthState({
        ...state,
        device: { ...state.device, lockOnReopen: saved.lockOnReopen },
      });
    }
  } catch {
    emit(
      'error',
      'Could not save that setting. Check your connection and try again.',
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BbRow
    title="Sign in again when reopened"
    :subtitle="`On ${deviceLabel}, after more than 5 minutes away`"
  >
    <template #trailing>
      <BbSwitch
        :model-value="on"
        label="Sign in again when reopened"
        needs-server
        :disabled="busy || authState === null"
        @update:model-value="change"
      />
    </template>
  </BbRow>
</template>
