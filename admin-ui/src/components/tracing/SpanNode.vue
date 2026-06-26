<template>
  <div>
    <!-- Span Row -->
    <div
      class="flex items-center gap-2 p-2 hover:bg-theme-bg rounded cursor-pointer transition"
      :style="{ paddingLeft: `${node.level * 24 + 8}px` }"
      @click="$emit('toggle', node.span.spanId)"
    >
      <!-- Expand/Collapse Icon -->
      <div class="w-4 h-4 flex-shrink-0">
        <svg
          v-if="node.children.length > 0"
          class="w-4 h-4 transform transition-transform"
          :class="{ 'rotate-90': isExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
      </div>

      <!-- Status Icon -->
      <div class="flex-shrink-0">
        <div
          class="w-3 h-3 rounded-full"
          :class="statusColor"
        ></div>
      </div>

      <!-- Span Name -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-theme-primary truncate">
            {{ node.span.name }}
          </span>
          <span class="text-xs px-2 py-0.5 rounded bg-theme-bg text-theme-secondary">
            {{ node.span.operationType }}
          </span>
        </div>
      </div>

      <!-- Duration -->
      <div class="flex-shrink-0 text-sm text-theme-secondary">
        {{ formatDuration(node.span.duration || 0) }}
      </div>

      <!-- Duration Bar -->
      <div class="w-32 bg-theme-bg rounded-full h-2 flex-shrink-0">
        <div
          class="h-2 rounded-full transition-all"
          :class="barColor"
          :style="{ width: durationPercentage + '%' }"
        ></div>
      </div>
    </div>

    <!-- Span Details (when expanded) -->
    <div
      v-if="isExpanded && hasDetails"
      class="ml-8 p-3 bg-theme-bg rounded text-xs space-y-1"
      :style="{ marginLeft: `${node.level * 24 + 32}px` }"
    >
      <div v-if="node.span.error" class="text-red-500 space-y-1">
        <div><strong>Error:</strong> {{ node.span.error.name }}</div>
        <div><strong>Message:</strong> {{ node.span.error.message }}</div>
        <div v-if="node.span.error.stack" class="text-xs mt-1">
          <strong>Stack:</strong>
          <pre class="mt-1 p-2 bg-theme-card rounded overflow-x-auto">{{ node.span.error.stack }}</pre>
        </div>
      </div>
      <div v-if="Object.keys(node.span.attributes).length > 0">
        <strong>Attributes:</strong>
        <pre class="mt-1 p-2 bg-theme-card rounded overflow-x-auto">{{ JSON.stringify(node.span.attributes, null, 2) }}</pre>
      </div>
      <div v-if="node.span.events.length > 0">
        <strong>Events:</strong>
        <div class="mt-1 space-y-1">
          <div v-for="(event, idx) in node.span.events" :key="idx" class="p-2 bg-theme-card rounded">
            <div><strong>{{ event.name }}</strong> - {{ event.timestamp }}ms</div>
            <div v-if="event.attributes" class="text-theme-secondary">
              {{ JSON.stringify(event.attributes) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Child Spans -->
    <div v-if="isExpanded && node.children.length > 0">
      <SpanNode
        v-for="child in node.children"
        :key="child.span.spanId"
        :node="child"
        :maxDuration="maxDuration"
        :expandedSpans="expandedSpans"
        @toggle="$emit('toggle', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SpanNode as SpanNodeType } from '@/types/tracing';

interface Props {
  node: SpanNodeType;
  maxDuration: number;
  expandedSpans: Set<string>;
}

const props = defineProps<Props>();

defineEmits<{
  toggle: [spanId: string];
}>();

const isExpanded = computed(() => props.expandedSpans.has(props.node.span.spanId));

const hasDetails = computed(() => {
  return (
    props.node.span.error ||
    Object.keys(props.node.span.attributes).length > 0 ||
    props.node.span.events.length > 0
  );
});

const statusColor = computed(() => {
  switch (props.node.span.status) {
    case 'ok':
      return 'bg-green-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
});

const barColor = computed(() => {
  switch (props.node.span.status) {
    case 'ok':
      return 'bg-green-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
});

const durationPercentage = computed(() => {
  const duration = props.node.span.duration || 0;
  return Math.min((duration / props.maxDuration) * 100, 100);
});

const formatDuration = (ms: number): string => {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};
</script>