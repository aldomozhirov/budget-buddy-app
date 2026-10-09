<script setup lang="ts">
import { computed, ref } from 'vue';
import { settingsResponseSchema } from '@budget-buddy/shared';
import { Search } from 'lucide-vue-next';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import BbSheet from '../../components/BbSheet.vue';

/** Searchable bottom-sheet picker for the family's IANA time zone. */
const props = defineProps<{
  /** Currently selected IANA time zone. */
  selected: string;
}>();

const emit = defineEmits<{
  /** The family setting was saved. */
  saved: [timeZone: string];
  /** The picker was dismissed without saving. */
  close: [];
}>();

const timeZones = [...Intl.supportedValuesOf('timeZone'), 'UTC'];
const search = ref('');
const busy = ref(false);
const error = ref('');
const filteredTimeZones = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const candidates = timeZones.includes(props.selected)
    ? timeZones
    : [props.selected, ...timeZones];
  return candidates.filter((timeZone) =>
    timeZone.toLowerCase().includes(needle),
  );
});

async function chooseTimeZone(timeZone: string): Promise<void> {
  if (busy.value) return;
  if (timeZone === props.selected) {
    emit('saved', timeZone);
    return;
  }

  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeZone }),
    });
    if (!response.ok) {
      error.value = await readError(response);
      return;
    }
    const settings = settingsResponseSchema.parse(await response.json());
    emit('saved', settings.timeZone);
  } catch {
    error.value =
      'Could not save the time zone. Check your connection and try again.';
  } finally {
    busy.value = false;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; fields?: Record<string, string> };
    };
    return (
      body.error?.fields?.timeZone ??
      body.error?.message ??
      'Could not save the time zone. Try again.'
    );
  } catch {
    return 'Could not save the time zone. Try again.';
  }
}
</script>

<template>
  <BbSheet title="Time zone" @close="emit('close')">
    <label class="settings-field">
      <span class="lbl">Search time zones</span>
      <div class="input-wrap">
        <Search :size="18" aria-hidden="true" />
        <input
          v-model="search"
          class="search"
          type="search"
          aria-label="Search time zones"
          placeholder="City or region"
        />
      </div>
    </label>
    <p v-if="error" class="error settings-form-error" role="alert">
      {{ error }}
    </p>
    <p
      v-if="filteredTimeZones.length === 0"
      class="t-sub settings-money-empty"
      role="status"
    >
      No time zones found.
    </p>
    <BbListCard v-else label="Choose time zone" class="settings-picker-list">
      <BbRow
        v-for="timeZone in filteredTimeZones"
        :key="timeZone"
        interactive
        :aria-pressed="timeZone === selected"
        :aria-label="timeZone"
        :disabled="busy"
        @click="chooseTimeZone(timeZone)"
      >
        <template #title>
          <span class="settings-picker-title">{{ timeZone }}</span>
        </template>
        <template #trailing>
          <span v-if="timeZone === selected" class="settings-picker-selected">
            Selected
          </span>
        </template>
      </BbRow>
    </BbListCard>
    <BbButton variant="text" :disabled="busy" @click="emit('close')">
      Close
    </BbButton>
  </BbSheet>
</template>
