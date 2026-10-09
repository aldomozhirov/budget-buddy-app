<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  coinResponseSchema,
  deleteCoinResponseSchema,
  type CoinSetting,
} from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import BbSheet from '../../components/BbSheet.vue';

/** Bottom-sheet list and editor for family coin definitions. */
const props = defineProps<{
  /** Coins currently configured for the family. */
  coins: CoinSetting[];
}>();

const emit = defineEmits<{
  /** Coin data changed and the parent should refresh currency settings. */
  saved: [];
  /** The list sheet was dismissed. */
  close: [];
}>();

const currentCoins = ref<CoinSetting[]>([...props.coins]);
const editorOpen = ref(false);
const selectedCoin = ref<CoinSetting | null>(null);
const code = ref('');
const name = ref('');
const decimals = ref('8');
const editorError = ref('');
const deleteError = ref('');
const editorBusy = ref(false);
const deleteBusy = ref(false);
const deleteConfirmationOpen = ref(false);

watch(
  () => props.coins,
  (coins) => {
    currentCoins.value = [...coins];
  },
);

function openNewCoin(): void {
  selectedCoin.value = null;
  code.value = '';
  name.value = '';
  decimals.value = '8';
  editorError.value = '';
  editorOpen.value = true;
}

function openCoin(coin: CoinSetting): void {
  selectedCoin.value = coin;
  code.value = coin.code;
  name.value = coin.name;
  decimals.value = String(coin.decimals);
  editorError.value = '';
  editorOpen.value = true;
}

function closeEditor(): void {
  if (editorBusy.value) return;
  editorOpen.value = false;
  editorError.value = '';
}

async function saveCoin(): Promise<void> {
  if (editorBusy.value) return;
  const normalizedCode = code.value.trim().toUpperCase();
  const normalizedName = name.value.trim();
  const decimalPlaces = Number(decimals.value);
  editorError.value = '';
  if (!normalizedCode) {
    editorError.value = 'Enter a coin code.';
    return;
  }
  if (!normalizedName) {
    editorError.value = 'Enter a coin name.';
    return;
  }
  if (
    !String(decimals.value).trim() ||
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 8
  ) {
    editorError.value = 'Stored with at most 8 decimals';
    return;
  }

  editorBusy.value = true;
  try {
    const editing = selectedCoin.value;
    const response = await fetch(
      editing ? `/api/coins/${encodeURIComponent(editing.code)}` : '/api/coins',
      {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: normalizedCode,
          name: normalizedName,
          decimals: decimalPlaces,
        }),
      },
    );
    if (!response.ok) {
      editorError.value = await readError(response, 'coin');
      return;
    }
    const saved = coinResponseSchema.parse(await response.json()).coin;
    currentCoins.value = editing
      ? currentCoins.value.map((coin) =>
          coin.code === editing.code ? saved : coin,
        )
      : [...currentCoins.value, saved].sort((left, right) =>
          left.code.localeCompare(right.code),
        );
    editorOpen.value = false;
    emit('saved');
  } catch {
    editorError.value =
      'Could not save the coin. Check your connection and try again.';
  } finally {
    editorBusy.value = false;
  }
}

function askToDelete(): void {
  if (!selectedCoin.value || selectedCoin.value.inUse || editorBusy.value)
    return;
  deleteError.value = '';
  deleteConfirmationOpen.value = true;
}

function closeDeleteConfirmation(): void {
  if (deleteBusy.value) return;
  deleteConfirmationOpen.value = false;
  deleteError.value = '';
}

async function deleteCoin(): Promise<void> {
  const coin = selectedCoin.value;
  if (!coin || deleteBusy.value) return;
  deleteBusy.value = true;
  deleteError.value = '';
  try {
    const response = await fetch(
      `/api/coins/${encodeURIComponent(coin.code)}`,
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    if (!response.ok) {
      deleteError.value = await readError(response, 'coin');
      return;
    }
    deleteCoinResponseSchema.parse(await response.json());
    currentCoins.value = currentCoins.value.filter(
      (current) => current.code !== coin.code,
    );
    deleteConfirmationOpen.value = false;
    editorOpen.value = false;
    emit('saved');
  } catch {
    deleteError.value =
      'Could not delete the coin. Check your connection and try again.';
  } finally {
    deleteBusy.value = false;
  }
}

async function readError(response: Response, field: 'coin'): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; fields?: Record<string, string> };
    };
    return (
      body.error?.fields?.[field] ??
      body.error?.fields?.code ??
      body.error?.fields?.name ??
      body.error?.fields?.decimals ??
      body.error?.message ??
      'Could not save the coin. Try again.'
    );
  } catch {
    return 'Could not save the coin. Try again.';
  }
}
</script>

<template>
  <BbSheet title="Currencies and coins" @close="emit('close')">
    <p class="t-sub settings-money-copy">
      Currencies are stored in their own units. A coin in use can’t be deleted.
    </p>
    <BbListCard
      v-if="currentCoins.length"
      label="Coins"
      class="settings-picker-list"
    >
      <BbRow
        v-for="coin in currentCoins"
        :key="coin.code"
        interactive
        :aria-label="`${coin.name}, ${coin.code}${coin.inUse ? ', in use' : ''}`"
        @click="openCoin(coin)"
      >
        <template #title>
          <span class="settings-picker-title"
            >{{ coin.name }} · {{ coin.code }}</span
          >
        </template>
        <template #trailing>
          <span class="row-v">
            {{ coin.inUse ? 'In use · ' : '' }}{{ coin.decimals }} decimals
          </span>
        </template>
      </BbRow>
    </BbListCard>
    <p v-else class="t-sub settings-money-empty" role="status">No coins yet.</p>
    <BbButton @click="openNewCoin"> Add coin </BbButton>
    <BbButton variant="text" @click="emit('close')"> Close </BbButton>
  </BbSheet>

  <BbSheet
    v-if="editorOpen"
    :title="selectedCoin ? `Edit ${selectedCoin.code}` : 'Add coin'"
    @close="closeEditor"
  >
    <form class="settings-sheet-form" novalidate @submit.prevent="saveCoin">
      <label class="settings-field">
        <span class="lbl">Code</span>
        <input
          v-model="code"
          class="text"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          aria-label="Coin code"
          :aria-invalid="Boolean(editorError)"
          :disabled="selectedCoin?.inUse"
          @input="editorError = ''"
        />
      </label>
      <label class="settings-field">
        <span class="lbl">Name</span>
        <input
          v-model="name"
          class="text"
          type="text"
          autocomplete="off"
          aria-label="Coin name"
          :aria-invalid="Boolean(editorError)"
          @input="editorError = ''"
        />
      </label>
      <label class="settings-field">
        <span class="lbl">Decimals</span>
        <input
          v-model="decimals"
          class="text"
          type="number"
          min="0"
          max="8"
          step="1"
          aria-label="Coin decimals"
          aria-describedby="coin-decimals-hint"
          :aria-invalid="Boolean(editorError)"
          :disabled="selectedCoin?.inUse"
          @input="editorError = ''"
        />
        <span id="coin-decimals-hint" class="t-sub">
          Stored with at most 8 decimals
        </span>
      </label>
      <p v-if="selectedCoin?.inUse" class="t-sub settings-money-copy">
        Code and decimals can’t change while this coin is in use.
      </p>
      <p v-if="editorError" class="error settings-form-error" role="alert">
        {{ editorError }}
      </p>
      <BbButton type="submit" :disabled="editorBusy">
        {{ selectedCoin ? 'Save coin' : 'Add coin' }}
      </BbButton>
    </form>
    <div v-if="selectedCoin" class="settings-sheet-actions">
      <BbButton
        v-if="!selectedCoin.inUse"
        variant="secondary"
        class="danger"
        :disabled="editorBusy"
        @click="askToDelete"
      >
        Delete coin
      </BbButton>
      <p v-else class="t-sub settings-money-copy">
        This coin is in use and can’t be deleted.
      </p>
    </div>
  </BbSheet>

  <BbSheet
    v-if="deleteConfirmationOpen && selectedCoin"
    :title="`Delete ${selectedCoin.code}?`"
    @close="closeDeleteConfirmation"
  >
    <p class="t-sub settings-money-copy">
      This coin will be removed from your currency list.
    </p>
    <p v-if="deleteError" class="error settings-form-error" role="alert">
      {{ deleteError }}
    </p>
    <div class="settings-sheet-actions">
      <BbButton
        variant="secondary"
        class="danger"
        :disabled="deleteBusy"
        @click="deleteCoin"
      >
        Delete coin
      </BbButton>
      <BbButton
        variant="text"
        :disabled="deleteBusy"
        @click="closeDeleteConfirmation"
      >
        Keep coin
      </BbButton>
    </div>
  </BbSheet>
</template>
