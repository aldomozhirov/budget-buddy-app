<script setup lang="ts">
import { forgetLastScreen } from '../../session/lock.js';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { profileResponseSchema, type AuthMember } from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import { isOnline } from '../../composables/useOnline.js';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import BbSwitch from '../../components/BbSwitch.vue';
import { deviceName } from '../../device.js';
import { outbox } from '../../offline/outbox.js';
import { unsentQuestion } from '../transactions/outboxRows.js';
import {
  authState,
  refreshAuthState,
  setAuthState,
} from '../../stores/auth.js';

/**
 * Profile switcher for the signed-in Home avatar, with sign-out. Sign-out
 * first sends what waits on the phone and asks before deleting the rest
 * (UI-HOME-8).
 */
defineOptions({ name: 'ProfileSheet' });

const emit = defineEmits<{
  /** The sheet should close after a profile change or sign-out. */
  close: [];
}>();

const router = useRouter();
const busy = ref(false);
const formError = ref('');
/** The question about unsent items is open. */
const askUnsent = ref(false);
const deviceLabel = deviceName();
const profiles = computed(() => authState.value?.profiles ?? []);
const currentMember = computed(() => authState.value?.member ?? null);
const rememberOnDevice = ref(
  currentMember.value !== null &&
    authState.value?.device.defaultMemberId === currentMember.value.id,
);

async function chooseProfile(profile: AuthMember): Promise<void> {
  await updateProfile(profile, rememberOnDevice.value, true);
}

function onProfileKeydown(event: KeyboardEvent, index: number): void {
  const direction =
    event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0;
  if (!direction || profiles.value.length === 0) return;

  event.preventDefault();
  const nextIndex =
    (index + direction + profiles.value.length) % profiles.value.length;
  const options = (
    event.currentTarget as HTMLButtonElement
  ).parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  options?.[nextIndex]?.focus();
  const profile = profiles.value[nextIndex];
  if (profile) void chooseProfile(profile);
}

async function changeRemember(value: boolean): Promise<void> {
  const member = currentMember.value;
  if (!member || busy.value) return;
  const previousValue = rememberOnDevice.value;
  rememberOnDevice.value = value;
  const changed = await updateProfile(member, value, false);
  if (!changed) rememberOnDevice.value = previousValue;
}

async function updateProfile(
  profile: AuthMember,
  remember: boolean,
  closeAfter: boolean,
): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  formError.value = '';
  try {
    const response = await fetch('/api/auth/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: profile.id, remember }),
    });
    if (!response.ok) {
      formError.value = 'Could not open that profile. Try again.';
      return false;
    }
    profileResponseSchema.parse(await response.json());
    const state = await refreshAuthState();
    if (!state?.member) {
      formError.value = 'Choose an active profile to continue.';
      return false;
    }
    if (closeAfter) emit('close');
    return true;
  } catch {
    formError.value = 'Could not open that profile. Check your connection.';
    return false;
  } finally {
    busy.value = false;
  }
}

/** Sends what waits, then signs out or asks about what is left. */
async function trySignOut(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  formError.value = '';
  await outbox.flush().catch(() => undefined);
  busy.value = false;
  if (outbox.items.value.length > 0) askUnsent.value = true;
  else await signOut();
}

async function signOut(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  formError.value = '';
  try {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error('Sign-out failed.');
    // Nothing stays on the phone after a sign-out (D3).
    await outbox.clear().catch(() => undefined);
    setAuthState(null);
    forgetLastScreen();
    emit('close');
    await router.replace('/sign-in');
  } catch {
    askUnsent.value = false;
    formError.value =
      'Could not sign out. Check your connection and try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- The question takes the sheet's place, as in the design. -->
  <BbSheet v-if="askUnsent" title="Sign out?" @close="askUnsent = false">
    <p class="t-sub profile-sheet-unsent">
      {{ unsentQuestion(outbox.items.value) }}
    </p>
    <BbButton class="profile-sheet-anyway" :disabled="busy" @click="signOut">
      Sign out anyway
    </BbButton>
    <BbButton
      variant="secondary"
      class="profile-sheet-keep"
      @click="askUnsent = false"
    >
      Keep me signed in
    </BbButton>
  </BbSheet>
  <BbSheet v-else title="Who’s using the app?" @close="emit('close')">
    <div
      class="card profile-sheet-list"
      role="radiogroup"
      aria-label="Choose a profile"
    >
      <button
        v-for="profile in profiles"
        :key="profile.id"
        class="opt profile-sheet-option"
        type="button"
        role="radio"
        :aria-checked="currentMember?.id === profile.id"
        :tabindex="currentMember?.id === profile.id ? 0 : -1"
        :disabled="busy || !isOnline"
        @click="chooseProfile(profile)"
        @keydown="onProfileKeydown($event, profiles.indexOf(profile))"
      >
        <span
          class="box box-radio"
          :aria-checked="currentMember?.id === profile.id"
          aria-hidden="true"
        >
          <BbIcon
            v-if="currentMember?.id === profile.id"
            name="check"
            :size="14"
            :stroke-width="3"
          />
        </span>
        <span class="profile-sheet-name">
          <span>{{ profile.name }}</span>
          <span
            v-if="authState?.device.defaultMemberId === profile.id"
            class="t-sub"
          >
            Default on {{ deviceLabel }}
          </span>
        </span>
      </button>
    </div>

    <div class="row profile-sheet-switch-row">
      <span class="row-l">
        <span style="font-weight: 500">
          Open as {{ currentMember?.name ?? 'profile' }} on {{ deviceLabel }}
        </span>
      </span>
      <BbSwitch
        :model-value="rememberOnDevice"
        :label="`Open as ${currentMember?.name ?? 'profile'} on ${deviceLabel}`"
        :disabled="busy || currentMember === null"
        needs-server
        @update:model-value="changeRemember"
      />
    </div>

    <p v-if="formError" class="error profile-sheet-error" role="alert">
      {{ formError }}
    </p>
    <BbButton
      variant="text"
      class="danger profile-sheet-signout"
      needs-server
      :disabled="busy"
      @click="trySignOut"
    >
      Sign out
    </BbButton>
  </BbSheet>
</template>

<style scoped>
.profile-sheet-unsent {
  margin: 0 0 10px;
  font-size: 15px;
}
.bb .profile-sheet-anyway {
  background: var(--warn);
  color: var(--surface);
}
.bb .profile-sheet-keep {
  background: var(--bg);
}
</style>
