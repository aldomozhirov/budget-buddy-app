<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  linkCandidatesResponseSchema,
  type LinkCandidate,
} from '@budget-buddy/shared';
import BbIcon from './BbIcon.vue';
import BbSheet from './BbSheet.vue';
import { ApiError, callApi } from '../api/callApi.js';
import { monthName } from '../screens/envelopes/envelopeFormat.js';
import { shortDay } from '../screens/wishes/wishesFormat.js';

/**
 * "Link an expense" (UI-WSH-6): the month's unplanned expenses, those that
 * fit the wish or envelope first, with a search over merchant, note and
 * amount. One tap picks an expense; the page links it and closes the sheet.
 * Shared by the wish page and the envelope page (UI-ENV-3).
 */
const props = defineProps<{
  /** What the expense will count for: a wish or an envelope. */
  target: { kind: 'wish' | 'envelope'; id: number; name: string };
  /** The target's month, as `2026-10`. */
  month: string;
  /** Formats a minor-unit amount in a currency, with its sign. */
  format: (minor: string, currency: string) => string;
  /** The page is busy linking, or offline: no tap links. */
  disabled: boolean;
}>();

const emit = defineEmits<{
  /** An expense was tapped. */
  pick: [transactionId: number];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();

const SEARCH_DELAY_MS = 250;

const search = ref('');
const candidates = ref<LinkCandidate[]>([]);
const loading = ref(true);
const error = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
/** Orders the answers: a slow, older one is dropped. */
let latest = 0;

const name = computed(() => props.target.name);
const footnote = computed(() =>
  props.target.kind === 'wish'
    ? 'To count one from an envelope, change it on its own page.'
    : 'To move one from another envelope or a wish, change it on its own page.',
);
const month = computed(() => monthName(props.month));
const fitting = computed(() => candidates.value.filter((item) => item.fits));
const others = computed(() => candidates.value.filter((item) => !item.fits));
const searching = computed(() => search.value.trim() !== '');

onMounted(() => void load());
onUnmounted(() => clearTimeout(timer));
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(() => void load(), SEARCH_DELAY_MS);
});

/** Loads the candidates for the words typed so far. */
async function load(): Promise<void> {
  const call = ++latest;
  const q = search.value.trim();
  try {
    const answer = await callApi(
      'GET',
      `/api/${props.target.kind === 'wish' ? 'wishes' : 'envelopes'}/${props.target.id}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      linkCandidatesResponseSchema,
    );
    if (call !== latest) return;
    candidates.value = answer.candidates;
    error.value = '';
  } catch (cause) {
    if (call !== latest) return;
    error.value =
      cause instanceof ApiError && cause.status !== 0
        ? cause.message
        : 'Could not load the expenses. Check your connection and try again.';
  } finally {
    if (call === latest) loading.value = false;
  }
}

/** The merchant, else the note, as the row's title. */
function title(item: LinkCandidate): string {
  return item.merchant ?? item.note ?? 'Expense';
}

/** Note, date, account and category, as the design's second line. */
function meta(item: LinkCandidate): string {
  return [
    item.merchant ? item.note : null,
    shortDay(item.date),
    item.accountName,
    item.categoryName ?? 'no category',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The amount as an expense: the stored amount, signed as spent. */
function amount(item: LinkCandidate): string {
  return props.format(String(-BigInt(item.amount)), item.currency);
}
</script>

<template>
  <BbSheet
    title="Link an expense"
    :subtitle="`It will count for ${name}`"
    tall
    :top="160"
    @close="emit('close')"
  >
    <div class="input-wrap">
      <BbIcon name="search" :size="18" />
      <input
        v-model="search"
        class="search"
        type="search"
        autocomplete="off"
        placeholder="Search merchant, note, amount"
        aria-label="Search expenses"
      />
    </div>
    <div class="link-list scroll">
      <p v-if="loading" class="t-sub" role="status">Loading the expenses…</p>
      <div v-else-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <button class="text-btn" type="button" @click="load">Try again</button>
      </div>
      <template v-else>
        <section v-if="fitting.length" aria-labelledby="link-fits-h">
          <h3 id="link-fits-h" class="t-group">Fits {{ name }}</h3>
          <button
            v-for="item in fitting"
            :key="item.transactionId"
            class="opt"
            type="button"
            :disabled="disabled"
            @click="emit('pick', item.transactionId)"
          >
            <span class="link-text">
              <span class="link-title">{{ title(item) }}</span>
              <span class="num t-sub">{{ meta(item) }}</span>
            </span>
            <span class="num link-title">{{ amount(item) }}</span>
          </button>
        </section>
        <section v-if="others.length" aria-labelledby="link-other-h">
          <h3 id="link-other-h" class="t-group">
            Other expenses in {{ month }}
          </h3>
          <button
            v-for="item in others"
            :key="item.transactionId"
            class="opt"
            type="button"
            :disabled="disabled"
            @click="emit('pick', item.transactionId)"
          >
            <span class="link-text">
              <span class="link-title">{{ title(item) }}</span>
              <span class="num t-sub">{{ meta(item) }}</span>
            </span>
            <span class="num link-title">{{ amount(item) }}</span>
          </button>
        </section>
        <p v-if="candidates.length === 0" class="t-sub" role="status">
          {{
            searching
              ? `No expense of ${month} matches “${search.trim()}”.`
              : `No expense of ${month} is free to link.`
          }}
        </p>
        <p class="t-sub link-note">
          {{ month }}’s expenses that count for nothing yet. {{ footnote }}
        </p>
      </template>
    </div>
  </BbSheet>
</template>

<style scoped>
.link-list section > .t-group {
  margin: 20px 0 6px;
}
.link-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.link-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.link-title {
  font-weight: 500;
}
.link-note {
  margin: 16px 4px;
}
.opt:disabled {
  opacity: 0.5;
}
</style>
