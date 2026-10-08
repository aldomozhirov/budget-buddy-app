<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  authDeviceResponseSchema,
  signInResponseSchema,
  type AuthMember,
} from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSwitch from '../../components/BbSwitch.vue';
import { deviceName } from '../../device.js';
import { authState, refreshAuthState } from '../../stores/auth.js';

/** Sign-in and profile selection for a family's shared-password account. */
defineOptions({ name: 'SignInScreen' });

const router = useRouter();
const password = ref('');
const passwordVisible = ref(false);
const submitting = ref(false);
const passwordError = ref('');
const formError = ref('');
const forgotPasswordOpen = ref(false);
const rememberOnDevice = ref(true);
const selectingProfile = ref<number | null>(null);
const lockSeconds = ref(0);
const shakePassword = ref(false);
const deviceHints = ref({
  defaultMember: null as AuthMember | null,
  hasPasskey: false,
});
const pickerMode = ref(
  authState.value !== null && authState.value.member === null,
);
const profiles = computed(() => authState.value?.profiles ?? []);
const deviceLabel = deviceName();
let lockTimer: number | undefined;

onMounted(async () => {
  if (authState.value?.member === null) return;
  try {
    const response = await fetch('/api/auth/device');
    if (!response.ok) return;
    deviceHints.value = authDeviceResponseSchema.parse(await response.json());
  } catch {
    formError.value = 'Could not check this device. Try again.';
  }
});

onUnmounted(() => {
  if (lockTimer !== undefined) window.clearInterval(lockTimer);
});

const openAs = computed(() => {
  const member = deviceHints.value.defaultMember;
  return member ? `Opens as ${member.name} on ${deviceLabel}` : '';
});

async function signIn(): Promise<void> {
  if (!password.value || submitting.value || lockSeconds.value > 0) return;
  submitting.value = true;
  passwordError.value = '';
  formError.value = '';
  shakePassword.value = false;

  try {
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as {
        error?: { message?: string; retryAfter?: number };
      };
      if (response.status === 423) {
        startLockout(payload.error?.retryAfter ?? 30);
        passwordError.value = `Too many tries. Try again in ${lockSeconds.value} s.`;
      } else if (response.status === 401) {
        passwordError.value =
          payload.error?.message ?? 'That password doesn’t match.';
        shakePassword.value = true;
      } else {
        formError.value =
          payload.error?.message ?? 'Could not sign in. Try again.';
      }
      return;
    }

    signInResponseSchema.parse(await response.json());
    const state = await refreshAuthState();
    if (state?.member) {
      await router.replace('/');
    } else if (state) {
      pickerMode.value = true;
      rememberOnDevice.value = true;
    } else {
      formError.value = 'Could not start a session. Try again.';
    }
  } catch {
    formError.value = 'Could not sign in. Check your connection and try again.';
  } finally {
    submitting.value = false;
  }
}

async function chooseProfile(profile: AuthMember): Promise<void> {
  if (selectingProfile.value !== null) return;
  selectingProfile.value = profile.id;
  formError.value = '';
  try {
    const response = await fetch('/api/auth/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memberId: profile.id,
        remember: rememberOnDevice.value,
      }),
    });
    if (!response.ok) {
      formError.value = 'Could not open that profile. Try again.';
      return;
    }
    const state = await refreshAuthState();
    if (state?.member) await router.replace('/');
    else formError.value = 'Choose an active profile to continue.';
  } catch {
    formError.value = 'Could not open that profile. Check your connection.';
  } finally {
    selectingProfile.value = null;
  }
}

function startLockout(seconds: number): void {
  if (lockTimer !== undefined) window.clearInterval(lockTimer);
  lockSeconds.value = Math.max(1, Math.ceil(seconds));
  lockTimer = window.setInterval(() => {
    lockSeconds.value = Math.max(0, lockSeconds.value - 1);
    if (lockSeconds.value === 0) {
      if (lockTimer !== undefined) window.clearInterval(lockTimer);
      lockTimer = undefined;
      passwordError.value = '';
    } else {
      passwordError.value = `Too many tries. Try again in ${lockSeconds.value} s.`;
    }
  }, 1000);
}
</script>

<template>
  <main class="screen auth-screen">
    <div class="auth-brand">
      <span
        class="auth-mark"
        aria-hidden="true"
      >
        <BbIcon
          name="wallet"
          :size="34"
          :stroke-width="1.8"
        />
      </span>
      <h1>Budget Buddy</h1>
    </div>

    <form
      v-if="!pickerMode"
      class="auth-form"
      @submit.prevent="signIn"
    >
      <div class="input-wrap">
        <label
          class="visually-hidden"
          for="family-password"
        >
          Family password
        </label>
        <input
          id="family-password"
          v-model="password"
          class="pw"
          :class="{ shake: shakePassword }"
          :type="passwordVisible ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="Family password"
          :aria-invalid="passwordError !== ''"
          :aria-describedby="passwordError ? 'password-error' : undefined"
          :disabled="lockSeconds > 0"
          @input="
            passwordError = '';
            shakePassword = false;
          "
        >
        <button
          class="input-btn"
          type="button"
          :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
          @click="passwordVisible = !passwordVisible"
        >
          <BbIcon :name="passwordVisible ? 'eye-off' : 'eye'" />
        </button>
      </div>
      <p
        id="password-error"
        class="error auth-error"
        role="alert"
      >
        {{ passwordError }}
      </p>
      <p
        v-if="formError"
        class="error auth-error"
        role="alert"
      >
        {{ formError }}
      </p>
      <BbButton
        type="submit"
        :disabled="!password || submitting || lockSeconds > 0"
      >
        {{ lockSeconds > 0 ? `Wait ${lockSeconds} s` : 'Sign in' }}
      </BbButton>
      <BbButton
        v-if="deviceHints.hasPasskey"
        variant="secondary"
        type="button"
        @click="formError = 'Use your family password to sign in.'"
      >
        <BbIcon name="faceid" />
        Use Face ID
      </BbButton>
      <p
        v-if="openAs"
        class="t-sub auth-device-copy"
      >
        {{ openAs }}
      </p>
      <BbButton
        variant="text"
        type="button"
        :aria-expanded="forgotPasswordOpen"
        @click="forgotPasswordOpen = !forgotPasswordOpen"
      >
        Forgot password?
      </BbButton>
      <p
        v-if="forgotPasswordOpen"
        class="t-sub auth-forgot-copy"
      >
        Anyone in the family who is still signed in can set a new one in
        Settings → Family password. If nobody is, reset it on the Mac mini as
        the README describes.
      </p>
    </form>

    <section
      v-else
      class="auth-form auth-picker"
      aria-labelledby="profile-picker-heading"
    >
      <h2
        id="profile-picker-heading"
        class="auth-picker-heading"
      >
        Who’s using {{ deviceLabel }}?
      </h2>
      <p class="auth-picker-copy">
        New expenses and check-ins are recorded under this name.
      </p>
      <div
        class="auth-profile-list"
        role="radiogroup"
        aria-label="Choose a profile"
      >
        <button
          v-for="profile in profiles"
          :key="profile.id"
          class="auth-profile-option"
          type="button"
          role="radio"
          aria-checked="false"
          :disabled="selectingProfile !== null"
          @click="chooseProfile(profile)"
        >
          <span
            class="auth-avatar"
            aria-hidden="true"
          >{{
            profile.name.slice(0, 1).toLocaleUpperCase()
          }}</span>
          <span class="auth-profile-name">{{ profile.name }}</span>
          <span
            v-if="selectingProfile === profile.id"
            class="visually-hidden"
          >
            Opening
          </span>
          <BbIcon
            name="forward"
            class="auth-profile-chevron"
            :size="18"
          />
        </button>
      </div>
      <div class="auth-remember-row">
        <span class="auth-remember-copy">
          <span>Remember on this device</span>
          <span class="t-sub">Skip this question next time</span>
        </span>
        <BbSwitch
          v-model="rememberOnDevice"
          label="Remember on this device"
          :disabled="selectingProfile !== null"
        />
      </div>
      <p
        v-if="formError"
        class="error auth-error"
        role="alert"
      >
        {{ formError }}
      </p>
    </section>
  </main>
</template>
