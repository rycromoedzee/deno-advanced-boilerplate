<template>
  <div class="flex flex-wrap gap-4 mb-6">
    <input
      :value="search"
      @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
      placeholder="Search by key (debounced)..."
      class="flex-grow px-3 py-2 border border-theme bg-theme-card rounded focus:outline-none focus:ring-2 focus:ring-indigo-300"
    />
    <select
      :value="filter"
      @change="$emit('update:filter', ($event.target as HTMLSelectElement).value)"
      class="px-3 py-2 border border-theme bg-theme-card rounded focus:outline-none focus:ring-2 focus:ring-indigo-300"
    >
      <option value="">All {{ filterLabel }}</option>
      <option
        v-for="option in filterOptions"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label }}
      </option>
    </select>
    <button
      @click="$emit('refresh')"
      class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
    >
      Refresh
    </button>
  </div>
</template>

<script setup lang="ts">
import type { FilterOption } from '@/types/cache';

interface Props {
  search: string;
  filter: string;
  filterOptions: FilterOption[];
  filterLabel?: string;
}

defineProps<Props>();

defineEmits<{
  'update:search': [value: string];
  'update:filter': [value: string];
  'refresh': [];
}>();
</script>