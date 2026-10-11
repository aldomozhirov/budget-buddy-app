<script setup lang="ts">
import { computed } from 'vue';
import type { BackupStatusResponse } from '@budget-buddy/shared';
import BbButton from '../../components/BbButton.vue';
import BbListCard from '../../components/BbListCard.vue';
import BbRow from '../../components/BbRow.vue';
import BbSheet from '../../components/BbSheet.vue';
import { formatBytes } from './backupFormat.js';
import { formatDayTime } from './ratesFormat.js';

/**
 * Read-only status of the nightly backup (BKP-4): when the last good copy was
 * made and how big it is, how many daily and monthly copies are kept, and,
 * after a failed night, why it failed and what happens next.
 */
const props = defineProps<{
  /** Status returned by `GET /api/backup/status`. */
  status: BackupStatusResponse;
}>();

const emit = defineEmits<{
  /** The sheet was dismissed. */
  close: [];
}>();

const lastTime = computed(() =>
  props.status.last
    ? formatDayTime(
        props.status.last.finishedAt,
        props.status.today,
        props.status.timeZone,
      )
    : '',
);
const failedTime = computed(() =>
  props.status.failure
    ? formatDayTime(
        props.status.failure.at,
        props.status.today,
        props.status.timeZone,
      )
    : '',
);
</script>

<template>
  <BbSheet title="Backup" @close="emit('close')">
    <p class="t-sub settings-money-copy">
      Every night at {{ status.time }} Budget Buddy saves a copy of all your
      data in the backups folder on the Mac mini. It keeps
      {{ status.daily.limit }} daily and {{ status.monthly.limit }} monthly
      copies.
    </p>
    <p v-if="status.failure" class="error settings-backup-failure" role="alert">
      The backup failed {{ failedTime }}. {{ status.failure.message }}
      The earlier copies are kept as they were, and it tries again tonight at
      {{ status.time }}.
    </p>
    <p
      v-if="!status.last && !status.failure"
      class="t-sub settings-money-empty"
      role="status"
    >
      No backup yet. The first one is made as soon as the app has been set up.
    </p>
    <BbListCard v-if="status.last" label="Backup details">
      <BbRow title="Last good backup" :value="lastTime" />
      <BbRow title="Size" :value="formatBytes(status.last.bytes)" />
      <BbRow
        title="Daily copies"
        :value="`${status.daily.kept} of ${status.daily.limit}`"
      />
      <BbRow
        title="Monthly copies"
        :value="`${status.monthly.kept} of ${status.monthly.limit}`"
      />
    </BbListCard>
    <BbButton variant="text" @click="emit('close')"> Close </BbButton>
  </BbSheet>
</template>
