<template>
  <div class="border-b border-theme">
    <div
      class="grid grid-cols-12 gap-4 p-4 hover:opacity-50 cursor-pointer items-center transition"
      @click="$emit('toggle')"
    >
      <!-- Timestamp -->
      <div class="col-span-2 text-sm text-theme-secondary">
        {{ item.timestamp }}
      </div>

      <!-- Status Badge -->
      <div class="col-span-1">
        <span
          :class="[
            'px-2 py-1 text-xs rounded-full font-medium',
            statusClasses
          ]"
        >
          {{ statusLabel }}
        </span>
      </div>

      <!-- Operation Name -->
      <div class="col-span-3 text-sm text-theme-primary font-medium truncate">
        {{ item.operationName }}
      </div>

      <!-- IP Address -->
      <div class="col-span-2 text-sm text-theme-secondary truncate font-mono">
        <span v-if="item.ipAddress">{{ item.ipAddress }}</span>
        <span v-else class="text-theme-tertiary">-</span>
      </div>

      <!-- Duration -->
      <div class="col-span-1 text-sm text-theme-secondary">
        {{ formatDuration(item.duration) }}
      </div>

      <!-- Span Count -->
      <div class="col-span-1 text-sm text-theme-secondary text-center">
        {{ item.spanCount }}
      </div>

      <!-- HTTP Info -->
      <div class="col-span-1 text-sm text-theme-secondary">
        <span v-if="item.httpStatusCode" class="font-mono">
          {{ item.httpStatusCode }}
        </span>
        <span v-else>-</span>
      </div>

      <!-- Expand Icon -->
      <div class="col-span-1 flex justify-end">
        <svg
          class="w-4 h-4 transform transition-transform"
          :class="{ 'rotate-180': isExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </div>
    </div>

    <!-- Expanded Details -->
    <div v-if="isExpanded" class="bg-theme-bg border-t border-theme">
      <TraceDetailPanel
        :trace="trace"
        @close="$emit('toggle')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TraceListItem, CompletedTrace } from '@/types/tracing';
import TraceDetailPanel from './TraceDetailPanel.vue';

interface Props {
  item: TraceListItem;
  trace: CompletedTrace;
  isExpanded: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  toggle: [];
}>();

const statusClasses = computed(() => {
  switch (props.item.status) {
    case 'error':
      return 'bg-red-100 text-red-800';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800';
    case 'success':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
});

const statusLabel = computed(() => {
  switch (props.item.status) {
    case 'error':
      return 'ERROR';
    case 'warning':
      return 'SLOW';
    case 'success':
      return 'OK';
    default:
      return 'UNKNOWN';
  }
});

const formatDuration = (ms: number): string => {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};
</script>