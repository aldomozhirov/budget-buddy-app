<script setup lang="ts">
import type { Component } from 'vue';
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  ChartColumnIncreasing,
  Check,
  ChevronDown,
  ChevronLeft,
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
  Settings,
  StickyNote,
  Store,
  Tag,
  UserRound,
  Wallet,
  WalletCards,
  WifiOff,
  X,
} from 'lucide-vue-next';

const icons = {
  back: ChevronLeft,
  forward: ArrowRight,
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
  settings: Settings,
  person: UserRound,
  note: StickyNote,
  merchant: Store,
  offline: WifiOff,
  record: CircleDot,
  receipt: Receipt,
  faceid: ScanFace,
  wallet: Wallet,
} satisfies Record<BbIconName, Component>;

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

withDefaults(
  defineProps<{
    name: BbIconName;
    size?: number;
    strokeWidth?: number;
  }>(),
  { size: 20, strokeWidth: 2 },
);

defineOptions({ inheritAttrs: false });
</script>

<template>
  <component
    :is="icons[name]"
    v-bind="$attrs"
    :size="size"
    :stroke-width="strokeWidth"
    aria-hidden="true"
    focusable="false"
  />
</template>
