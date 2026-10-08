<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ChevronRight, X } from 'lucide-vue-next';
import { RouterLink, useRouter } from 'vue-router';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import { completeFirstStart } from '../../router';

/** Creates the family's password and profiles, then offers the agreed next steps. */
defineOptions({ name: 'SetupScreen' });

type SetupField = 'password' | 'passwordConfirmation' | 'profiles' | 'form';

const password = ref('');
const passwordConfirmation = ref('');
const profiles = ref([
  { id: 1, name: '' },
  { id: 2, name: '' },
]);
const nextProfileId = ref(3);
const fieldErrors = ref<Partial<Record<SetupField, string>>>({});
const formError = ref('');
const submitting = ref(false);
const showNextSteps = ref(false);
const router = useRouter();

/** Checks the form with the server's rules and copy, so mistakes show inline. */
function validate(): Partial<Record<SetupField, string>> {
  const errors: Partial<Record<SetupField, string>> = {};
  if (password.value.length < 10) {
    errors.password = 'Use at least 10 characters.';
  }
  if (passwordConfirmation.value.length === 0) {
    errors.passwordConfirmation = 'Repeat the family password.';
  } else if (password.value !== passwordConfirmation.value) {
    errors.passwordConfirmation = 'The passwords do not match.';
  }
  if (!profiles.value.some((profile) => profile.name.trim().length > 0)) {
    errors.profiles = 'Enter a profile name.';
  }
  return errors;
}

// An error clears as soon as the person edits that field again.
watch(password, () => {
  delete fieldErrors.value.password;
});
watch(passwordConfirmation, () => {
  delete fieldErrors.value.passwordConfirmation;
});
watch(
  () => profiles.value.map((profile) => profile.name),
  () => {
    delete fieldErrors.value.profiles;
  },
);

function addProfile(): void {
  profiles.value.push({ id: nextProfileId.value, name: '' });
  nextProfileId.value += 1;
}

function removeProfile(id: number): void {
  profiles.value = profiles.value.filter((profile) => profile.id !== id);
}

async function createFamily(): Promise<void> {
  if (submitting.value) return;

  formError.value = '';
  const errors = validate();
  fieldErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    // Focus the first invalid field so screen readers announce its error.
    await nextTick();
    document
      .querySelector<HTMLInputElement>('.setup-flow [aria-invalid="true"]')
      ?.focus();
    return;
  }

  submitting.value = true;
  try {
    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: password.value,
        passwordConfirmation: passwordConfirmation.value,
        profiles: profiles.value
          .map((profile) => profile.name.trim())
          .filter(Boolean),
      }),
    });
    const result = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
        fields?: Partial<Record<SetupField, string>>;
      };
    };

    if (!response.ok) {
      if (response.status === 403 && result.error?.code === 'forbidden_state') {
        try {
          const statusResponse = await fetch('/api/setup');
          if (statusResponse.ok) {
            const status = (await statusResponse.json()) as { needed: boolean };
            if (!status.needed) {
              completeFirstStart();
              await router.replace('/');
              return;
            }
          }
        } catch {
          formError.value =
            'Could not connect. Check your connection and try again.';
          return;
        }
      }
      fieldErrors.value = result.error?.fields ?? {};
      formError.value = result.error?.fields
        ? ''
        : (result.error?.message ?? 'Could not create the family. Try again.');
      return;
    }

    completeFirstStart();
    showNextSteps.value = true;
  } catch {
    formError.value = 'Could not connect. Check your connection and try again.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="screen app-screen setup-screen">
    <form
      v-if="!showNextSteps"
      class="setup-flow"
      @submit.prevent="createFamily"
    >
      <div class="setup-scroll scroll">
        <div class="setup-content">
          <header class="setup-intro">
            <h1 class="setup-heading">
              Set up Budget Buddy
            </h1>
            <p class="setup-copy">
              One password for the whole family, and a profile for each person.
            </p>
          </header>

          <section
            class="setup-field-group"
            aria-label="Family password"
          >
            <label
              class="lbl"
              for="setup-password"
            >Family password</label>
            <input
              id="setup-password"
              v-model="password"
              class="text"
              type="password"
              autocomplete="new-password"
              placeholder="At least 10 characters"
              :aria-invalid="Boolean(fieldErrors.password)"
              :aria-describedby="
                fieldErrors.password
                  ? 'setup-password-error'
                  : 'setup-password-hint'
              "
            >
            <label
              class="sr"
              for="setup-password-confirmation"
            >
              Repeat family password
            </label>
            <input
              id="setup-password-confirmation"
              v-model="passwordConfirmation"
              class="text"
              type="password"
              autocomplete="new-password"
              placeholder="Repeat it"
              :aria-invalid="Boolean(fieldErrors.passwordConfirmation)"
              :aria-describedby="
                fieldErrors.passwordConfirmation
                  ? 'setup-confirmation-error'
                  : undefined
              "
            >
            <span
              id="setup-password-hint"
              class="setup-hint"
            >
              Everyone uses it to sign in. A long phrase is easiest.
            </span>
            <span
              v-if="fieldErrors.password"
              id="setup-password-error"
              class="setup-error"
              role="alert"
            >{{ fieldErrors.password }}</span>
            <span
              v-if="fieldErrors.passwordConfirmation"
              id="setup-confirmation-error"
              class="setup-error"
              role="alert"
            >{{ fieldErrors.passwordConfirmation }}</span>
          </section>

          <section
            class="setup-field-group"
            aria-label="Profiles"
          >
            <span class="lbl">Profiles</span>
            <div class="setup-profile-list">
              <div
                v-for="(profile, index) in profiles"
                :key="profile.id"
                class="setup-profile-row"
              >
                <label
                  class="sr"
                  :for="`setup-profile-${profile.id}`"
                >
                  {{ index === 0 ? 'Your name' : `Profile ${index + 1} name` }}
                </label>
                <input
                  :id="`setup-profile-${profile.id}`"
                  v-model="profile.name"
                  class="text"
                  type="text"
                  autocomplete="off"
                  :placeholder="
                    index === 0
                      ? 'Your name'
                      : index === 1
                        ? 'Another person, e.g. Max'
                        : 'Another person'
                  "
                  :aria-invalid="Boolean(fieldErrors.profiles)"
                  :aria-describedby="
                    fieldErrors.profiles ? 'setup-profiles-error' : undefined
                  "
                >
                <button
                  v-if="index > 0"
                  class="setup-remove-profile"
                  type="button"
                  :aria-label="`Remove profile ${index + 1}`"
                  @click="removeProfile(profile.id)"
                >
                  <X
                    :size="18"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <span
              v-if="fieldErrors.profiles"
              id="setup-profiles-error"
              class="setup-error"
              role="alert"
            >{{ fieldErrors.profiles }}</span>
            <button
              class="setup-add-profile"
              type="button"
              @click="addProfile"
            >
              + Add a profile
            </button>
            <span class="setup-hint">
              The first one opens on this device. You can add more profiles
              later.
            </span>
          </section>
          <p
            v-if="formError"
            class="setup-error"
            role="alert"
          >
            {{ formError }}
          </p>
        </div>
      </div>

      <div class="setup-footer">
        <BbButton
          type="submit"
          :disabled="submitting"
        >
          Create
        </BbButton>
      </div>
    </form>

    <div
      v-else
      class="setup-flow"
    >
      <div class="setup-scroll scroll">
        <div class="setup-content">
          <h1 class="setup-heading">
            Next steps
          </h1>
          <BbListCard
            as="section"
            label="Next steps"
          >
            <RouterLink
              class="row setup-next-link"
              to="/accounts/new"
            >
              <span class="row-l">Add your accounts</span>
              <ChevronRight
                class="setup-next-arrow"
                :size="18"
                aria-hidden="true"
              />
            </RouterLink>
            <RouterLink
              class="row setup-next-link"
              to="/settings"
            >
              <span class="row-l">Pick the check-in schedule</span>
              <ChevronRight
                class="setup-next-arrow"
                :size="18"
                aria-hidden="true"
              />
            </RouterLink>
          </BbListCard>
        </div>
      </div>
      <div class="setup-footer">
        <RouterLink
          class="primary setup-home-link"
          to="/"
        >
          Later, go to Home
        </RouterLink>
      </div>
    </div>
  </main>
</template>
