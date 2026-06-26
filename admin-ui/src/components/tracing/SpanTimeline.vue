<template>
  <div class="space-y-2">
    <div v-if="spanNodes.length === 0" class="text-center py-8 text-theme-secondary">
      No spans available
    </div>
    <div v-else>
      <SpanNode
        v-for="node in spanNodes"
        :key="node.span.spanId"
        :node="node"
        :maxDuration="maxDuration"
        :expandedSpans="expandedSpans"
        @toggle="toggleSpan"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Span, SpanNode as SpanNodeType } from '@/types/tracing';
import SpanNode from './SpanNode.vue';

interface Props {
  spans: Span[];
}

const props = defineProps<Props>();
const expandedSpans = ref<Set<string>>(new Set());

/**
 * Build hierarchical span tree
 */
const spanNodes = computed<SpanNodeType[]>(() => {
  const nodeMap = new Map<string, SpanNodeType>();
  
  // Create nodes for all spans
  props.spans.forEach(span => {
    nodeMap.set(span.spanId, {
      span,
      children: [],
      level: 0,
    });
  });

  // Build hierarchy
  const rootNodes: SpanNodeType[] = [];
  props.spans.forEach(span => {
    const node = nodeMap.get(span.spanId)!;
    if (span.parentSpanId === null) {
      rootNodes.push(node);
    } else {
      const parent = nodeMap.get(span.parentSpanId);
      if (parent) {
        parent.children.push(node);
        node.level = parent.level + 1;
      } else {
        // Orphaned span, add to root
        rootNodes.push(node);
      }
    }
  });

  return rootNodes;
});

/**
 * Calculate max duration for proportional bars
 */
const maxDuration = computed(() => {
  return Math.max(...props.spans.map(s => s.duration || 0));
});

/**
 * Toggle span expansion
 */
const toggleSpan = (spanId: string) => {
  if (expandedSpans.value.has(spanId)) {
    expandedSpans.value.delete(spanId);
  } else {
    expandedSpans.value.add(spanId);
  }
};
</script>