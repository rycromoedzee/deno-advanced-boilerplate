<template>
  <div class="h-full overflow-hidden flex flex-col gap-4 p-6">
    <!-- Error State -->
    <div v-if="error" class="flex-shrink-0">
      <ErrorAlert
        :message="error"
        @retry="loadData"
      />
    </div>

    <!-- Filters Section -->
    <div class="flex-shrink-0">
      <TracingFilters
        v-model:searchQuery="filters.searchQuery"
        v-model:userIdFilter="filters.userIdFilter"
        v-model:startDate="filters.startDate"
        v-model:endDate="filters.endDate"
        v-model:errorStatus="filters.errorStatus"
        v-model:durationThreshold="filters.durationThreshold"
        :operationTypeOptions="operationTypeOptions"
        :activeOperationTypes="filters.operationTypes"
        @toggleOperationType="toggleOperationType"
        @reload="loadData"
        @clearFilters="clearFilters"
      />
    </div>

    <!-- Results Info -->
    <div class="flex justify-between items-center flex-shrink-0">
      <div>
        <span class="text-sm text-theme-primary">
          {{ loading ? 'Loading...' : `${traces.length} of ${total} Results` }}
        </span>
        <span class="text-sm text-theme-primary"> - </span>
        <span class="text-sm text-theme-primary">{{ currentTime }}</span>
      </div>
    </div>

    <!-- Virtual List Container -->
    <div class="bg-theme-card flex-1 overflow-hidden rounded-lg shadow-sm flex flex-col" ref="listContainer">
      <!-- Table Header -->
      <div class="grid grid-cols-12 gap-4 p-4 bg-theme-card border-b border-theme text-sm font-medium text-theme-primary rounded-t-lg flex-shrink-0">
        <div class="col-span-2">Timestamp</div>
        <div class="col-span-1">Status</div>
        <div class="col-span-3">Operation</div>
        <div class="col-span-2">IP Address</div>
        <div class="col-span-1">Duration</div>
        <div class="col-span-1 text-center">Spans</div>
        <div class="col-span-1">HTTP</div>
        <div class="col-span-1"></div>
      </div>

      <!-- Loading State -->
      <div v-if="loading && traces.length === 0" class="flex-1 flex items-center justify-center p-8">
        <div class="text-center">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p class="mt-4 text-theme-secondary">Loading traces...</p>
        </div>
      </div>

      <!-- Virtual Scroller -->
      <div
        v-else
        ref="scrollContainer"
        class="h-full overflow-auto scroll-container"
        @scroll="onScroll"
      >
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ transform: `translateY(${offsetY}px)` }">
            <TraceRow
              v-for="item in visibleItems"
              :key="item.traceId"
              :item="item.listItem"
              :trace="item.trace"
              :isExpanded="expandedRows.has(item.traceId)"
              @toggle="toggleExpand(item.traceId)"
            />
          </div>
        </div>
        
        <!-- Load More Indicator -->
        <div v-if="loadingMore" class="flex items-center justify-center p-4 bg-theme-card">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span class="ml-3 text-theme-secondary">Loading more traces...</span>
        </div>
        
        <!-- End of Results -->
        <div v-else-if="!hasMore && traces.length > 0" class="flex items-center justify-center p-4 bg-theme-card text-theme-secondary text-sm">
          End of results
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { tracingService } from '@/services/tracing.service';
import type { CompletedTrace, TraceListItem, TraceFilter, OperationType } from '@/types/tracing';
import ErrorAlert from '@/components/common/ErrorAlert.vue';
import TracingFilters from '@/components/tracing/TracingFilters.vue';
import TraceRow from '@/components/tracing/TraceRow.vue';
import { useInfiniteScroll } from '@vueuse/core';

interface TraceWithListItem {
  traceId: string;
  trace: CompletedTrace;
  listItem: TraceListItem;
}

// State
const filters = ref<TraceFilter>({
  searchQuery: '',
  userIdFilter: '',
  errorStatus: 'all',
  operationTypes: [],
  durationThreshold: 0,
  startDate: '',
  endDate: '',
});
const debouncedSearchQuery = ref('');
const debouncedUserIdFilter = ref('');
const expandedRows = ref(new Set<string>());

const traces = ref<CompletedTrace[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);

// Pagination state
const pageSize = 50;
const offset = ref(0);
const total = ref(0);
const hasMore = computed(() => traces.value.length < total.value);

// Virtual scrolling
const listContainer = ref<HTMLElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(400);
const itemHeight = 57;
const expandedItemHeight = 500;

// Operation type options
const operationTypeOptions = tracingService.getOperationTypeOptions();

// Debounce search
let debounceTimeout: number;

// Watch for search query changes and reload data
watch(() => filters.value.searchQuery, () => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    debouncedSearchQuery.value = filters.value.searchQuery;
    loadData(true);
  }, 300) as unknown as number;
});

// Watch for userId filter changes and reload data
watch(() => filters.value.userIdFilter, () => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    debouncedUserIdFilter.value = filters.value.userIdFilter;
    loadData(true);
  }, 300) as unknown as number;
});

// Watch for other filter changes and reload
watch([
  () => filters.value.errorStatus,
  () => filters.value.operationTypes.length,
  () => filters.value.durationThreshold,
  () => filters.value.startDate,
  () => filters.value.endDate,
], () => {
  loadData(true);
});

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

const transformToListItem = (trace: CompletedTrace): TraceListItem => {
  // Build operation name with priority:
  // 1. HTTP method + path (for HTTP requests) - e.g., "GET /api/documents"
  // 2. HTTP path alone (if method missing)
  // 3. http.server span name (fallback for HTTP traces)
  // 4. Most meaningful service/handler span (for non-HTTP operations)
  let operationName = 'Unknown Operation';
  
  if (trace.httpMethod && trace.httpPath) {
    operationName = `${trace.httpMethod} ${trace.httpPath}`;
  } else if (trace.httpPath) {
    operationName = trace.httpPath;
  } else {
    // Fallback for non-HTTP operations: find the http.server span first
    const httpServerSpan = trace.spans.find(s => s.operationType === 'http.server');
    if (httpServerSpan?.name) {
      operationName = httpServerSpan.name;
    } else {
      // For internal operations (no HTTP context), use the most meaningful span:
      // Priority: handler > service > anything except auth/middleware
      const handlerSpan = trace.spans.find(s => s.operationType === 'handler');
      const serviceSpan = trace.spans.find(s => s.operationType === 'service');
      const meaningfulSpan = trace.spans.find(s =>
        s.name &&
        !s.name.includes('Middleware') &&
        s.operationType !== 'auth'
      );
      
      if (handlerSpan?.name) {
        operationName = handlerSpan.name;
      } else if (serviceSpan?.name) {
        operationName = serviceSpan.name;
      } else if (meaningfulSpan?.name) {
        operationName = meaningfulSpan.name;
      }
    }
  }
  
  let status: 'error' | 'warning' | 'success' = 'success';
  if (trace.status === 'error') {
    status = 'error';
  } else if (trace.duration > 1000) {
    status = 'warning';
  }

  return {
    traceId: trace.traceId,
    timestamp: formatDateTime(new Date(trace.startTime)),
    sortableTimestamp: trace.startTime,
    status,
    operationName,
    duration: trace.duration,
    spanCount: trace.spanCount,
    errorCount: trace.errorCount,
    userId: trace.userId,
    ipAddress: trace.ipAddress,
    httpMethod: trace.httpMethod,
    httpPath: trace.httpPath,
    httpStatusCode: trace.httpStatusCode,
    tags: trace.tags,
  };
};

// API Functions
const loadData = async (reset = true) => {
  try {
    if (reset) {
      loading.value = true;
      offset.value = 0;
      traces.value = [];
    }
    
    error.value = null;
    const response = await tracingService.getTraces({
      limit: pageSize,
      offset: offset.value,
      searchQuery: debouncedSearchQuery.value || undefined,
      userId: debouncedUserIdFilter.value || undefined,
    });
    
    if (reset) {
      traces.value = response.traces;
    } else {
      traces.value = [...traces.value, ...response.traces];
    }
    
    total.value = response.total;
    offset.value = response.offset + response.traces.length;
  } catch (err: any) {
    console.error('Error fetching traces:', err);
    error.value = err.message || 'Failed to load traces';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

const loadMore = async () => {
  if (loadingMore.value || !hasMore.value) return;
  
  loadingMore.value = true;
  await loadData(false);
};

// Computed
const tracesWithListItems = computed<TraceWithListItem[]>(() => {
  return traces.value
    .map(trace => ({
      traceId: trace.traceId,
      trace,
      listItem: transformToListItem(trace),
    }))
    .sort((a, b) => b.listItem.sortableTimestamp - a.listItem.sortableTimestamp);
});

// Virtual scrolling
const totalHeight = computed(() => {
  return tracesWithListItems.value.reduce((total, item) => {
    return total + (expandedRows.value.has(item.traceId) ? expandedItemHeight : itemHeight);
  }, 0);
});

const startIndex = computed(() => {
  let accumulatedHeight = 0;
  let index = 0;

  for (const item of tracesWithListItems.value) {
    const height = expandedRows.value.has(item.traceId) ? expandedItemHeight : itemHeight;
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
  return Math.min(startIndex.value + visibleCount.value, tracesWithListItems.value.length);
});

const visibleItems = computed(() => {
  return tracesWithListItems.value.slice(startIndex.value, endIndex.value);
});

const offsetY = computed(() => {
  let offset = 0;
  for (let i = 0; i < startIndex.value; i++) {
    const item = tracesWithListItems.value[i];
    offset += expandedRows.value.has(item.traceId) ? expandedItemHeight : itemHeight;
  }
  return offset;
});

// Methods
const toggleOperationType = (operationType: OperationType) => {
  const index = filters.value.operationTypes.indexOf(operationType);
  if (index > -1) {
    filters.value.operationTypes.splice(index, 1);
  } else {
    filters.value.operationTypes.push(operationType);
  }
};

const clearFilters = () => {
  filters.value = {
    searchQuery: '',
    userIdFilter: '',
    errorStatus: 'all',
    operationTypes: [],
    durationThreshold: 0,
    startDate: '',
    endDate: '',
  };
  debouncedSearchQuery.value = '';
  debouncedUserIdFilter.value = '';
};

const toggleExpand = (traceId: string) => {
  if (expandedRows.value.has(traceId)) {
    expandedRows.value.delete(traceId);
  } else {
    expandedRows.value.add(traceId);
  }
};

const onScroll = (event: Event) => {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
};

const calculateAvailableHeight = () => {
  if (!listContainer.value) return;
  const rect = listContainer.value.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const available = viewportHeight - rect.top - 48;
  containerHeight.value = Math.max(400, available);
};

const currentTime = formatDateTime(new Date());

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

  // Setup infinite scroll after refs are ready
  useInfiniteScroll(
    scrollContainer,
    async () => {
      if (hasMore.value && !loadingMore.value) {
        await loadMore();
      }
    },
    {
      distance: 200,
      interval: 500,
    }
  );
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