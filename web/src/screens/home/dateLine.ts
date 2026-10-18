import { ref } from 'vue';

/**
 * True while Home shows its limited form (UI-HOME-7). `App.vue` leaves out
 * its offline strip then, since the form says "Offline" itself.
 */
export const limitedHomeShown = ref(false);

/** "Monday, 5 October" for a `YYYY-MM-DD` date. */
export function formatDateLine(today: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${today}T12:00:00Z`));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
}
