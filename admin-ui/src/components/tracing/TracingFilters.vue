<template>
  <div class="mt-12 mb-6">
    <!-- Search and Date Filters -->
    <div class="flex gap-4 mb-4 flex-wrap">
      <!-- Search Input -->
      <div class="flex-1 min-w-[300px] relative">
        <svg
          class="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          :value="searchQuery"
          @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          type="text"
          placeholder="Search trace ID, user ID, operation..."
          class="w-full pl-10 pr-4 py-2 border border-theme rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-theme-card"
        />
      </div>

      <!-- Date Range -->
      <div class="flex items-center gap-2">
        <span class="text-sm text-theme-secondary whitespace-nowrap">Date Range</span>
        <input
          :value="startDate"
          @input="$emit('update:startDate', ($event.target as HTMLInputElement).value)"
          type="date"
          class="px-3 py-2 border border-theme rounded-md bg-theme-card focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <input
          :value="endDate"
          @input="$emit('update:endDate', ($event.target as HTMLInputElement).value)"
          type="date"
          class="px-3 py-2 border border-theme rounded-md bg-theme-card focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <!-- Reload Button -->
      <button
        @click="$emit('reload')"
        type="button"
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition"
      >
        Reload
      </button>
    </div>

    <!-- Advanced Filters -->
    <div class="flex gap-4 mb-4 flex-wrap">
      <!-- User ID Filter -->
      <div class="flex items-center gap-2">
        <label class="text-sm text-theme-secondary whitespace-nowrap">User ID</label>
        <input
          :value="userIdFilter"
          @input="$emit('update:userIdFilter', ($event.target as HTMLInputElement).value)"
          type="text"
          placeholder="Filter by user ID"
          class="w-48 px-3 py-2 border border-theme rounded-md bg-theme-card focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        />
      </div>

      <!-- Error Status Filter -->
      <div class="flex items-center gap-2">
        <label class="text-sm text-theme-secondary whitespace-nowrap">Status</label>
        <select
          :value="errorStatus"
          @change="$emit('update:errorStatus', ($event.target as HTMLSelectElement).value)"
          class="px-3 py-2 border border-theme rounded-md bg-theme-card focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="all">All Traces</option>
          <option value="errors">Errors Only</option>
          <option value="warnings">Warnings (Slow)</option>
        </select>
      </div>

      <!-- Duration Threshold -->
      <div class="flex items-center gap-2">
        <label class="text-sm text-theme-secondary whitespace-nowrap">Min Duration</label>
        <input
          :value="durationThreshold"
          @input="$emit('update:durationThreshold', parseInt(($event.target as HTMLInputElement).value) || 0)"
          type="number"
          min="0"
          max="5000"
          step="100"
          placeholder="0"
          class="w-24 px-3 py-2 border border-theme rounded-md bg-theme-card focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <span class="text-sm text-theme-secondary">ms</span>
      </div>

      <!-- Clear Filters Button -->
      <button
        @click="$emit('clearFilters')"
        type="button"
        class="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500 transition"
      >
        Clear Filters
      </button>
    </div>

    <!-- Operation Type Filters -->
    <div class="relative mt-1">
      <div class="flex gap-2 pb-2 overflow-x-auto scroll-container" style="max-width: 85vw">
        <button
          v-for="option in operationTypeOptions"
          :key="option.value"
          @click="$emit('toggleOperationType', option.value)"
          :class="[
            'px-4 py-2 text-sm font-medium rounded border flex-shrink-0 transition',
            activeOperationTypes.includes(option.value)
              ? 'bg-theme-card text-theme-primary border-blue-300'
              : 'bg-theme-bg text-theme-muted border-theme hover:bg-theme-bg',
          ]"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OperationType } from '@/types/tracing';

interface Props {
  searchQuery: string;
  userIdFilter: string;
  startDate: string;
  endDate: string;
  errorStatus: 'all' | 'errors' | 'warnings';
  durationThreshold: number;
  operationTypeOptions: { value: OperationType; label: string }[];
  activeOperationTypes: OperationType[];
}

defineProps<Props>();

defineEmits<{
  'update:searchQuery': [value: string];
  'update:userIdFilter': [value: string];
  'update:startDate': [value: string];
  'update:endDate': [value: string];
  'update:errorStatus': [value: string];
  'update:durationThreshold': [value: number];
  'toggleOperationType': [operationType: OperationType];
  'reload': [];
  'clearFilters': [];
}>();
</script>