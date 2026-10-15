<script setup lang="ts">
import { computed } from 'vue';

/**
 * Draws a labelled, accessible SVG bar chart: one bar per month and a dashed
 * line for the limit. Bars above the limit are in the warning colour and the
 * outlined one is the month that is still open (UI-ENV-4). Bars grow in when
 * the chart opens, and not with reduced motion (UI-MOT-2).
 */
defineOptions({ name: 'BarChart' });

/** Height of the plot in pixels. */
const HEIGHT = 132;

/** One bar, with the text that names it. */
export interface BarChartBar {
  /** Short label under the bar, e.g. "Sep". */
  label: string;
  /** Spent in the month, in minor units. */
  value: bigint;
  /** Hover and screen reader text, e.g. "Sep: €541.00". */
  title: string;
  /** The month is still open: outlined, not counted as over. */
  current?: boolean;
}

const props = defineProps<{
  /** Oldest first. */
  bars: BarChartBar[];
  /** The limit each bar is compared with, in minor units. */
  limit: bigint;
  /** The limit as shown in the legend, e.g. "€500.00 limit". */
  limitLabel: string;
  /** Accessible summary of the whole chart. */
  summary: string;
}>();

/** The largest value on the scale, with room above the tallest bar. */
const scale = computed(() => {
  const tallest = props.bars.reduce(
    (high, bar) => (bar.value > high ? bar.value : high),
    props.limit,
  );
  return tallest > 0n ? (tallest * 12n) / 10n : 1n;
});

/** Pixel height of a value; negative values (refunds) draw no bar. */
function height(value: bigint): number {
  if (value <= 0n) return 0;
  return (Number((value * 10000n) / scale.value) / 10000) * HEIGHT;
}

const slot = computed(() => 100 / Math.max(props.bars.length, 1));
const limitY = computed(() => HEIGHT - height(props.limit));
const columns = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(props.bars.length, 1)}, minmax(0, 1fr))`,
}));
</script>

<template>
  <figure class="bar-chart">
    <figcaption class="bar-chart-head">
      <span class="bar-chart-title">Spent per month</span>
      <span class="bar-chart-limit t-sub">
        <span class="bar-chart-dash" aria-hidden="true" />{{ limitLabel }}
      </span>
    </figcaption>
    <svg
      class="bar-chart-plot"
      :height="HEIGHT"
      role="img"
      :aria-label="summary"
    >
      <rect
        v-for="(bar, index) in bars"
        :key="index"
        class="bar bar-chart-bar"
        :class="{
          'bar-chart-over': !bar.current && bar.value > limit,
          'bar-chart-current': bar.current,
        }"
        :x="`${index * slot + slot * 0.12}%`"
        :width="`${slot * 0.76}%`"
        :y="HEIGHT - height(bar.value)"
        :height="height(bar.value) + 6"
        rx="6"
      >
        <title>{{ bar.title }}</title>
      </rect>
      <line
        class="bar-chart-limit-line"
        x1="0"
        x2="100%"
        :y1="limitY"
        :y2="limitY"
      />
    </svg>
    <div class="bar-chart-labels t-sub" :style="columns" aria-hidden="true">
      <span v-for="(bar, index) in bars" :key="index">{{ bar.label }}</span>
    </div>
  </figure>
</template>

<style scoped>
.bar-chart {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bar-chart-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.bar-chart-title {
  font-size: 15px;
  font-weight: 600;
}
.bar-chart-limit {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.bar-chart-dash {
  display: inline-block;
  width: 14px;
  border-top: 2px dashed var(--muted);
}
.bar-chart-plot {
  display: block;
  width: 100%;
  overflow: hidden;
  border-bottom: 1px solid var(--line);
}
.bar-chart-bar {
  fill: var(--accent);
  /* The bars are SVG shapes, so they scale from their own bottom edge. */
  transform-box: fill-box;
  transform-origin: bottom;
}
.bar-chart-over {
  fill: var(--warn);
}
.bar-chart-current {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.bar-chart-limit-line {
  stroke: var(--muted);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0.55;
}
.bar-chart-labels {
  display: grid;
  gap: 0;
  font-size: 12px;
  text-align: center;
}
</style>
