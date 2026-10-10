<script setup lang="ts">
import { ref } from 'vue';
import BbSheet from '../../src/components/BbSheet.vue';

const open = ref(false);
const closable = ref(true);
const nestedOpen = ref(false);
const closeCount = ref(0);
const bodyButtonClicks = ref(0);
const items = Array.from({ length: 32 }, (_, index) => index + 1);

function openSheet(canClose: boolean): void {
  closable.value = canClose;
  open.value = true;
}

function closeSheet(): void {
  closeCount.value += 1;
  open.value = false;
}

function openNestedSheet(): void {
  bodyButtonClicks.value += 1;
  nestedOpen.value = true;
}
</script>

<template>
  <main class="bb" style="min-height: 2600px; padding: 24px">
    <div aria-hidden="true" style="height: 500px" />
    <h1>Sheet interaction harness</h1>
    <button type="button" @click="openSheet(true)">Open closable sheet</button>
    <button type="button" @click="openSheet(false)">
      Open non-closable sheet
    </button>
    <p v-for="item in 40" :key="item">Page item {{ item }}</p>
    <output role="status" aria-label="Close events">
      Close events: {{ closeCount }}
    </output>
    <output role="status" aria-label="Body button clicks">
      Body button clicks: {{ bodyButtonClicks }}
    </output>

    <BbSheet
      v-if="open"
      title="Swipe test sheet"
      :closable="closable"
      @close="closeSheet"
    >
      <button type="button" @click="openNestedSheet">Open nested sheet</button>
      <div
        role="region"
        aria-label="Scrollable sheet body"
        style="height: 180px; flex: 0 0 180px; overflow-y: auto"
      >
        <p v-for="item in items" :key="item">Body item {{ item }}</p>
      </div>
      <p v-for="item in items" :key="item">Sheet item {{ item }}</p>
      <BbSheet
        v-if="nestedOpen"
        title="Nested sheet"
        @close="nestedOpen = false"
      >
        <p>Nested sheet content</p>
      </BbSheet>
    </BbSheet>
  </main>
</template>
