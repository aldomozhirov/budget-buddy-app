<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import BbAmount from '../../components/BbAmount.vue';
import BbBackButton from '../../components/BbBackButton.vue';
import BbButton from '../../components/BbButton.vue';
import BbChip from '../../components/BbChip.vue';
import BbChipGroup from '../../components/BbChipGroup.vue';
import BbConfirmSheet from '../../components/BbConfirmSheet.vue';
import BbIcon from '../../components/BbIcon.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbProgress from '../../components/BbProgress.vue';
import BbRow from '../../components/BbRow.vue';
import BbSegmented from '../../components/BbSegmented.vue';
import BbSwitch from '../../components/BbSwitch.vue';
import BbTag from '../../components/BbTag.vue';

/**
 * Dev-only gallery at `/dev/components`: colour tokens, type and every Bb
 * component with sample data, plus styled markup that has no component yet.
 */
defineOptions({ name: 'ComponentGallery' });

/** OS colour scheme, shown in the title to tell the themes apart. */
const colorScheme = ref<'light' | 'dark'>('light');
const selectedKind = ref('expense');
const selectedAccount = ref('ing');
const selectedFilter = ref('october');
const selectedSeries = ref('all');
const faceIdEnabled = ref(true);
const sheetOpen = ref(false);

const kindOptions = [
  { label: 'Expense', value: 'expense' },
  { label: 'Income', value: 'income' },
  { label: 'Transfer', value: 'transfer' },
];
const accountOptions = [
  { label: 'ING Visa', value: 'ing' },
  { label: 'Cash €', value: 'cash' },
  { label: 'Revolut', value: 'revolut' },
];
const seriesOptions = [
  { label: 'All in EUR', value: 'all' },
  { label: 'EUR', value: 'eur' },
  { label: 'USD', value: 'usd' },
];
const palette = [
  { name: 'bg', color: 'var(--bg)' },
  { name: 'surface', color: 'var(--surface)' },
  { name: 'ink', color: 'var(--ink)', foreground: 'var(--on-ink)' },
  { name: 'muted', color: 'var(--muted)', foreground: 'var(--on-ink)' },
  { name: 'line', color: 'var(--line)' },
  { name: 'soft', color: 'var(--soft)' },
  { name: 'accent', color: 'var(--accent)', foreground: 'var(--on-ink)' },
  { name: 'accent-soft', color: 'var(--accent-soft)' },
  { name: 'warn', color: 'var(--warn)', foreground: 'var(--on-ink)' },
  { name: 'warn-soft', color: 'var(--warn-soft)' },
];

let colorSchemeQuery: MediaQueryList | undefined;
function updateColorScheme() {
  colorScheme.value = colorSchemeQuery?.matches ? 'dark' : 'light';
}

onMounted(() => {
  colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  updateColorScheme();
  colorSchemeQuery.addEventListener('change', updateColorScheme);
});

onUnmounted(() =>
  colorSchemeQuery?.removeEventListener('change', updateColorScheme),
);
</script>

<template>
  <main class="bb components-page">
    <header class="topbar">
      <div>
        <h1 class="t-title">
          Components · {{ colorScheme }}
        </h1>
        <span class="t-sub">Budget Buddy design system</span>
      </div>
    </header>

    <div class="content components-content">
      <section
        class="components-section"
        aria-labelledby="tokens-heading"
      >
        <h2
          id="tokens-heading"
          class="h"
        >
          Colour tokens
        </h2>
        <div class="components-swatches">
          <div
            v-for="swatch in palette"
            :key="swatch.name"
            class="components-swatch"
            :style="{ backgroundColor: swatch.color, color: swatch.foreground }"
          >
            {{ swatch.name }}
          </div>
        </div>
      </section>

      <section
        class="components-section"
        aria-labelledby="type-heading"
      >
        <h2
          id="type-heading"
          class="h"
        >
          Type
        </h2>
        <div>
          <h3 class="t-greeting">
            Hi, Alena
          </h3>
          <span class="t-sub">Monday, 5 October</span>
        </div>
        <div class="t-hero num">
          €84,215.00
        </div>
        <span class="lbl">Category · from REWE rule</span>
      </section>

      <section
        class="components-section"
        aria-labelledby="buttons-heading"
      >
        <h2
          id="buttons-heading"
          class="h"
        >
          Buttons and top bar
        </h2>
        <div
          class="components-cluster"
          aria-label="Icon button examples"
        >
          <BbBackButton label="Back to home" />
          <button
            class="icon-btn"
            type="button"
            aria-label="Show amounts for 30 seconds"
            aria-pressed="false"
          >
            <BbIcon
              name="eye-off"
              :size="22"
              :stroke-width="1.8"
            />
          </button>
          <button
            class="icon-btn icon-btn-ink"
            type="button"
            aria-label="New account"
          >
            <BbIcon name="plus" />
          </button>
          <button
            class="icon-btn"
            type="button"
            aria-label="Account settings"
          >
            <BbIcon name="settings" />
          </button>
        </div>
        <div class="components-button-stack">
          <BbButton>Save €23.80</BbButton>
          <BbButton disabled>
            Enter an amount
          </BbButton>
          <BbButton variant="secondary">
            Add another
          </BbButton>
          <BbButton variant="secondary-sm">
            Secondary small
          </BbButton>
          <BbButton variant="text">
            Text action
          </BbButton>
        </div>
      </section>

      <section
        class="components-section"
        aria-labelledby="choices-heading"
      >
        <h2
          id="choices-heading"
          class="h"
        >
          Choices
        </h2>
        <BbSegmented
          v-model="selectedKind"
          :options="kindOptions"
          label="Kind"
        />
        <BbChipGroup
          v-model="selectedAccount"
          :options="accountOptions"
          label="Paid from"
        />
        <div
          class="components-cluster"
          aria-label="Other choice examples"
        >
          <BbChip variant="suggest">
            <BbIcon
              name="check"
              :size="16"
            /> Subscriptions
          </BbChip>
          <BbChip
            variant="filter"
            :selected="selectedFilter === 'october'"
            @click="
              selectedFilter = selectedFilter === 'october' ? '' : 'october'
            "
          >
            October <BbIcon
              name="down"
              :size="14"
            />
          </BbChip>
          <BbChip
            variant="filter"
            :selected="selectedFilter === 'account'"
            @click="selectedFilter = 'account'"
          >
            Account <BbIcon
              name="down"
              :size="14"
            />
          </BbChip>
          <BbChipGroup
            v-model="selectedSeries"
            :options="seriesOptions"
            label="Series"
            variant="pill"
          />
          <BbChip variant="ghost">
            All…
          </BbChip>
        </div>
        <BbChipGroup
          v-model="selectedAccount"
          :options="accountOptions"
          label="Paid by"
          variant="small"
        />
      </section>

      <section
        class="components-section"
        aria-labelledby="fields-heading"
      >
        <h2
          id="fields-heading"
          class="h"
        >
          Fields and detail rows
        </h2>
        <button
          class="field-btn"
          type="button"
        >
          <span style="flex: 1; text-align: left; color: var(--muted)">Add merchant</span>
          <span class="t-sub">Optional</span>
        </button>
        <div class="components-grid-three">
          <button
            class="meta"
            type="button"
          >
            <span class="meta-l">Date</span><span class="meta-v">Today</span>
          </button>
          <button
            class="meta meta-set"
            type="button"
          >
            <span class="meta-l">Paid by</span><span class="meta-v">Max</span>
          </button>
          <button
            class="meta"
            type="button"
          >
            <span class="meta-l">Note</span><span class="meta-v">Add</span>
          </button>
        </div>
        <BbListCard>
          <button
            class="field"
            type="button"
            aria-expanded="false"
          >
            <span class="field-l">Category</span>
            <span class="field-v">Groceries</span>
          </button>
          <a
            class="field field-link"
            href="#accounts"
          >
            <span class="field-l">Paid from</span>
            <span class="field-v">ING Visa · EUR</span>
          </a>
        </BbListCard>
        <label class="input-wrap">
          <span class="sr">Search merchant, note, amount</span>
          <BbIcon name="search" />
          <input
            class="search"
            placeholder="Search merchant, note, amount"
            aria-label="Search merchant, note, amount"
          >
        </label>
        <label class="components-inline-field">
          <span class="lbl">Family password</span>
          <input
            class="pw pw-err"
            type="password"
            value="incorrect"
            aria-invalid="true"
          >
          <span
            class="error"
            role="alert"
          >That password doesn’t match. 2 tries before a short wait.</span>
        </label>
      </section>

      <section
        class="components-section"
        aria-labelledby="amount-heading"
      >
        <h2
          id="amount-heading"
          class="h"
        >
          Amount and keypad
        </h2>
        <div class="amount num">
          €23.80
        </div>
        <div
          class="keypad"
          aria-label="Amount keypad"
        >
          <button
            class="key-target"
            type="button"
            aria-label="7"
          >
            <span class="key">7</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="8"
          >
            <span class="key">8</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="9"
          >
            <span class="key">9</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="Open bracket"
          >
            <span class="key key-op">(</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="Close bracket"
          >
            <span class="key key-op">)</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="Decimal point"
          >
            <span class="key">.</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="0"
          >
            <span class="key">0</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="Percent"
          >
            <span class="key key-op">%</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="Delete last character"
          >
            <span class="key key-op">⌫</span>
          </button>
          <button
            class="key-target"
            type="button"
            aria-label="Clear amount"
          >
            <span class="key key-op">C</span>
          </button>
        </div>
      </section>

      <section
        class="components-section"
        aria-labelledby="surfaces-heading"
      >
        <h2
          id="surfaces-heading"
          class="h"
        >
          Cards, rows, tags and progress
        </h2>
        <a
          class="card-hero"
          href="#groceries"
        >
          <span style="display: flex; justify-content: space-between; gap: 8px">
            <span style="font-weight: 600; font-size: 17px">Groceries</span>
            <BbTag mode>Resets monthly</BbTag>
          </span>
          <span class="t-hero-sm num">€187.60
            <span
              class="muted"
              style="font-size: 15px; font-weight: 500"
            >left</span></span>
          <BbProgress
            :value="62"
            label="Groceries budget used"
          />
          <span class="t-sub num">€312.40 spent of €500.00 · 6 expenses</span>
        </a>
        <a
          class="card-hero card-warn"
          href="#eating-out"
        >
          <span style="font-weight: 600; font-size: 17px">Eating out</span>
          <span class="t-hero-sm num warn">−€14.50
            <span style="font-size: 15px; font-weight: 500">overspent</span></span>
          <BbProgress
            :value="100"
            label="Eating out budget exceeded"
            over
          />
        </a>
        <BbListCard>
          <BbRow
            title="Revolut · EUR"
            subtitle="Check-in 02/09/2026"
            value="€386.20"
            href="#revolut"
          >
            <template #trailing>
              <span class="num">€386.20</span>
              <BbTag tone="warn">
                Stale
              </BbTag>
            </template>
          </BbRow>
          <BbRow
            title="Unlock with Face ID"
            subtitle="On this iPhone, instead of the password"
          >
            <template #trailing>
              <BbSwitch
                v-model="faceIdEnabled"
                label="Unlock with Face ID"
              />
            </template>
          </BbRow>
          <BbRow title="Needs a category">
            <template #trailing>
              <span class="badge">3</span>
            </template>
          </BbRow>
        </BbListCard>
        <div class="banner">
          <span class="components-banner-copy">Monthly check-in is open</span>
          <BbProgress
            :value="57"
            label="Check-in progress"
          />
          <span class="t-sub">Opened today · 4 of your accounts to check</span>
        </div>
        <BbListCard label="Family wealth">
          <BbRow title="Family wealth · EUR">
            <template #trailing>
              <BbAmount
                value="€84,215.00"
                :visible="false"
              />
            </template>
          </BbRow>
        </BbListCard>
      </section>

      <section
        class="components-section"
        aria-labelledby="sheet-heading"
      >
        <h2
          id="sheet-heading"
          class="h"
        >
          Sheet
        </h2>
        <BbButton
          variant="secondary"
          @click="sheetOpen = true"
        >
          Open sheet preview
        </BbButton>
      </section>
    </div>

    <BbConfirmSheet
      v-if="sheetOpen"
      class="components-demo-sheet"
      title="Close the check-in now?"
      message="3 accounts without a value will keep the last balance, marked as “wasn’t changed”."
      confirm-label="Close check-in"
      @confirm="sheetOpen = false"
      @cancel="sheetOpen = false"
    />
  </main>
</template>
