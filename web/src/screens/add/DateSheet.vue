<script setup lang="ts">
import { computed, ref } from 'vue';
import BbChip from '../../components/BbChip.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';
import { dateParts, dayLabel, isoDate, shiftDate, weekday } from './addForm.js';

/**
 * The date sheet (UI-ADD-6, UI-NAV-7): "Today", "Yesterday" and the day
 * before as chips, then a month calendar, Monday first, with future days
 * and days before 2000 disabled. One pick closes it.
 */
const props = defineProps<{
  /** The picked date, YYYY-MM-DD. */
  date: string;
  /** Today in the family time zone, YYYY-MM-DD. */
  today: string;
}>();

const emit = defineEmits<{
  /** A day was picked. */
  pick: [date: string];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const FIRST_DAY = '2000-01-01';
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const shown = ref(
  (() => {
    const { year, month } = dateParts(props.date);
    return { year, month };
  })(),
);

const quick = computed(() =>
  [0, -1, -2]
    .map((days) => shiftDate(props.today, days))
    .filter((date) => date >= FIRST_DAY)
    .map((date) => ({ date, label: dayLabel(date, props.today) })),
);

const title = computed(
  () => `${MONTH_NAMES[shown.value.month - 1]} ${shown.value.year}`,
);

const days = computed(() => {
  const { year, month } = shown.value;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Monday first: Sunday (0) becomes the seventh column.
  const lead = (weekday(isoDate(year, month, 1)) + 6) % 7;
  const cells: { date: string; day: number }[] = [];
  for (let day = 1; day <= count; day += 1) {
    cells.push({ date: isoDate(year, month, day), day });
  }
  return { lead, cells };
});

const canGoBack = computed(
  () => isoDate(shown.value.year, shown.value.month, 1) > FIRST_DAY,
);
const canGoForward = computed(() => {
  const { year, month } = dateParts(props.today);
  return shown.value.year * 12 + shown.value.month < year * 12 + month;
});

function move(months: number): void {
  const index = shown.value.year * 12 + shown.value.month - 1 + months;
  shown.value = { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function dayName(date: string): string {
  const { year, month, day } = dateParts(date);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}
</script>

<template>
  <BbSheet title="Date" @close="emit('close')">
    <div class="date-quick">
      <BbChip
        v-for="item in quick"
        :key="item.date"
        :selected="item.date === date"
        @click="emit('pick', item.date)"
        >{{ item.label }}</BbChip
      >
    </div>
    <div class="date-month">
      <button
        class="icon-btn date-nav"
        type="button"
        aria-label="Previous month"
        :disabled="!canGoBack"
        @click="move(-1)"
      >
        <BbIcon name="back" :size="20" />
      </button>
      <span class="date-title" aria-live="polite">{{ title }}</span>
      <button
        class="icon-btn date-nav"
        type="button"
        aria-label="Next month"
        :disabled="!canGoForward"
        @click="move(1)"
      >
        <BbIcon name="forward" :size="20" />
      </button>
    </div>
    <div class="cal" aria-hidden="true">
      <span
        v-for="name in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']"
        :key="name"
        class="cal-wd"
        >{{ name }}</span
      >
    </div>
    <div class="cal" role="group" :aria-label="title">
      <span v-for="blank in days.lead" :key="`blank-${blank}`" />
      <button
        v-for="cell in days.cells"
        :key="cell.date"
        class="day"
        type="button"
        :aria-label="dayName(cell.date)"
        :aria-pressed="cell.date === date"
        :disabled="cell.date > today || cell.date < '2000-01-01'"
        @click="emit('pick', cell.date)"
      >
        {{ cell.day }}
      </button>
    </div>
  </BbSheet>
</template>

<style scoped>
.date-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.date-month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}
.date-title {
  font-weight: 600;
}
.date-nav {
  background: transparent;
}
.date-nav:disabled {
  opacity: 0.3;
}
</style>
