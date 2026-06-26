<template>
  <div class="mt-12 mb-6">
    <!-- Search and Date Filters -->
    <div class="flex gap-4 mb-4">
      <!-- Search Input -->
      <div class="flex-1 relative">
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
          placeholder="Search anything"
          class="w-full pl-10 pr-4 py-2 border border-theme rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-theme-card"
        />
      </div>

      <!-- Date Filter -->
      <div class="flex items-center gap-2">
        <span class="text-sm text-theme-secondary whitespace-nowrap">Filter with date</span>
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
        <button
          @click="$emit('reload')"
          type="button"
          class="ml-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition"
        >
          Reload
        </button>
      </div>
    </div>

    <!-- Filter Buttons -->
    <div class="relative mt-1">
      <div class="flex gap-2 pb-2 overflow-x-auto scroll-container" style="max-width: 85vw">
        <button
          v-for="filter in filterOptions"
          :key="filter"
          @click="$emit('toggleFilter', filter)"
          :class="[
            'capitalize px-4 py-2 text-sm font-medium rounded border flex-shrink-0 transition',
            activeFilters.includes(filter)
              ? 'bg-theme-card text-theme-primary border-blue-300'
              : 'bg-theme-bg text-theme-muted border-theme hover:bg-theme-bg',
          ]"
        >
          {{ filter }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  searchQuery: string;
  startDate: string;
  endDate: string;
  filterOptions: string[];
  activeFilters: string[];
}

defineProps<Props>();

defineEmits<{
  'update:searchQuery': [value: string];
  'update:startDate': [value: string];
  'update:endDate': [value: string];
  'toggleFilter': [filter: string];
  'reload': [];
}>();
</script>