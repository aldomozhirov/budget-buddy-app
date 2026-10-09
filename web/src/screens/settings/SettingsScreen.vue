<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  changeFamilyPasswordResponseSchema,
  currenciesResponseSchema,
  memberResponseSchema,
  membersResponseSchema,
  settingsResponseSchema,
  type CoinSetting,
  type CurrencyOption,
  type ManagedMember,
} from '@budget-buddy/shared';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import BbSheet from '../../components/BbSheet.vue';
import CommonCurrencySheet from './CommonCurrencySheet.vue';
import CoinsSheet from './CoinsSheet.vue';
import TimeZoneSheet from './TimeZoneSheet.vue';
import { deviceName } from '../../device.js';
import { useBack } from '../../composables/useBack.js';
import {
  authState,
  refreshAuthState,
  setAuthState,
} from '../../stores/auth.js';

/** Settings screen for profile management and the family password. */
defineOptions({ name: 'SettingsScreen' });

const router = useRouter();
const { label: backLabel, goBack } = useBack();
const deviceLabel = deviceName();
const members = ref<ManagedMember[]>([]);
const loading = ref(true);
const screenError = ref('');
const editorMode = ref<'add' | 'edit' | null>(null);
const selectedMember = ref<ManagedMember | null>(null);
const memberName = ref('');
const memberError = ref('');
const memberBusy = ref(false);
const deactivateConfirmationOpen = ref(false);
const deactivateError = ref('');
const passwordSheetOpen = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const passwordErrors = ref({ currentPassword: '', newPassword: '' });
const passwordError = ref('');
const passwordChanged = ref(false);
const passwordBusy = ref(false);
const signOutBusy = ref(false);
const moneySettingsLoading = ref(true);
const moneySettingsError = ref('');
const commonCurrency = ref('EUR');
const timeZone = ref('Europe/Berlin');
const currencyOptions = ref<CurrencyOption[]>([]);
const coins = ref<CoinSetting[]>([]);
const commonCurrencySheetOpen = ref(false);
const coinsSheetOpen = ref(false);
const timeZoneSheetOpen = ref(false);
const defaultMemberId = computed(
  () => authState.value?.device.defaultMemberId ?? null,
);
const commonCurrencyOptions = computed(() =>
  currencyOptions.value.filter(
    (currency) =>
      currency.kind === 'fiat' ||
      currency.code === commonCurrency.value ||
      coins.value.some((coin) => coin.code === currency.code && coin.inUse),
  ),
);
const coinListSummary = computed(() =>
  coins.value.length
    ? coins.value.map(({ code }) => code).join(', ')
    : 'No coins yet',
);
const editorTitle = computed(() =>
  editorMode.value === 'add' ? 'Add profile' : 'Edit profile',
);

onMounted(() => {
  void loadMembers();
  void loadMoneySettings();
});

async function loadMoneySettings(): Promise<void> {
  moneySettingsLoading.value = true;
  moneySettingsError.value = '';
  try {
    const [settingsResponse, currenciesResponse] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/currencies'),
    ]);
    if (settingsResponse.status === 401 || currenciesResponse.status === 401) {
      setAuthState(null);
      await router.replace('/sign-in');
      return;
    }
    if (!settingsResponse.ok || !currenciesResponse.ok) {
      throw new Error('Could not load money settings. Try again.');
    }
    const [settings, currencyData] = await Promise.all([
      settingsResponse.json(),
      currenciesResponse.json(),
    ]);
    const parsedSettings = settingsResponseSchema.parse(settings);
    const parsedCurrencies = currenciesResponseSchema.parse(currencyData);
    commonCurrency.value = parsedSettings.commonCurrency;
    timeZone.value = parsedSettings.timeZone;
    currencyOptions.value = parsedCurrencies.currencies;
    coins.value = parsedCurrencies.coins;
  } catch {
    moneySettingsError.value =
      'Could not load money settings. Check your connection and try again.';
  } finally {
    moneySettingsLoading.value = false;
  }
}

function showCommonCurrencySheet(): void {
  commonCurrencySheetOpen.value = true;
}

function saveCommonCurrency(currency: string): void {
  commonCurrency.value = currency;
  commonCurrencySheetOpen.value = false;
}

function saveTimeZone(zone: string): void {
  timeZone.value = zone;
  timeZoneSheetOpen.value = false;
}

async function loadMembers(): Promise<void> {
  loading.value = true;
  screenError.value = '';
  try {
    const response = await fetch('/api/members');
    if (response.status === 401) {
      setAuthState(null);
      await router.replace('/sign-in');
      return;
    }
    if (!response.ok) throw new Error('Could not load profiles. Try again.');
    members.value = membersResponseSchema.parse(await response.json()).members;
  } catch {
    screenError.value =
      'Could not load profiles. Check your connection and try again.';
  } finally {
    loading.value = false;
  }
}

function openAddProfile(): void {
  selectedMember.value = null;
  memberName.value = '';
  memberError.value = '';
  screenError.value = '';
  editorMode.value = 'add';
}

function openMember(member: ManagedMember): void {
  selectedMember.value = member;
  memberName.value = member.name;
  memberError.value = '';
  screenError.value = '';
  editorMode.value = 'edit';
}

function closeMemberEditor(): void {
  if (memberBusy.value) return;
  editorMode.value = null;
  memberError.value = '';
}

async function saveMember(): Promise<void> {
  if (memberBusy.value) return;
  const name = memberName.value.trim();
  if (!name) {
    memberError.value = 'Enter a profile name.';
    return;
  }

  memberBusy.value = true;
  memberError.value = '';
  const mode = editorMode.value;
  const memberId = selectedMember.value?.id;
  try {
    const response = await fetch(
      mode === 'add' ? '/api/members' : `/api/members/${memberId}`,
      {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    );
    if (!response.ok) {
      const error = await readApiError(response);
      memberError.value = error.fields?.name ?? error.message;
      return;
    }
    memberResponseSchema.parse(await response.json());
    editorMode.value = null;
    await syncProfilesAfterChange();
  } catch {
    memberError.value =
      'Could not save the profile. Check your connection and try again.';
  } finally {
    memberBusy.value = false;
  }
}

function askToDeactivate(): void {
  if (memberBusy.value || !selectedMember.value) return;
  deactivateError.value = '';
  editorMode.value = null;
  deactivateConfirmationOpen.value = true;
}

function cancelDeactivation(): void {
  if (memberBusy.value) return;
  deactivateConfirmationOpen.value = false;
  deactivateError.value = '';
}

async function deactivateMember(): Promise<void> {
  const member = selectedMember.value;
  if (!member || memberBusy.value) return;
  memberBusy.value = true;
  deactivateError.value = '';
  try {
    const response = await fetch(`/api/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    if (!response.ok) {
      const error = await readApiError(response);
      deactivateError.value = error.message;
      return;
    }
    memberResponseSchema.parse(await response.json());
    deactivateConfirmationOpen.value = false;
    await syncProfilesAfterChange();
  } catch {
    deactivateError.value =
      'Could not deactivate the profile. Check your connection and try again.';
  } finally {
    memberBusy.value = false;
  }
}

async function reactivateMember(): Promise<void> {
  const member = selectedMember.value;
  if (!member || memberBusy.value) return;
  memberBusy.value = true;
  memberError.value = '';
  try {
    const response = await fetch(`/api/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    if (!response.ok) {
      const error = await readApiError(response);
      memberError.value = error.fields?.name ?? error.message;
      return;
    }
    memberResponseSchema.parse(await response.json());
    editorMode.value = null;
    await syncProfilesAfterChange();
  } catch {
    memberError.value =
      'Could not reactivate the profile. Check your connection and try again.';
  } finally {
    memberBusy.value = false;
  }
}

async function syncProfilesAfterChange(): Promise<void> {
  try {
    const state = await refreshAuthState();
    if (!state?.member) {
      await router.replace('/sign-in');
      return;
    }
    await loadMembers();
  } catch {
    screenError.value =
      'Your profile change was saved, but Settings could not refresh. Check your connection and try again.';
  }
}

function openPasswordSheet(): void {
  currentPassword.value = '';
  newPassword.value = '';
  passwordErrors.value = { currentPassword: '', newPassword: '' };
  passwordError.value = '';
  passwordChanged.value = false;
  passwordSheetOpen.value = true;
}

function closePasswordSheet(): void {
  if (passwordBusy.value) return;
  passwordSheetOpen.value = false;
  passwordError.value = '';
}

async function changePassword(): Promise<void> {
  if (passwordBusy.value) return;
  passwordErrors.value = { currentPassword: '', newPassword: '' };
  passwordError.value = '';
  if (!currentPassword.value) {
    passwordErrors.value.currentPassword = 'Enter the current password.';
  }
  if (newPassword.value.length < 10) {
    passwordErrors.value.newPassword = 'Use at least 10 characters.';
  }
  if (
    passwordErrors.value.currentPassword ||
    passwordErrors.value.newPassword
  ) {
    return;
  }

  passwordBusy.value = true;
  try {
    const response = await fetch('/api/family/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    });
    if (!response.ok) {
      const error = await readApiError(response);
      passwordErrors.value = {
        currentPassword: error.fields?.currentPassword ?? '',
        newPassword: error.fields?.newPassword ?? '',
      };
      passwordError.value =
        passwordErrors.value.currentPassword || passwordErrors.value.newPassword
          ? ''
          : error.message;
      return;
    }
    changeFamilyPasswordResponseSchema.parse(await response.json());
    passwordSheetOpen.value = false;
    passwordChanged.value = true;
    currentPassword.value = '';
    newPassword.value = '';
  } catch {
    passwordError.value =
      'Could not change the password. Check your connection and try again.';
  } finally {
    passwordBusy.value = false;
  }
}

async function signOut(): Promise<void> {
  if (signOutBusy.value) return;
  signOutBusy.value = true;
  screenError.value = '';
  try {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error('Sign-out failed.');
    setAuthState(null);
    await router.replace('/sign-in');
  } catch {
    screenError.value =
      'Could not sign out. Check your connection and try again.';
  } finally {
    signOutBusy.value = false;
  }
}

function clearPasswordError(field: 'currentPassword' | 'newPassword'): void {
  passwordErrors.value[field] = '';
  passwordError.value = '';
}

async function readApiError(response: Response): Promise<{
  message: string;
  fields?: Record<string, string>;
}> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; fields?: Record<string, string> };
    };
    return {
      message: body.error?.message ?? 'Something went wrong. Try again.',
      ...(body.error?.fields ? { fields: body.error.fields } : {}),
    };
  } catch {
    return { message: 'Something went wrong. Try again.' };
  }
}
</script>

<template>
  <main class="screen app-screen settings-screen">
    <header class="topbar">
      <BbBackButton :label="backLabel" @click="goBack" />
      <h1 class="t-title">Settings</h1>
    </header>

    <div class="content app-content settings-content">
      <section
        class="settings-section"
        aria-labelledby="settings-profiles-heading"
      >
        <h2 id="settings-profiles-heading" class="h">Profiles</h2>
        <BbListCard>
          <p v-if="loading" class="settings-card-message" role="status">
            Loading profiles…
          </p>
          <template v-else>
            <BbRow
              v-for="member in members"
              :key="member.id"
              interactive
              :aria-label="`${member.name}${member.active ? '' : ', inactive'}`"
              :subtitle="
                member.active && defaultMemberId === member.id
                  ? `Default on ${deviceLabel}`
                  : member.active
                    ? ''
                    : 'Inactive'
              "
              @click="openMember(member)"
            >
              <template #title>
                <span class="settings-row-title">{{ member.name }}</span>
              </template>
            </BbRow>
            <BbRow
              interactive
              class="settings-add-profile"
              aria-label="Add profile"
              @click="openAddProfile"
            >
              <template #title> + Add profile </template>
            </BbRow>
          </template>
        </BbListCard>
      </section>

      <section
        class="settings-section"
        aria-labelledby="settings-signin-heading"
      >
        <h2 id="settings-signin-heading" class="h">Sign-in</h2>
        <BbListCard>
          <BbRow
            title="Family password"
            subtitle="One password for everyone"
            value="Change"
            interactive
            aria-haspopup="dialog"
            @click="openPasswordSheet"
          >
            <template #title>
              <span class="settings-row-title">Family password</span>
            </template>
          </BbRow>
          <BbRow
            title="Unlock with Face ID"
            value="—"
            :subtitle="`On ${deviceLabel}, instead of the password`"
          />
        </BbListCard>
        <p v-if="passwordChanged" class="settings-notice" role="status">
          Family password changed.
        </p>
      </section>

      <section
        class="settings-section"
        aria-labelledby="settings-checkin-heading"
      >
        <h2 id="settings-checkin-heading" class="h">Check-in</h2>
        <BbListCard>
          <BbRow title="Schedule" value="—" />
          <BbRow
            title="Follow-up reminders"
            subtitle="To profiles with accounts left"
            value="—"
          />
        </BbListCard>
      </section>

      <section
        class="settings-section"
        aria-labelledby="settings-money-heading"
      >
        <h2 id="settings-money-heading" class="h">Money</h2>
        <BbListCard>
          <BbRow
            title="Common currency"
            subtitle="Totals across currencies"
            :value="moneySettingsLoading ? '—' : commonCurrency"
            interactive
            aria-haspopup="dialog"
            :disabled="moneySettingsLoading || Boolean(moneySettingsError)"
            @click="showCommonCurrencySheet"
          />
          <BbRow
            title="Currencies and coins"
            :value="moneySettingsLoading ? '—' : coinListSummary"
            interactive
            aria-haspopup="dialog"
            :disabled="moneySettingsLoading || Boolean(moneySettingsError)"
            @click="coinsSheetOpen = true"
          />
          <BbRow title="Exchange rates" value="—" />
          <BbRow
            title="Time zone"
            :value="moneySettingsLoading ? '—' : timeZone"
            interactive
            aria-haspopup="dialog"
            :disabled="moneySettingsLoading || Boolean(moneySettingsError)"
            @click="timeZoneSheetOpen = true"
          />
        </BbListCard>
        <p
          v-if="moneySettingsError"
          class="error settings-screen-error"
          role="alert"
        >
          {{ moneySettingsError }}
          <button class="text-btn" type="button" @click="loadMoneySettings">
            Try again
          </button>
        </p>
      </section>

      <section
        class="settings-section"
        aria-labelledby="settings-device-heading"
      >
        <h2 id="settings-device-heading" class="h">This device</h2>
        <BbListCard>
          <BbRow
            title="Notifications"
            subtitle="Off · the in-app banner still shows"
            value="—"
          />
          <BbRow
            title="Hide amounts on Home"
            subtitle="Tap the eye to show them for 30 s"
            value="—"
          />
          <BbRow
            title="Sign out"
            interactive
            :disabled="signOutBusy"
            @click="signOut"
          />
        </BbListCard>
      </section>

      <section class="settings-section" aria-labelledby="settings-data-heading">
        <h2 id="settings-data-heading" class="h">Data</h2>
        <BbListCard>
          <BbRow title="Backup" value="—" />
          <BbRow
            title="Export all data"
            subtitle="CSV files in one .zip"
            value="—"
          />
        </BbListCard>
      </section>

      <p v-if="screenError" class="error settings-screen-error" role="alert">
        {{ screenError }}
        <button class="text-btn" type="button" @click="loadMembers">
          Try again
        </button>
      </p>
      <p class="settings-footer">
        Budget Buddy · runs on your Mac mini · only reachable in your Tailscale
        network
      </p>
    </div>

    <BbSheet v-if="editorMode" :title="editorTitle" @close="closeMemberEditor">
      <form class="settings-sheet-form" @submit.prevent="saveMember">
        <label class="settings-field">
          <span class="lbl">Profile name</span>
          <input
            v-model="memberName"
            class="text"
            type="text"
            autocomplete="off"
            aria-label="Profile name"
            :aria-invalid="Boolean(memberError)"
            @input="memberError = ''"
          />
        </label>
        <p v-if="memberError" class="error settings-form-error" role="alert">
          {{ memberError }}
        </p>
        <BbButton type="submit" :disabled="memberBusy">
          {{ editorMode === 'add' ? 'Add profile' : 'Save profile' }}
        </BbButton>
      </form>
      <div v-if="editorMode === 'edit'" class="settings-sheet-actions">
        <BbButton
          v-if="selectedMember?.active"
          variant="secondary"
          class="danger"
          :disabled="memberBusy"
          @click="askToDeactivate"
        >
          Deactivate profile
        </BbButton>
        <BbButton
          v-else
          variant="secondary"
          :disabled="memberBusy"
          @click="reactivateMember"
        >
          Reactivate profile
        </BbButton>
      </div>
    </BbSheet>

    <BbSheet
      v-if="deactivateConfirmationOpen"
      title="Deactivate this profile?"
      @close="cancelDeactivation"
    >
      <p class="t-sub settings-password-copy">
        Their accounts and history will stay. This profile can’t be opened until
        it’s reactivated.
      </p>
      <p v-if="deactivateError" class="error settings-form-error" role="alert">
        {{ deactivateError }}
      </p>
      <div class="settings-sheet-actions">
        <BbButton
          variant="secondary"
          class="danger"
          :disabled="memberBusy"
          @click="deactivateMember"
        >
          Deactivate profile
        </BbButton>
        <BbButton
          variant="text"
          :disabled="memberBusy"
          @click="cancelDeactivation"
        >
          Keep profile active
        </BbButton>
      </div>
    </BbSheet>

    <BbSheet
      v-if="passwordSheetOpen"
      title="Change family password"
      @close="closePasswordSheet"
    >
      <form class="settings-sheet-form" @submit.prevent="changePassword">
        <p class="t-sub settings-password-copy">
          Everyone uses the new one. Other phones and iPads are signed out and
          ask for it next time.
        </p>
        <label class="settings-field">
          <span class="lbl">Current password</span>
          <input
            v-model="currentPassword"
            class="pw"
            type="password"
            autocomplete="current-password"
            aria-label="Current password"
            :aria-invalid="Boolean(passwordErrors.currentPassword)"
            @input="clearPasswordError('currentPassword')"
          />
        </label>
        <p
          v-if="passwordErrors.currentPassword"
          class="error settings-form-error"
          role="alert"
        >
          {{ passwordErrors.currentPassword }}
        </p>
        <label class="settings-field">
          <span class="lbl">New password</span>
          <input
            v-model="newPassword"
            class="pw"
            type="password"
            autocomplete="new-password"
            aria-label="New password"
            :aria-invalid="Boolean(passwordErrors.newPassword)"
            @input="clearPasswordError('newPassword')"
          />
        </label>
        <p
          v-if="passwordErrors.newPassword"
          class="error settings-form-error"
          role="alert"
        >
          {{ passwordErrors.newPassword }}
        </p>
        <p v-if="passwordError" class="error settings-form-error" role="alert">
          {{ passwordError }}
        </p>
        <BbButton type="submit" :disabled="passwordBusy">
          Change password
        </BbButton>
      </form>
    </BbSheet>

    <CommonCurrencySheet
      v-if="commonCurrencySheetOpen"
      :currencies="commonCurrencyOptions"
      :selected="commonCurrency"
      @saved="saveCommonCurrency"
      @close="commonCurrencySheetOpen = false"
    />
    <CoinsSheet
      v-if="coinsSheetOpen"
      :coins="coins"
      @saved="loadMoneySettings"
      @close="coinsSheetOpen = false"
    />
    <TimeZoneSheet
      v-if="timeZoneSheetOpen"
      :selected="timeZone"
      @saved="saveTimeZone"
      @close="timeZoneSheetOpen = false"
    />
  </main>
</template>
