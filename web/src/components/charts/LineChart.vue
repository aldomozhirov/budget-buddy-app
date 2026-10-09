<script setup lang="ts">
import { computed } from 'vue';

/** Draws a labelled, accessible SVG line chart for dated account balances. */
defineOptions({ name: 'LineChart' });

const props = defineProps<{
  /** Ordered from oldest to newest, retaining exact minor-unit values. */
  points: { date: string; tick: string; value: bigint; label: string }[];
  /** Accessible summary of the plotted series. */
  summary: string;
}>();

const coordinates = computed(() => {
  if (props.points.length < 2) return '';
  const values = props.points.map((point) => point.value);
  const low = values.reduce((result, value) =>
    value < result ? value : result,
  );
  const high = values.reduce((result, value) =>
    value > result ? value : result,
  );
  const span = high - low || 1n;
  return props.points
    .map((point, index) => {
      const x = (index / (props.points.length - 1)) * 320;
      const y = 108 - Number(((point.value - low) * 9600n) / span) / 100;
      return `${x},${y}`;
    })
    .join(' ');
});

const highPoint = computed(() =>
  props.points.reduce((high, point) =>
    point.value > high.value ? point : high,
  ),
);
const lowPoint = computed(() =>
  props.points.reduce((low, point) => (point.value < low.value ? point : low)),
);
const monthTicks = computed(() => {
  const ticks: { position: number; label: string }[] = [];
  let previous = '';
  props.points.forEach((point, index) => {
    if (point.tick !== previous) {
      ticks.push({
        position:
          props.points.length < 2
            ? 0
            : (index / (props.points.length - 1)) * 100,
        label: point.tick,
      });
      previous = point.tick;
    }
  });
  return ticks;
});
</script>

<template>
  <div class="line-chart">
    <svg
      v-if="points.length > 1"
      class="chart-svg"
      viewBox="0 0 320 120"
      preserveAspectRatio="none"
      role="img"
      :aria-label="summary"
    >
      <polyline :points="coordinates" />
    </svg>
    <p v-else class="chart-empty">Not enough balance history to chart yet.</p>
    <div v-if="points.length > 1" class="chart-extremes">
      <span>High {{ highPoint.label }}</span
      ><span>Low {{ lowPoint.label }}</span>
    </div>
    <div v-if="points.length > 1" class="chart-labels" aria-hidden="true">
      <span>{{ points[0]?.date }}</span
      ><span>{{ points.at(-1)?.date }}</span>
    </div>
    <div v-if="points.length > 1" class="chart-month-ticks" aria-hidden="true">
      <span
        v-for="tick in monthTicks"
        :key="`${tick.position}-${tick.label}`"
        :style="{ left: `${tick.position}%` }"
        >{{ tick.label }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.line-chart {
  min-width: 0;
}
.chart-svg {
  display: block;
  width: 100%;
  height: 120px;
  overflow: visible;
}
.chart-svg polyline {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 1400;
  animation: chart-draw 1.1s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.chart-extremes {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.chart-labels {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 12px;
}
.chart-month-ticks {
  position: relative;
  height: 16px;
  color: var(--muted);
  font-size: 10px;
}
.chart-month-ticks span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.chart-empty {
  margin: 24px 0;
  color: var(--muted);
  text-align: center;
  font-size: 13px;
}
@keyframes chart-draw {
  from {
    stroke-dashoffset: 1400;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chart-svg polyline {
    animation: none;
  }
}
</style>
