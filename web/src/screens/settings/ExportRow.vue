<script setup lang="ts">
import { ref } from 'vue';
import BbIcon from '../../components/BbIcon.vue';
import BbRow from '../../components/BbRow.vue';
import { isOnline } from '../../composables/useOnline.js';

/**
 * The "Export all data" row of Settings (BKP-3, UI-SET-1). A tap asks the
 * server for the zip of CSV files and hands it to the browser as a download.
 * Place it inside a list card: it renders the row and, after a failure, an
 * error line in the same card.
 */
const emit = defineEmits<{
  /** The server no longer knows this session; sign in again. */
  signedOut: [];
}>();

const busy = ref(false);
const error = ref('');

/** The file name the server suggests, else a plain default. */
function fileNameOf(response: Response): string {
  const header = response.headers.get('content-disposition') ?? '';
  return /filename="([^"]+)"/u.exec(header)?.[1] ?? 'budget-buddy-export.zip';
}

/** Downloads the export, keeping the row busy until the file is handed over. */
async function download(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/export');
    if (response.status === 401) {
      emit('signedOut');
      return;
    }
    if (!response.ok) throw new Error('Export failed.');
    const link = document.createElement('a');
    const url = URL.createObjectURL(await response.blob());
    link.href = url;
    link.download = fileNameOf(response);
    document.body.append(link);
    link.click();
    link.remove();
    // The browser has started the download by the time this fires.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    error.value =
      'Could not export your data. Check your connection and try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BbRow
    interactive
    :disabled="busy || !isOnline"
    :aria-busy="busy"
    @click="download"
  >
    <template #title>
      <span class="settings-row-title">Export all data</span>
      <span class="t-sub">{{
        busy ? 'Preparing the .zip…' : 'CSV files in one .zip'
      }}</span>
    </template>
    <template #trailing>
      <span class="settings-export-icon">
        <BbIcon name="download" :size="18" />
      </span>
    </template>
  </BbRow>
  <p v-if="error" class="error settings-rate-error" role="alert">
    {{ error }}
  </p>
</template>
