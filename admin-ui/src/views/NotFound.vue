<template>
  <div class="min-h-screen flex items-center justify-center bg-theme-bg">
    <div class="text-center">
      <h1 class="text-6xl font-bold text-theme-primary mb-4">404</h1>
      <p class="text-xl text-theme-secondary">Page not found</p>
      
      <!-- Debug info for API errors -->
      <div v-if="lastApiError" class="mt-8 p-4 bg-red-900/20 rounded-lg text-left max-w-2xl mx-auto">
        <h3 class="text-lg font-semibold text-red-400 mb-2">Last API Error (Debug):</h3>
        <pre class="text-sm text-red-300 overflow-auto">{{ JSON.stringify(lastApiError, null, 2) }}</pre>
        <button
          @click="clearError"
          class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md"
        >
          Clear Debug Info
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const lastApiError = ref<any>(null);

onMounted(() => {
  const errorStr = localStorage.getItem('last_api_error');
  if (errorStr) {
    try {
      lastApiError.value = JSON.parse(errorStr);
    } catch (e) {
      console.error('Failed to parse last_api_error:', e);
    }
  }
});

const clearError = () => {
  localStorage.removeItem('last_api_error');
  lastApiError.value = null;
};
</script>