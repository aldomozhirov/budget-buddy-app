<script setup lang="ts">
import type { Component } from 'vue';
import {
  ArrowLeftRight,
  CalendarCheck,
  CalendarDays,
  ChartColumnIncreasing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  CircleDot,
  Eye,
  EyeOff,
  FileChartColumnIncreasing,
  Mail,
  Plus,
  Receipt,
  ReceiptText,
  ScanFace,
  Search,
  SlidersHorizontal,
  StickyNote,
  Store,
  Tag,
  UserRound,
  WalletCards,
  WifiOff,
  X,
} from 'lucide-vue-next';

/** Icon component per BbIconName except the custom Budget Buddy app mark. */
const icons = {
  back: ChevronLeft,
  forward: ChevronRight,
  down: ChevronDown,
  up: ChevronUp,
  close: X,
  check: Check,
  plus: Plus,
  search: Search,
  eye: Eye,
  'eye-off': EyeOff,
  checkin: CalendarCheck,
  income: CircleDollarSign,
  transfer: ArrowLeftRight,
  transactions: ReceiptText,
  envelope: Mail,
  account: WalletCards,
  calendar: CalendarDays,
  chart: ChartColumnIncreasing,
  tag: Tag,
  reports: FileChartColumnIncreasing,
  settings: SlidersHorizontal,
  person: UserRound,
  note: StickyNote,
  merchant: Store,
  offline: WifiOff,
  record: CircleDot,
  receipt: Receipt,
  faceid: ScanFace,
} satisfies Record<Exclude<BbIconName, 'wallet'>, Component>;

/** Names of the icons available to BbIcon. */
export type BbIconName =
  | 'back'
  | 'forward'
  | 'down'
  | 'up'
  | 'close'
  | 'check'
  | 'plus'
  | 'search'
  | 'eye'
  | 'eye-off'
  | 'checkin'
  | 'income'
  | 'transfer'
  | 'transactions'
  | 'envelope'
  | 'account'
  | 'calendar'
  | 'chart'
  | 'tag'
  | 'reports'
  | 'settings'
  | 'person'
  | 'note'
  | 'merchant'
  | 'offline'
  | 'record'
  | 'receipt'
  | 'faceid'
  | 'wallet';

/**
 * Decorative icon from the app's Lucide-based set. It is hidden from
 * assistive technology, so an icon-only control needs its own `aria-label`.
 */
withDefaults(
  defineProps<{
    name: BbIconName;
    /** Width and height in pixels. */
    size?: number;
    strokeWidth?: number;
  }>(),
  { size: 20, strokeWidth: 2 },
);

defineOptions({ inheritAttrs: false });
</script>

<template>
  <svg
    v-if="name === 'wallet'"
    v-bind="$attrs"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M15.5 14.5H18M7 6V4.5h10V6" />
  </svg>
  <component
    :is="icons[name]"
    v-else
    v-bind="$attrs"
    :size="size"
    :stroke-width="strokeWidth"
    aria-hidden="true"
    focusable="false"
  />
</template>
