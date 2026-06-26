<template>
  <div class="bg-theme-bg border border-theme">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-theme">
      <h3 class="text-lg font-semibold text-theme-primary">Trace Details</h3>
    </div>

    <!-- Tabs -->
    <div class="border-b border-theme">
      <nav class="flex space-x-4 px-4" aria-label="Tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="py-3 px-1 border-b-2 font-medium text-sm transition"
          :class="
            activeTab === tab.id
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-theme-secondary hover:text-theme-primary hover:border-gray-300'
          "
        >
          {{ tab.name }}
        </button>
      </nav>
    </div>

    <!-- Tab Content -->
    <div class="p-4 pb-8 max-h-96 overflow-y-auto">
      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-sm font-medium text-theme-secondary">Duration</label>
            <p class="text-lg font-semibold text-theme-primary">{{ formatDuration(trace.duration) }}</p>
          </div>
          <div>
            <label class="text-sm font-medium text-theme-secondary">Status</label>
            <p class="text-lg font-semibold">
              <span
                :class="[
                  'px-3 py-1 rounded-full text-sm',
                  trace.status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                ]"
              >
                {{ trace.status.toUpperCase() }}
              </span>
            </p>
          </div>
          <div>
            <label class="text-sm font-medium text-theme-secondary">Error Count</label>
            <p class="text-lg font-semibold text-theme-primary">{{ trace.errorCount }}</p>
          </div>
          <div v-if="trace.userId">
            <label class="text-sm font-medium text-theme-secondary">User ID</label>
            <p class="text-sm text-theme-primary font-mono">{{ trace.userId }}</p>
          </div>
          <div v-if="trace.ipAddress">
            <label class="text-sm font-medium text-theme-secondary">IP Address</label>
            <p class="text-sm text-theme-primary font-mono">{{ trace.ipAddress }}</p>
          </div>
          <div v-if="trace.userAgent">
            <label class="text-sm font-medium text-theme-secondary">User Agent</label>
            <p class="text-sm text-theme-primary truncate" :title="trace.userAgent">{{ trace.userAgent }}</p>
          </div>
          <div v-if="trace.httpMethod && trace.httpPath">
            <label class="text-sm font-medium text-theme-secondary">HTTP Request</label>
            <p class="text-sm text-theme-primary">
              <span class="font-semibold">{{ trace.httpMethod }}</span> {{ trace.httpPath }}
            </p>
          </div>
          <div v-if="trace.httpStatusCode">
            <label class="text-sm font-medium text-theme-secondary">HTTP Status</label>
            <p class="text-lg font-semibold text-theme-primary">{{ trace.httpStatusCode }}</p>
          </div>
          <div>
            <label class="text-sm font-medium text-theme-secondary">Time Range</label>
            <p class="text-sm text-theme-primary">
              {{ formatTimestamp(trace.startTime) }} - {{ formatTimestamp(trace.endTime) }}
            </p>
          </div>
          <div>
            <label class="text-sm font-medium text-theme-secondary">Trace ID</label>
            <p class="text-xs text-theme-primary font-mono">{{ trace.traceId }}</p>
          </div>
        </div>
        
        <!-- Tags -->
        <div v-if="trace.tags.length > 0">
          <label class="text-sm font-medium text-theme-secondary block mb-2">Tags</label>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="tag in trace.tags"
              :key="tag"
              class="px-2 py-1 bg-theme-bg text-theme-primary text-xs rounded"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>

      <!-- Spans Tab -->
      <div v-if="activeTab === 'spans'">
        <SpanTimeline :spans="trace.spans" />
      </div>

      <!-- Breadcrumbs Tab -->
      <div v-if="activeTab === 'breadcrumbs'">
        <BreadcrumbTimeline :breadcrumbs="trace.breadcrumbs" />
      </div>

      <!-- JSON Tab -->
      <div v-if="activeTab === 'json'">
        <pre class="text-xs p-4 bg-theme-bg rounded overflow-x-auto">{{ JSON.stringify(trace, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { CompletedTrace } from '@/types/tracing';
import SpanTimeline from './SpanTimeline.vue';
import BreadcrumbTimeline from './BreadcrumbTimeline.vue';

interface Props {
  trace: CompletedTrace;
}

defineProps<Props>();

defineEmits<{
  close: [];
}>();

const activeTab = ref<'overview' | 'spans' | 'breadcrumbs' | 'json'>('overview');

const tabs = [
  { id: 'overview', name: 'Overview' },
  { id: 'spans', name: 'Spans' },
  { id: 'breadcrumbs', name: 'Breadcrumbs' },
  { id: 'json', name: 'JSON' },
] as const;

const formatDuration = (ms: number): string => {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};
</script>