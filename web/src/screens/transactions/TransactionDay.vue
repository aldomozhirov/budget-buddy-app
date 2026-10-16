<script setup lang="ts">
/**
 * One day of the list: its date and total over a card of rows. Slot `top`:
 * what sits at the top of the day outside its total (items waiting to send,
 * UI-TXN-9). Default slot: the day's rows.
 */
defineProps<{
  /** "Today" or "Sun 4 Oct". */
  heading: string;
  /** "€92.35 spent"; empty when the day has no total to show. */
  total: string;
}>();
</script>

<template>
  <section class="transaction-day">
    <div class="day-head t-sub">
      <h2 class="day-title">{{ heading }}</h2>
      <span class="num">{{ total }}</span>
    </div>
    <div class="card">
      <slot name="top" />
      <slot />
    </div>
  </section>
</template>

<style scoped>
.transaction-day {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.day-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
}
.day-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}
</style>
