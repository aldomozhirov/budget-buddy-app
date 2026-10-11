<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  formatSlotDay,
  formatSlotTime,
  nextCadenceSlot,
  sameCadenceSetting,
  settingsResponseSchema,
  todayInTimeZone,
  weekdayNames,
  type CadenceSetting,
  type SettingsResponse,
} from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbSegmented from '../../components/BbSegmented.vue';
import BbSheet from '../../components/BbSheet.vue';

/**
 * Bottom sheet for the family's check-in schedule (CHK-2, UI-SET-2): Off,
 * Monthly on a day or the last day, or Every N weeks on a weekday, with a
 * time and a preview of the next check-in. "Done" saves; Close discards.
 */
const props = defineProps<{
  /** The saved cadence the sheet starts from. */
  cadence: CadenceSetting;
  /** Family time zone, for the preview of the next check-in. */
  timeZone: string;
  /** The server's next slot for the saved cadence, or null when off. */
  nextSlot: string | null;
}>();

const emit = defineEmits<{
  /** The schedule was saved; carries the settings the server returned. */
  saved: [settings: SettingsResponse];
  /** The sheet was dismissed without saving. */
  close: [];
}>();

const standardTimes = ['08:00', '09:00', '12:00', '19:00'];
const days = Array.from({ length: 28 }, (_, index) => index + 1);
const weekCounts = Array.from({ length: 8 }, (_, index) => index + 1);
const kinds = [
  { label: 'Off', value: 'off' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Every N weeks', value: 'weeks' },
];

const initial = props.cadence;
const kind = ref<CadenceSetting['kind']>(initial.kind);
const day = ref<number | 'last'>(initial.kind === 'monthly' ? initial.day : 1);
const every = ref(initial.kind === 'weeks' ? initial.every : 2);
const weekday = ref(initial.kind === 'weeks' ? initial.weekday : 1);
const time = ref(initial.kind === 'off' ? '09:00' : initial.time);
const busy = ref(false);
const error = ref('');

/** The usual times, plus a saved time that is not one of them. */
const times = computed(() =>
  standardTimes.includes(time.value)
    ? standardTimes
    : [...standardTimes, time.value].sort(),
);

/** The cadence as currently chosen in the sheet. */
const chosen = computed<CadenceSetting>(() => {
  if (kind.value === 'monthly') {
    return { kind: 'monthly', day: day.value, time: time.value };
  }
  if (kind.value === 'weeks') {
    return {
      kind: 'weeks',
      every: every.value,
      weekday: weekday.value,
      time: time.value,
    };
  }
  return { kind: 'off' };
});

const preview = computed(() => {
  if (chosen.value.kind === 'off') {
    return 'No check-in opens by itself. Start one from Check-ins.';
  }
  // Saving the same cadence changes nothing on the server, which keeps the
  // day it counts "every N weeks" from: show its slot, not one from today.
  const saved = sameCadenceSetting(chosen.value, props.cadence);
  let nextKey = saved ? props.nextSlot : null;
  if (nextKey === null) {
    const now = new Date();
    // A changed cadence counts "every N weeks" from the day it is saved.
    nextKey =
      nextCadenceSlot(
        chosen.value,
        todayInTimeZone(now, props.timeZone),
        now,
        props.timeZone,
      )?.key ?? null;
  }
  const next = nextKey === null ? undefined : { key: nextKey };
  if (!next) return '';
  return `Next check-in opens on ${formatSlotDay(next.key)} at ${formatSlotTime(next.key)}. Everyone gets a notification.`;
});

function chooseKind(value: string | number): void {
  kind.value = value as CadenceSetting['kind'];
  error.value = '';
}

function close(): void {
  if (!busy.value) emit('close');
}

async function save(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cadence: chosen.value }),
    });
    if (!response.ok) {
      error.value = 'Could not save the schedule. Try again.';
      return;
    }
    emit('saved', settingsResponseSchema.parse(await response.json()));
  } catch {
    error.value =
      'Could not save the schedule. Check your connection and try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BbSheet title="Check-in schedule" @close="close">
    <BbSegmented
      :model-value="kind"
      :options="kinds"
      label="Repeat"
      @update:model-value="chooseKind"
    />

    <div v-if="kind === 'monthly'" class="schedule-group">
      <span id="schedule-day-label" class="lbl">Day of the month</span>
      <div
        class="schedule-grid schedule-days"
        role="group"
        aria-labelledby="schedule-day-label"
      >
        <BbChip
          v-for="option in days"
          :key="option"
          :selected="day === option"
          @click="day = option"
        >
          {{ option }}
        </BbChip>
        <BbChip
          class="schedule-last"
          :selected="day === 'last'"
          @click="day = 'last'"
        >
          Last day
        </BbChip>
      </div>
    </div>

    <template v-if="kind === 'weeks'">
      <div class="schedule-group">
        <span id="schedule-weeks-label" class="lbl"
          >Weeks between check-ins</span
        >
        <div
          class="schedule-grid schedule-weeks"
          role="group"
          aria-labelledby="schedule-weeks-label"
        >
          <BbChip
            v-for="option in weekCounts"
            :key="option"
            :selected="every === option"
            @click="every = option"
          >
            {{ option }}
          </BbChip>
        </div>
      </div>
      <div class="schedule-group">
        <span id="schedule-weekday-label" class="lbl">Weekday</span>
        <div
          class="schedule-grid schedule-days"
          role="group"
          aria-labelledby="schedule-weekday-label"
        >
          <BbChip
            v-for="(name, index) in weekdayNames"
            :key="name"
            :aria-label="name"
            :selected="weekday === index + 1"
            @click="weekday = index + 1"
          >
            {{ name.slice(0, 3) }}
          </BbChip>
        </div>
      </div>
    </template>

    <div v-if="kind !== 'off'" class="schedule-group">
      <span id="schedule-time-label" class="lbl">Time</span>
      <div
        class="schedule-times"
        role="group"
        aria-labelledby="schedule-time-label"
      >
        <BbChip
          v-for="option in times"
          :key="option"
          :selected="time === option"
          @click="time = option"
        >
          {{ option }}
        </BbChip>
      </div>
    </div>

    <p class="num schedule-preview" role="status">{{ preview }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <BbButton :disabled="busy" :aria-busy="busy" @click="save">Done</BbButton>
  </BbSheet>
</template>

<style scoped>
.schedule-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.schedule-grid {
  display: grid;
  gap: 6px;
}

.schedule-days {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.schedule-weeks {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.schedule-grid :deep(.chip-target) {
  min-width: 0;
  width: 100%;
}

.schedule-grid :deep(.chip) {
  width: 100%;
  min-width: 0;
  padding: 0;
  justify-content: center;
}

.schedule-grid .schedule-last {
  grid-column: 1 / -1;
}

.schedule-times {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.schedule-preview {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bg);
  font-size: 14px;
}

/* The design puts the chips on the page colour: the sheet itself is white. */
.schedule-group :deep(.chip:not(.chip-on)) {
  background: var(--bg);
}
</style>
