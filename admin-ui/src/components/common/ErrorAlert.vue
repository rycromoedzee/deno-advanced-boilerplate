<template>
  <div v-if="show" class="p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
    <div class="flex gap-3">
      <svg class="w-5 h-5 text-red-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path
          fill-rule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clip-rule="evenodd"
        />
      </svg>
      <div class="flex-1">
        <h3 class="text-sm font-medium text-red-800 mb-2">{{ title }}</h3>
        <p class="text-sm text-red-700 mb-4">{{ message }}</p>
        <button
          v-if="showRetry"
          @click="$emit('retry')"
          class="bg-red-100 px-3 py-2 rounded-md text-sm font-medium text-red-800 hover:bg-red-200 transition"
        >
          {{ retryText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  show?: boolean;
  title?: string;
  message: string;
  showRetry?: boolean;
  retryText?: string;
}

withDefaults(defineProps<Props>(), {
  show: true,
  title: 'Error loading data',
  showRetry: true,
  retryText: 'Try again',
});

defineEmits<{
  retry: [];
}>();
</script>