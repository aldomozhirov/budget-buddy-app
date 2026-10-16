<script setup lang="ts">
import BbIcon from '../../components/BbIcon.vue';
import BbSheet from '../../components/BbSheet.vue';

/**
 * The "Paid by" sheet (UI-ADD-6): the active profiles, the signed-in one
 * marked "(you)", with the hint that the account stays as picked. One pick
 * closes it.
 */
defineProps<{
  /** Heading: "Paid by" for an expense. */
  title: string;
  /** The line under the heading. */
  hint: string;
  /** The active profiles. */
  profiles: { id: number; name: string }[];
  /** The signed-in profile. */
  profileId: number;
  /** The profile picked now. */
  selectedId: number;
}>();

const emit = defineEmits<{
  /** A profile was picked. */
  pick: [id: number];
  /** Close button, scrim tap or swipe down. */
  close: [];
}>();
</script>

<template>
  <BbSheet :title="title" @close="emit('close')">
    <p class="t-sub payer-hint">{{ hint }}</p>
    <div role="radiogroup" :aria-label="title" class="payer-list">
      <button
        v-for="profile in profiles"
        :key="profile.id"
        class="opt"
        type="button"
        role="radio"
        :aria-checked="profile.id === selectedId"
        @click="emit('pick', profile.id)"
      >
        <span class="auth-avatar" aria-hidden="true">{{
          profile.name.charAt(0)
        }}</span>
        <span class="payer-name">{{
          profile.id === profileId ? `${profile.name} (you)` : profile.name
        }}</span>
        <BbIcon v-if="profile.id === selectedId" name="check" :size="18" />
      </button>
    </div>
  </BbSheet>
</template>

<style scoped>
.payer-hint {
  margin: -6px 0 0;
}
.payer-list {
  display: flex;
  flex-direction: column;
}
.payer-name {
  flex: 1;
  font-weight: 500;
}
</style>
