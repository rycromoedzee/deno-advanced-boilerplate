<template>
  <div class="flex flex-col gap-6">
    <!-- Error State -->
    <ErrorAlert
      v-if="error"
      :message="error"
      @retry="loadData"
    />

    <!-- Stats -->
    <StatisticsGrid
      :stats="stats"
      :loading="statsLoading"
    />

    <!-- Filters Section -->
    <CacheFilters
      v-model:searchQuery="searchQuery"
      v-model:startDate="startDate"
      v-model:endDate="endDate"
      :filterOptions="filterOptions"
      :activeFilters="activeFilters"
      @toggleFilter="toggleFilter"
      @reload="loadData"
    />

    <!-- Results Info -->
    <div class="flex justify-between items-center mb-4">
      <div>
        <span class="text-sm text-theme-primary">
          {{ dataLoading ? 'Loading...' : `${filteredData.length} Results` }}
        </span>
        <span class="text-sm text-theme-primary"> - </span>
        <span class="text-sm text-theme-primary">{{ dateNow }}</span>
      </div>
    </div>

    <!-- Virtual List Container -->
    <div class="bg-theme-card h-full rounded-lg shadow-sm flex flex-col" ref="listContainer">
      <!-- Table Header -->
      <div class="grid grid-cols-12 gap-4 p-4 bg-theme-card border-b border-theme text-sm font-medium text-theme-primary rounded-t-lg flex-shrink-0">
        <div class="col-span-1">Namespace</div>
        <div class="col-span-4">Key</div>
        <div class="col-span-1">Group</div>
        <div class="col-span-1">Created At</div>
        <div class="col-span-2">Expires At</div>
        <div class="col-span-1">Size</div>
        <div class="col-span-1">Status</div>
        <div class="col-span-1"></div>
      </div>

      <!-- Loading State -->
      <div v-if="dataLoading" class="flex-1 flex items-center justify-center p-8">
        <div class="text-center">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p class="mt-4 text-theme-secondary">Loading interactions...</p>
        </div>
      </div>

      <!-- Virtual Scroller -->
      <div
        v-else
        ref="scrollContainer"
        class="overflow-auto scroll-container"
        :style="{ height: `${containerHeight}px` }"
        @scroll="onScroll"
      >
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ transform: `translateY(${offsetY}px)` }">
            <CacheEntryRow
              v-for="item in visibleItems"
              :key="item.id"
              :item="item"
              :isExpanded="expandedRows.has(item.id)"
              @toggle="toggleExpand(item.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { cacheService } from '@/services/cache.service';
import type { CacheEntry } from '@/types/cache';
import ErrorAlert from '@/components/common/ErrorAlert.vue';
import StatisticsGrid from '@/components/common/StatisticsGrid.vue';
import CacheFilters from '@/components/cache/CacheFilters.vue';
import CacheEntryRow from '@/components/cache/CacheEntryRow.vue';

interface TransformedCacheEntry {
  id: string;
  namespace: string;
  key: string;
  createdAt: string;
  expiresAt: string | null;
  sortableDate: number;
  ttl: string | null;
  size: string;
  status: 'active' | 'expired';
  group: string;
  details: {
    namespace: string;
    key: string;
    createdAt: string;
    expiresAt: string;
    ttl: string | null;
    size: string;
    group: string;
    data: unknown;
  };
}

// State
const searchQuery = ref('');
const debouncedSearchQuery = ref('');
const startDate = ref('');
const endDate = ref('');
const activeFilters = ref<string[]>([]);
const expandedRows = ref(new Set<string>());

const interactionData = ref<TransformedCacheEntry[]>([]);
const stats = ref<any[]>([]);
const filterOptions = ref<string[]>([]);
const dataLoading = ref(false);
const statsLoading = ref(false);
const error = ref<string | null>(null);

// Virtual scrolling
const listContainer = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(400);
const itemHeight = 57;
const expandedItemHeight = 200;

// Debounce search
let debounceTimeout: number;

watch(searchQuery, () => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    debouncedSearchQuery.value = searchQuery.value;
  }, 300) as unknown as number;
});

import { CACHE_NAMESPACES } from "@/constants/cache-namespaces";

// Helper functions
const formatDateTime = (date: Date): string => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = months[date.getMonth()];
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${m} ${d}, ${hh}:${mm}:${ss}`;
};

const transformInteractionData = (apiItem: CacheEntry): TransformedCacheEntry => {
  const type = Object.entries(CACHE_NAMESPACES).find(([_, parent]) =>
    typeof parent === 'object' && Object.values(parent as Record<string, string>).includes(apiItem.namespace)
  )?.[0] ?? 'None';

  return {
    id: apiItem.namespace + '=' + apiItem.key,
    namespace: apiItem.namespace.replace(/_/g, ' '),
    key: apiItem.key,
    createdAt: formatDateTime(new Date(apiItem.createdAt)),
    expiresAt: apiItem.expiresAt ? formatDateTime(new Date(apiItem.expiresAt)) : null,
    sortableDate: apiItem.createdAt,
    ttl: apiItem.ttl,
    size: (apiItem.size / 1024).toFixed(4),
    status: apiItem.expiresAt && apiItem.expiresAt >= Date.now() ? 'active' : 'expired',
    group: type,
    details: {
      namespace: apiItem.namespace.replace(/_/g, ' '),
      key: apiItem.key,
      createdAt: formatDateTime(new Date(apiItem.createdAt)),
      expiresAt: apiItem.expiresAt ? formatDateTime(new Date(apiItem.expiresAt)) : 'N/A',
      ttl: apiItem.ttl || null,
      size: (apiItem.size / 1024).toFixed(4),
      group: type,
      data: apiItem.value,
    },
  };
};

// API Functions
const fetchStats = async () => {
  try {
    statsLoading.value = true;
    const data = await cacheService.getCacheStats();

    filterOptions.value = data.namespacesList.map((item) => item.replace(/_/g, ' '));

    const calculatedTotalSize =
      data.global.totalSize >= 1024 * 1024
        ? (data.global.totalSize / (1024 * 1024)).toFixed(3) + ' MB'
        : (data.global.totalSize / 1024).toFixed(3) + ' KB';

    stats.value = [
      {
        id: 'entries',
        name: 'Entries',
        stat: [
          { name: 'Total Size', val: calculatedTotalSize },
          { name: 'Total Count', val: `${data.global.entryCount}` },
          { name: 'Average Entity', val: `${Math.floor(data.global.averageEntrySize)} Bytes` },
          { name: 'Smallest Entity', val: `${Math.floor(data.global.smallestEntrySize)} Bytes` },
          { name: 'Largest Entity', val: `${Math.floor(data.global.largestEntrySize)} Bytes` },
        ],
      },
      {
        id: 'namespace-breakdown',
        name: 'Namespace Breakdown',
        stat: Object.values(data.namespaces).map((item: any) => ({
          name: item.namespace.replace(/_/g, ' '),
          val: `Count: ${item.entryCount}, Hit Rate: ${item.hits} (${item.hitRate.toFixed(2)}%)`,
        })),
      },
    ];
  } catch (err: any) {
    console.error('Error fetching stats:', err);
    error.value = err.message;
  } finally {
    statsLoading.value = false;
  }
};

const fetchInteractions = async () => {
  try {
    dataLoading.value = true;
    const data = await cacheService.getCacheData();
    interactionData.value = data.map(transformInteractionData);
  } catch (err: any) {
    console.error('Error fetching interactions:', err);
    error.value = err.message;
  } finally {
    dataLoading.value = false;
  }
};

const loadData = async () => {
  error.value = null;
  await Promise.all([fetchStats(), fetchInteractions()]);
};

// Computed
const filteredData = computed(() => {
  let filtered = [...interactionData.value];

  if (debouncedSearchQuery.value) {
    const searchTerm = debouncedSearchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.namespace?.toLowerCase().includes(searchTerm) ||
        item.key?.toLowerCase().includes(searchTerm)
    );
  }

  if (activeFilters.value.length > 0) {
    filtered = filtered.filter((item) => activeFilters.value.includes(item.namespace));
  }

  if (startDate.value) {
    const start = new Date(startDate.value).getTime();
    filtered = filtered.filter((item) => item.sortableDate && item.sortableDate >= start);
  }

  if (endDate.value) {
    const end = new Date(endDate.value);
    end.setHours(23, 59, 59, 999);
    filtered = filtered.filter((item) => item.sortableDate && item.sortableDate <= end.getTime());
  }

  return filtered.sort((a, b) => (b.sortableDate || 0) - (a.sortableDate || 0));
});

// Virtual scrolling
const totalHeight = computed(() => {
  return filteredData.value.reduce((total, item) => {
    return total + (expandedRows.value.has(item.id) ? expandedItemHeight : itemHeight);
  }, 0);
});

const startIndex = computed(() => {
  let accumulatedHeight = 0;
  let index = 0;

  for (const item of filteredData.value) {
    const height = expandedRows.value.has(item.id) ? expandedItemHeight : itemHeight;
    if (accumulatedHeight + height > scrollTop.value) break;
    accumulatedHeight += height;
    index++;
  }

  return Math.max(0, index);
});

const visibleCount = computed(() => {
  return Math.ceil(containerHeight.value / itemHeight) + 2;
});

const endIndex = computed(() => {
  return Math.min(startIndex.value + visibleCount.value, filteredData.value.length);
});

const visibleItems = computed(() => {
  return filteredData.value.slice(startIndex.value, endIndex.value);
});

const offsetY = computed(() => {
  let offset = 0;
  for (let i = 0; i < startIndex.value; i++) {
    const item = filteredData.value[i];
    offset += expandedRows.value.has(item.id) ? expandedItemHeight : itemHeight;
  }
  return offset;
});

// Methods
const toggleFilter = (filterKey: string) => {
  const index = activeFilters.value.indexOf(filterKey);
  if (index > -1) {
    activeFilters.value.splice(index, 1);
  } else {
    activeFilters.value.push(filterKey);
  }
};

const toggleExpand = (itemId: string) => {
  if (expandedRows.value.has(itemId)) {
    expandedRows.value.delete(itemId);
  } else {
    expandedRows.value.add(itemId);
  }
};

const onScroll = (event: Event) => {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
};

const calculateAvailableHeight = () => {
  if (!listContainer.value) return;
  const rect = listContainer.value.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const available = viewportHeight - rect.top - 124;
  containerHeight.value = Math.max(200, available);
};

const dateNow = formatDateTime(new Date());

let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  calculateAvailableHeight();

  if (typeof ResizeObserver !== 'undefined' && listContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      calculateAvailableHeight();
    });
    resizeObserver.observe(listContainer.value);
  }

  window.addEventListener('resize', calculateAvailableHeight);
  setTimeout(calculateAvailableHeight, 100);

  loadData();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  window.removeEventListener('resize', calculateAvailableHeight);
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }
});
</script>