<template>
  <div class="space-y-3">
    <div v-if="breadcrumbs.length === 0" class="text-center py-8 text-theme-secondary">
      No breadcrumbs available
    </div>
    <div v-else class="relative">
      <!-- Timeline line -->
      <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-theme-bg"></div>

      <!-- Breadcrumb items -->
      <div
        v-for="(breadcrumb, index) in sortedBreadcrumbs"
        :key="index"
        class="relative pl-12 pb-4"
      >
        <!-- Timeline dot -->
        <div
          class="absolute left-2.5 w-3 h-3 rounded-full border-2 border-theme-card"
          :class="getLevelColor(breadcrumb.level)"
        ></div>

        <!-- Breadcrumb content -->
        <div class="bg-theme-card rounded-lg p-3 shadow-sm">
          <div class="flex items-start justify-between gap-2 mb-2">
            <!-- Category and message -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="text-xs px-2 py-0.5 rounded font-medium"
                  :class="getCategoryClasses(breadcrumb.category)"
                >
                  {{ breadcrumb.category }}
                </span>
                <span
                  class="text-xs px-2 py-0.5 rounded font-medium"
                  :class="getLevelClasses(breadcrumb.level)"
                >
                  {{ breadcrumb.level }}
                </span>
              </div>
              <p class="text-sm text-theme-primary">{{ breadcrumb.message }}</p>
            </div>

            <!-- Timestamp -->
            <div class="text-xs text-theme-secondary whitespace-nowrap">
              {{ formatTimestamp(breadcrumb.timestamp) }}
            </div>
          </div>

          <!-- Optional data -->
          <div
            v-if="breadcrumb.data && Object.keys(breadcrumb.data).length > 0"
            class="mt-2"
          >
            <button
              @click="toggleData(index)"
              class="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              <svg
                class="w-3 h-3 transform transition-transform"
                :class="{ 'rotate-90': expandedData.has(index) }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
              {{ expandedData.has(index) ? 'Hide' : 'Show' }} Data
            </button>
            <pre
              v-if="expandedData.has(index)"
              class="mt-2 text-xs p-2 bg-theme-bg rounded overflow-x-auto"
            >{{ JSON.stringify(breadcrumb.data, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Breadcrumb, BreadcrumbCategory, BreadcrumbLevel } from '@/types/tracing';

interface Props {
  breadcrumbs: Breadcrumb[];
}

const props = defineProps<Props>();
const expandedData = ref<Set<number>>(new Set());

/**
 * Sort breadcrumbs chronologically
 */
const sortedBreadcrumbs = computed(() => {
  return [...props.breadcrumbs].sort((a, b) => a.timestamp - b.timestamp);
});

/**
 * Get category badge classes
 */
const getCategoryClasses = (category: BreadcrumbCategory): string => {
  const categoryColors: Record<BreadcrumbCategory, string> = {
    http: 'bg-blue-100 text-blue-800',
    auth: 'bg-blue-100 text-blue-800',
    db: 'bg-purple-100 text-purple-800',
    cache: 'bg-cyan-100 text-cyan-800',
    service: 'bg-indigo-100 text-indigo-800',
    handler: 'bg-green-100 text-green-800',
    navigation: 'bg-teal-100 text-teal-800',
    'user-action': 'bg-orange-100 text-orange-800',
    error: 'bg-red-100 text-red-800',
  };
  return categoryColors[category] || 'bg-gray-100 text-gray-800';
};

/**
 * Get level badge classes
 */
const getLevelClasses = (level: BreadcrumbLevel): string => {
  const levelColors: Record<BreadcrumbLevel, string> = {
    debug: 'bg-gray-100 text-gray-800',
    info: 'bg-blue-100 text-blue-800',
    warning: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
  };
  return levelColors[level] || 'bg-gray-100 text-gray-800';
};

/**
 * Get level color for timeline dot
 */
const getLevelColor = (level: BreadcrumbLevel): string => {
  const levelColors: Record<BreadcrumbLevel, string> = {
    debug: 'bg-gray-400',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  };
  return levelColors[level] || 'bg-gray-400';
};

/**
 * Format timestamp
 */
const formatTimestamp = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

/**
 * Toggle data expansion
 */
const toggleData = (index: number) => {
  if (expandedData.value.has(index)) {
    expandedData.value.delete(index);
  } else {
    expandedData.value.add(index);
  }
};
</script>